import type { DependencyGraph, FileNode } from '../types';
import { makeExportKey } from './dependencyGraph';

/**
 * Builds a DependencyGraph from pre-collected FileNodes.
 * This is the language-agnostic 2nd-pass logic: given a map of file nodes,
 * it builds edges and tracks export usages.
 */
export function buildGraphFromFileNodes(
  fileMap: Map<string, FileNode>
): DependencyGraph {
  const inboundEdges = new Map<string, Set<string>>();
  const outboundEdges = new Map<string, Set<string>>();
  const exportUsages = new Map<string, Set<string>>();

  // Initialize edge maps and export usages
  for (const [filePath, fileNode] of fileMap) {
    inboundEdges.set(filePath, new Set());
    outboundEdges.set(filePath, new Set());

    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      exportUsages.set(key, new Set());
    }
  }

  // Build edges and track export usages
  for (const [filePath, fileNode] of fileMap) {
    for (const importInfo of fileNode.imports) {
      const resolvedPath = importInfo.resolvedPath;

      // Skip external modules
      if (!fileMap.has(resolvedPath)) {
        continue;
      }

      // Add edges
      outboundEdges.get(filePath)!.add(resolvedPath);
      inboundEdges.get(resolvedPath)!.add(filePath);

      // Track which exports are being imported
      const targetFile = fileMap.get(resolvedPath);
      if (!targetFile) {
        continue;
      }

      if (importInfo.isNamespaceImport) {
        for (const exp of targetFile.exports) {
          const key = makeExportKey(resolvedPath, exp.name);
          const usages = exportUsages.get(key);
          if (usages) {
            usages.add(filePath);
          }
        }
      } else {
        for (const specifier of importInfo.specifiers) {
          const importedName = specifier.name;
          const key = makeExportKey(resolvedPath, importedName);
          const usages = exportUsages.get(key);
          if (usages) {
            usages.add(filePath);
          }
        }
      }
    }
  }

  return {
    files: fileMap,
    inboundEdges,
    outboundEdges,
    exportUsages,
  };
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
