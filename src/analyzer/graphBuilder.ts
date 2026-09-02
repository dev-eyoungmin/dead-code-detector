import { minimatch } from 'minimatch';
import type { DependencyGraph, ExportInfo, FileNode, ImportSpecifier } from '../types';
import { makeExportKey } from './exportKey';

export interface GraphBuildOptions {
  /** Absolute paths of DI container files: every import in them counts as a namespace import */
  containerFilePaths?: Set<string>;
}

/**
 * Builds a DependencyGraph from pre-collected FileNodes.
 * This is the language-agnostic 2nd-pass logic: given a map of file nodes,
 * it builds edges and tracks export usages, correctly following `export *`
 * re-export chains (an `export *` edge alone marks no export used; named
 * imports through the chain are traced to the actual owning export).
 */
export function buildGraphFromFileNodes(
  fileMap: Map<string, FileNode>,
  options: GraphBuildOptions = {}
): DependencyGraph {
  const containerFiles = options.containerFilePaths ?? new Set<string>();
  const graph: DependencyGraph = {
    files: fileMap,
    inboundEdges: new Map(),
    outboundEdges: new Map(),
    exportUsages: new Map(),
  };

  // Initialize edge maps and export usages
  for (const [filePath, fileNode] of fileMap) {
    graph.inboundEdges.set(filePath, new Set());
    graph.outboundEdges.set(filePath, new Set());
    for (const exp of fileNode.exports) {
      graph.exportUsages.set(makeExportKey(filePath, exp.name), new Set());
    }
  }

  const allPaths = Array.from(fileMap.keys());

  // Build edges and track export usages
  for (const [filePath, fileNode] of fileMap) {
    const isContainer = containerFiles.has(filePath);

    for (const importInfo of fileNode.imports) {
      const targets = importInfo.globPattern
        ? allPaths.filter((p) => minimatch(p, importInfo.globPattern!, { dot: true }))
        : fileMap.has(importInfo.resolvedPath)
          ? [importInfo.resolvedPath]
          : [];

      for (const target of targets) {
        graph.outboundEdges.get(filePath)!.add(target);
        graph.inboundEdges.get(target)!.add(filePath);

        if (importInfo.isStarReExport && !isContainer) {
          // `export * from` only creates an edge; it does not by itself mark
          // any export as used. Usage is tracked when a downstream consumer
          // actually imports a specific name (or the barrel's namespace).
          continue;
        }

        if (importInfo.globPattern || importInfo.isNamespaceImport || isContainer) {
          markAllExportsUsed(graph, target, filePath);
          continue;
        }

        for (const spec of importInfo.specifiers) {
          // A named `export { x } from './t'` forwards `x`; it does not consume
          // it. Registering an unconditional usage here would keep the
          // declaration alive even when the re-export itself is dead. Liveness
          // is instead conferred by propagateReExportUsage once the re-export is
          // known to be used.
          //
          // The question is asked of *this import record*, not of the file: a
          // file may both `import { x } from './t'` (a genuine consumption) and
          // `export { x } from './t'` (a forward), and the two are
          // indistinguishable at specifier level. Only the forward is skipped,
          // and only when the matching re-export resolves to this same target,
          // so the propagation pass provably knows how to restore it.
          if (
            importInfo.isNamedReExport &&
            findNamedReExport(fileNode, spec, target, fileMap)
          ) {
            continue;
          }

          const direct = graph.exportUsages.get(makeExportKey(target, spec.name));
          if (direct) {
            direct.add(filePath);
            continue;
          }
          const viaStar = resolveStarReExport(target, spec.name, fileMap, graph.exportUsages);
          if (viaStar) {
            viaStar.add(filePath);
          }
        }
      }
    }
  }

  return graph;
}

/** Marks every export of `targetPath` used by `byFile`, following `export *` chains transitively. */
export function markAllExportsUsed(
  graph: DependencyGraph,
  targetPath: string,
  byFile: string,
  visited: Set<string> = new Set()
): void {
  if (visited.has(targetPath)) {
    return;
  }
  visited.add(targetPath);

  const node = graph.files.get(targetPath);
  if (!node) {
    return;
  }

  for (const exp of node.exports) {
    const usages = graph.exportUsages.get(makeExportKey(targetPath, exp.name));
    if (usages) {
      usages.add(byFile);
    }
    if (exp.name === '*' && exp.isReExport && exp.reExportSource) {
      const next = resolveReExportTarget(node, exp.reExportSource, graph.files);
      if (next) {
        markAllExportsUsed(graph, next, byFile, visited);
      }
    }
  }
}

/**
 * Finds the named re-export of `node` that forwards `spec` to `target`.
 *
 * Matched on the *barrel-side* name (`spec.alias ?? spec.name`) as well as the
 * original, so that a file forwarding the same original twice —
 * `export { Foo } from './foo'; export { Foo as Legacy } from './foo';`, the
 * standard deprecation-alias barrel — resolves each record to its own export
 * instead of both to whichever came first in source order.
 *
 * Star re-exports are excluded: `export * from` keeps its existing semantics.
 */
function findNamedReExport(
  node: FileNode,
  spec: ImportSpecifier,
  target: string,
  fileMap: Map<string, FileNode>
): ExportInfo | undefined {
  const exportedName = spec.alias ?? spec.name;
  return node.exports.find(
    (exp) =>
      exp.isReExport &&
      exp.name !== '*' &&
      exp.reExportSource !== undefined &&
      exp.name === exportedName &&
      (exp.originalName || exp.name) === spec.name &&
      resolveReExportTarget(node, exp.reExportSource, fileMap) === target
  );
}

export interface DeadReExportOptions {
  /** Entry points, whose own re-exports are public API and never dead. */
  entryPoints?: Iterable<string>;
  /** DI container files, whose imports are all treated as used. */
  containerFiles?: Set<string>;
  /**
   * Returns true when a re-export with no usages is nonetheless exempt from
   * being reported (alwaysUsedPatterns, or a line- or file-level
   * @dead-code-ignore), and so must not suppress its edge.
   */
  isExemptReExport?: (filePath: string, exp: ExportInfo) => boolean;
}

/** Key for a directed edge, for use with `findDeadNamedReExportEdges`. */
export function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * Returns the edges whose only justification is a *named* re-export that is
 * itself unused. A file pulled in solely by a dead re-export is not actually
 * reachable, so these edges must not be traversed when computing reachability.
 *
 * Deliberately conservative — an edge stays live if anything about it cannot be
 * proven dead: star re-exports, namespace imports, glob imports, side-effect
 * imports, a specifier that is a genuine consumption rather than a re-export,
 * a re-export that still has usages, or an edge with no matching import record.
 *
 * Edges out of an entry point are never suppressed: an entry point's exports
 * are the project's public API, so its re-exports are live by definition even
 * though nothing in the project imports them. The same holds for DI container
 * files, whose imports are all treated as used.
 *
 * Must be called after all usage-marking passes have run.
 */
export function findDeadNamedReExportEdges(
  graph: DependencyGraph,
  options: DeadReExportOptions = {}
): Set<string> {
  const suppressed = new Set<string>();
  const entryPointSet = new Set(options.entryPoints ?? []);
  const containerFiles = options.containerFiles ?? new Set<string>();

  for (const [from, node] of graph.files) {
    if (entryPointSet.has(from) || containerFiles.has(from)) {
      continue;
    }
    for (const to of graph.outboundEdges.get(from) ?? []) {
      if (!hasLiveJustification(graph, node, from, to, options.isExemptReExport)) {
        suppressed.add(edgeKey(from, to));
      }
    }
  }

  return suppressed;
}

function hasLiveJustification(
  graph: DependencyGraph,
  node: FileNode,
  from: string,
  to: string,
  isExemptReExport?: (filePath: string, exp: ExportInfo) => boolean
): boolean {
  let sawImport = false;

  for (const imp of node.imports) {
    const hits = imp.globPattern
      ? minimatch(to, imp.globPattern, { dot: true })
      : imp.resolvedPath === to;
    if (!hits) {
      continue;
    }
    sawImport = true;

    // Only a forwarding `export { x } from './t'` can ever be dead weight; an
    // ImportDeclaration of the same specifier is a genuine consumption.
    if (!imp.isNamedReExport) {
      return true;
    }
    if (imp.globPattern || imp.isNamespaceImport || imp.isStarReExport) {
      return true;
    }
    // Side-effect import (`import './x'`) — the edge is the point.
    if (imp.specifiers.length === 0) {
      return true;
    }

    for (const spec of imp.specifiers) {
      const reExport = findNamedReExport(node, spec, to, graph.files);
      if (!reExport) {
        return true; // nothing the propagation pass could restore
      }
      const usages = graph.exportUsages.get(makeExportKey(from, reExport.name));
      if (!usages || usages.size > 0) {
        return true; // the re-export is itself live
      }
      // The re-export has no usages but is exempt from being *reported*
      // (alwaysUsedPatterns, or a line- or file-level @dead-code-ignore).
      // Honour that opt-out at file level too.
      if (isExemptReExport?.(from, reExport)) {
        return true;
      }
    }
  }

  // An edge with no matching import record (e.g. contributed by another pass)
  // is left alone.
  return !sawImport;
}

/**
 * Resolves a re-export's declared source to an analysed file path, falling back
 * to the importing file's own resolved imports when the source is not already
 * an absolute path present in the graph.
 */
export function resolveReExportTarget(
  node: FileNode,
  reExportSource: string,
  fileMap: Map<string, FileNode>
): string | undefined {
  if (fileMap.has(reExportSource)) {
    return reExportSource;
  }
  const imp = node.imports.find(
    (i) => (i.source === reExportSource || i.resolvedPath === reExportSource) && fileMap.has(i.resolvedPath)
  );
  return imp?.resolvedPath;
}

/**
 * Resolves a named import through `export *` chains to the owning export's usage set.
 * When a file does `export * from './other'`, named imports from that file
 * need to be traced to the actual source module.
 */
export function resolveStarReExport(
  filePath: string,
  exportName: string,
  fileMap: Map<string, FileNode>,
  exportUsages: Map<string, Set<string>>,
  visited: Set<string> = new Set()
): Set<string> | undefined {
  // Prevent infinite loops in circular re-exports
  if (visited.has(filePath)) {
    return undefined;
  }
  visited.add(filePath);

  const file = fileMap.get(filePath);
  if (!file) {
    return undefined;
  }

  for (const exp of file.exports) {
    if (exp.name !== '*' || !exp.isReExport || !exp.reExportSource) {
      continue;
    }
    const next = resolveReExportTarget(file, exp.reExportSource, fileMap);
    if (!next) {
      continue;
    }
    const direct = exportUsages.get(makeExportKey(next, exportName));
    if (direct) {
      return direct;
    }
    const deeper = resolveStarReExport(next, exportName, fileMap, exportUsages, visited);
    if (deeper) {
      return deeper;
    }
  }
  return undefined;
}

/**
 * Creates an empty DependencyGraph
 */
export function createEmptyGraph(): DependencyGraph {
  return {
    files: new Map(),
    inboundEdges: new Map(),
    outboundEdges: new Map(),
    exportUsages: new Map(),
  };
}

/**
 * Merges a source graph into a target graph (mutates target)
 */
export function mergeGraphInto(
  target: DependencyGraph,
  source: DependencyGraph
): void {
  // Merge files
  for (const [filePath, fileNode] of source.files) {
    target.files.set(filePath, fileNode);
  }

  // Merge inbound edges
  for (const [filePath, edges] of source.inboundEdges) {
    const existing = target.inboundEdges.get(filePath);
    if (existing) {
      for (const edge of edges) {
        existing.add(edge);
      }
    } else {
      target.inboundEdges.set(filePath, new Set(edges));
    }
  }

  // Merge outbound edges
  for (const [filePath, edges] of source.outboundEdges) {
    const existing = target.outboundEdges.get(filePath);
    if (existing) {
      for (const edge of edges) {
        existing.add(edge);
      }
    } else {
      target.outboundEdges.set(filePath, new Set(edges));
    }
  }

  // Merge export usages
  for (const [key, usages] of source.exportUsages) {
    const existing = target.exportUsages.get(key);
    if (existing) {
      for (const usage of usages) {
        existing.add(usage);
      }
    } else {
      target.exportUsages.set(key, new Set(usages));
    }
  }
}
