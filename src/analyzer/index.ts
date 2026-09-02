import * as ts from 'typescript';
import * as path from 'path';
import { minimatch } from 'minimatch';
import type { AnalysisResult } from '../types/analysis';
import type { DependencyGraph, ExportInfo, FileNode } from '../types/graph';
import type { SupportedLanguage } from '../types/language';
import { createPrograms } from './programFactory';
import { collectFileNodes } from './dependencyGraph';
import { detectUnusedFiles } from './unusedFileDetector';
import { detectUnusedExports } from './unusedExportDetector';
import { detectUnusedLocals } from './unusedLocalDetector';
import {
  createEmptyGraph,
  mergeGraphInto,
  markAllExportsUsed,
  resolveStarReExport,
  resolveReExportTarget,
  findDeadNamedReExportEdges,
  buildGraphFromFileNodes,
} from './graphBuilder';
import { makeExportKey } from './exportKey';
import { computeReachable } from './reachability';
import { applyMemberNameUsage, stripSourceNoise } from './memberUsage';
import { readSource, clearSourceCache } from './sourceCache';
import { hasIgnoreComment, hasFileIgnoreComment } from '../utils/ignoreComment';
import { groupFilesByLanguage, getAnalyzer, isTypeScriptFamily, detectLanguage } from './languages';
import { getFrameworkConventionalExports, findToolingEntryPoints, findDIContainerFiles } from './frameworkDetector';
import { getPythonConventionalExports } from './languages/python/pythonFrameworkDetector';
import { getJavaConventionalExports } from './languages/java/javaFrameworkDetector';
import { getGoConventionalExports } from './languages/go/goFrameworkDetector';
import { getDartConventionalExports, getDartIgnorePatterns, detectDartFramework } from './languages/dart/dartFrameworkDetector';
import { getPhpConventionalExports } from './languages/php/phpFrameworkDetector';

/**
 * Options for running analysis
 */
export interface AnalyzeOptions {
  /** List of file paths to analyze */
  files: string[];
  /** Root directory of the project */
  rootDir: string;
  /** Entry point files (their exports are considered public API) */
  entryPoints: string[];
  /** Optional path to tsconfig.json (used for TypeScript backward compatibility) */
  tsconfigPath?: string;
  /** Glob patterns for files to ignore in results */
  ignorePatterns?: string[];
  /** Additional decorator names (without @) that mark a class/function as DI entry point */
  entryPointDecorators?: string[];
  /** Glob patterns for DI container files — all their imports are treated as used */
  containerFiles?: string[];
  /** Export name glob patterns that are always considered used */
  alwaysUsedPatterns?: string[];
}

/**
 * Analyzes files for dead code across all supported languages
 */
export async function analyze(
  options: AnalyzeOptions
): Promise<AnalysisResult> {
  // The source cache is per-run: cleared before so the run sees fresh contents,
  // and after so a long-lived extension host does not retain the whole
  // codebase's text between analyses.
  clearSourceCache();
  try {
    return await runAnalysisPasses(options);
  } finally {
    clearSourceCache();
  }
}

async function runAnalysisPasses(
  options: AnalyzeOptions
): Promise<AnalysisResult> {
  const startTime = Date.now();

  const filesByLanguage = groupFilesByLanguage(options.files);
  const mergedGraph = createEmptyGraph();
  const tsPrograms: ts.Program[] = [];

  const userDecorators = options.entryPointDecorators ?? [];

  // Resolve containerFiles patterns to absolute file paths (user-configured)
  const userContainerFilePaths = resolveContainerFiles(
    options.files,
    options.containerFiles ?? [],
    options.rootDir
  );

  // Auto-detect DI container files by content pattern analysis (P4)
  const autoDetectedContainerFiles = await findDIContainerFiles(options.files);
  const containerFilePaths = new Set([
    ...userContainerFilePaths,
    ...autoDetectedContainerFiles,
  ]);

  for (const [language, files] of filesByLanguage) {
    if (language === 'typescript') {
      // A monorepo has one tsconfig per package, each with its own `paths`.
      // Files are grouped per config, but all their nodes feed a single graph
      // so imports crossing package boundaries still become edges.
      const groups = createPrograms(files, options.rootDir, options.tsconfigPath);
      const tsFileNodes = new Map<string, FileNode>();
      for (const group of groups) {
        tsPrograms.push(group.program); // kept for internal reference analysis
        collectFileNodes(
          group.files,
          group.program,
          { userDecorators, rootDir: options.rootDir },
          tsFileNodes
        );
      }
      mergeGraphInto(
        mergedGraph,
        buildGraphFromFileNodes(tsFileNodes, { containerFilePaths })
      );
    } else {
      const analyzer = getAnalyzer(language);
      if (!analyzer) {
        continue;
      }
      const graph = analyzer.buildGraph(files, options.rootDir);
      mergeGraphInto(mergedGraph, graph);
    }
  }

  // Merge tooling entry points (jest.config, vitest.config, etc.). Computed
  // before the graph passes so markEntryPointReExports can see them.
  const toolingEntries = await findToolingEntryPoints(options.rootDir);
  const toolingEntrySet = new Set(toolingEntries);
  const allEntryPoints = [...new Set([...options.entryPoints, ...toolingEntries])];

  // Apply container file rules post-merge (covers all languages)
  // TypeScript already handles this during buildDependencyGraph, but applying
  // post-merge ensures non-TS languages (Python, Go, Java, Dart) are also covered.
  applyContainerFileRules(mergedGraph, containerFilePaths);

  // Anything an entry point re-exports is part of the project's public API
  markEntryPointReExports(mergedGraph, allEntryPoints);

  // Propagate usage through re-export chains
  propagateReExportUsage(mergedGraph);

  // Mark exports that are referenced internally by other used exports
  analyzeInternalReferences(mergedGraph, tsPrograms);
  markInternalReferencesRegex(mergedGraph);

  // Non-TypeScript languages reach members by name rather than by import
  applyMemberNameUsage(mergedGraph);

  // Files unreachable from every entry point form dead clusters.
  //
  // The gate is on *application* roots that actually exist in the graph. Two
  // ways an entry-point list can fail to describe the application, both of
  // which would otherwise collapse `reachable` and report the whole project as
  // one dead cluster:
  //   1. a configured entry point that matches no analysed file (e.g. a
  //      relative path in user settings vs. the scanner's absolute keys);
  //   2. only tooling/config files matched (vitest.config.ts, webpack.config.js
  //      ...). Those are entry points for "do not report this file as unused",
  //      but they are not roots of the application graph — a repo whose source
  //      root could not be auto-detected must not be declared entirely dead.
  // With no application root the dead-cluster analysis is skipped entirely,
  // exactly as when no entry points are given at all.
  //
  // The gate is evaluated *per language*, because entry-point detection is. A
  // backend/ + frontend/ repo (Django + React, Laravel + Vue) gives TypeScript a
  // real root while PythonAnalyzer.findEntryPoints — like the PHP/Java/Go
  // framework patterns — only probes rootDir itself and finds nothing. A global
  // gate would let the TypeScript root switch reachability on for every
  // language and condemn the whole backend as one dead cluster. Languages
  // without a root of their own opt out instead, and behave exactly as they do
  // when no entry points are given at all.
  const matchedEntryPoints = allEntryPoints.filter((entry) => mergedGraph.files.has(entry));
  const languagesWithApplicationRoot = new Set<SupportedLanguage>();
  for (const entry of matchedEntryPoints) {
    if (toolingEntrySet.has(entry)) {
      continue;
    }
    const language = detectLanguage(entry);
    if (language !== undefined) {
      languagesWithApplicationRoot.add(language);
    }
  }
  const hasApplicationRoot = languagesWithApplicationRoot.size > 0;
  // Once a real root exists, tooling configs are included as additional seeds so
  // that files they legitimately pull in (jest.setup.ts, vite plugins) are not
  // themselves reported as dead.
  //
  // Edges whose only justification is a named re-export that is itself unused
  // are not traversed, so the declaration behind a dead re-export surfaces as
  // dead too.
  //
  // Files belonging to an opted-out language are added to the set afterwards so
  // that every `reachable`-derived rule in the detectors — the file's own
  // reachability and the liveness of the files that use its exports — reads as
  // it would with `reachable` undefined. Expressing the opt-out this way keeps
  // one set flowing to both detectors instead of threading a second per-file
  // predicate through their signatures.
  const reachable = hasApplicationRoot
    ? new Set([
        ...computeReachable(mergedGraph, matchedEntryPoints, {
          suppressedEdges: findDeadNamedReExportEdges(mergedGraph, {
            entryPoints: allEntryPoints,
            containerFiles: containerFilePaths,
            isExemptReExport: makeReExportExemptionCheck(options.alwaysUsedPatterns ?? []),
          }),
        }),
        ...collectReachabilityExemptFiles(mergedGraph, languagesWithApplicationRoot),
      ])
    : undefined;

  // Detect unused code
  const dartFramework = detectDartFramework(options.rootDir);
  const frameworkExports = [
    ...getFrameworkConventionalExports(options.rootDir),
    ...getPythonConventionalExports(options.rootDir),
    ...getJavaConventionalExports(options.rootDir),
    ...getGoConventionalExports(options.rootDir),
    ...getDartConventionalExports(dartFramework),
    ...getPhpConventionalExports(options.rootDir),
  ];

  // Add Dart generated file patterns to ignore when Flutter detected
  if (dartFramework === 'flutter') {
    const dartIgnores = getDartIgnorePatterns();
    if (!options.ignorePatterns) {
      options.ignorePatterns = dartIgnores;
    } else {
      options.ignorePatterns = [...options.ignorePatterns, ...dartIgnores];
    }
  }
  let unusedFiles = detectUnusedFiles(mergedGraph, allEntryPoints, reachable);
  let unusedExports = detectUnusedExports(
    mergedGraph,
    allEntryPoints,
    frameworkExports,
    options.alwaysUsedPatterns ?? [],
    reachable
  );
  let unusedLocals = detectUnusedLocals(mergedGraph);

  // Filter by ignorePatterns
  if (options.ignorePatterns && options.ignorePatterns.length > 0) {
    const matchesIgnore = (filePath: string): boolean =>
      options.ignorePatterns!.some((pattern) =>
        minimatch(filePath, pattern, { matchBase: true })
      );

    unusedFiles = unusedFiles.filter((r) => !matchesIgnore(r.filePath));
    unusedExports = unusedExports.filter((r) => !matchesIgnore(r.filePath));
    unusedLocals = unusedLocals.filter((r) => !matchesIgnore(r.filePath));
  }

  // Calculate statistics
  const totalExportCount = Array.from(mergedGraph.files.values()).reduce(
    (sum, file) => sum + file.exports.length,
    0
  );

  const totalLocalCount = Array.from(mergedGraph.files.values()).reduce(
    (sum, file) => sum + file.locals.length,
    0
  );

  const durationMs = Date.now() - startTime;

  return {
    unusedFiles,
    unusedExports,
    unusedLocals,
    analyzedFileCount: options.files.length,
    totalExportCount,
    totalLocalCount,
    durationMs,
    timestamp: Date.now(),
  };
}

/**
 * Files to which reachability must not be applied: those whose language has no
 * application entry point of its own (and those of an unrecognised language).
 *
 * They are unioned into the reachable set, which makes every reachability-derived
 * rule in the detectors a no-op for them — the file is never reported as
 * "not reachable from any entry point", and usages coming from it still count
 * towards its own language's exports.
 */
function collectReachabilityExemptFiles(
  graph: DependencyGraph,
  languagesWithApplicationRoot: Set<SupportedLanguage>
): string[] {
  const exempt: string[] = [];
  for (const filePath of Array.from(graph.files.keys())) {
    const language = detectLanguage(filePath);
    if (language === undefined || !languagesWithApplicationRoot.has(language)) {
      exempt.push(filePath);
    }
  }
  return exempt;
}

/**
 * Analyzes a single file and returns only results for that file
 */
export async function analyzeFile(
  filePath: string,
  options: AnalyzeOptions
): Promise<AnalysisResult> {
  // Run full analysis
  const fullResult = await analyze(options);

  // Filter results to only include the specified file
  const unusedFiles = fullResult.unusedFiles.filter(
    (result) => result.filePath === filePath
  );

  const unusedExports = fullResult.unusedExports.filter(
    (result) => result.filePath === filePath
  );

  const unusedLocals = fullResult.unusedLocals.filter(
    (result) => result.filePath === filePath
  );

  return {
    ...fullResult,
    unusedFiles,
    unusedExports,
    unusedLocals,
  };
}

/**
 * Builds the check used by `findDeadNamedReExportEdges` to decide whether a
 * re-export with no usages is nonetheless exempt from being treated as dead.
 *
 * Covers exactly the mechanisms that suppress an unused-export *report* outright
 * without ever creating a usage — `alwaysUsedPatterns` and the line- and
 * file-level `@dead-code-ignore` comments — so edge suppression cannot honour
 * the user's opt-out for the export while ignoring it for the file.
 *
 * Framework conventional exports are deliberately NOT included: outside a
 * convention-scanned entry point `determineConfidence` only downgrades them to
 * 'low' and still reports them, so exempting them here would be broader than the
 * detector. It would also be near-total in practice — 'default' is a
 * conventional name for Next.js, Storybook, Vue and Nuxt, which would exempt
 * every `export { default } from './x'` barrel edge in those projects. The
 * convention-scanned entry points that *are* skipped outright are already exempt
 * upstream, because `findDeadNamedReExportEdges` skips all entry points.
 */
function makeReExportExemptionCheck(
  alwaysUsedPatterns: string[]
): (filePath: string, exp: ExportInfo) => boolean {
  const alwaysUsed = alwaysUsedPatterns
    .map((pattern) => {
      try {
        const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${source}$`);
      } catch {
        return null;
      }
    })
    .filter((regex): regex is RegExp => regex !== null);

  return (filePath, exp) => {
    if (alwaysUsed.some((regex) => regex.test(exp.name))) return true;
    const source = readSource(filePath);
    if (source === null) return false;
    return hasFileIgnoreComment(source) || hasIgnoreComment(source, exp.line);
  };
}

/**
 * Marks exports that an entry point re-exports as used by that entry point.
 * `export * from './api'` and `export { x } from './y'` in an entry point make
 * the underlying exports part of the project's public API.
 */
function markEntryPointReExports(graph: DependencyGraph, entryPoints: string[]): void {
  for (const entry of entryPoints) {
    const node = graph.files.get(entry);
    if (!node) continue;

    for (const exp of node.exports) {
      if (!exp.isReExport || !exp.reExportSource) continue;

      const target = resolveReExportTarget(node, exp.reExportSource, graph.files);
      if (!target) continue;

      if (exp.name === '*') {
        markAllExportsUsed(graph, target, entry);
        continue;
      }

      const originalName = exp.originalName || exp.name;
      const key = makeExportKey(target, originalName);
      const usages =
        graph.exportUsages.get(key) ??
        resolveStarReExport(target, originalName, graph.files, graph.exportUsages);
      if (usages) {
        usages.add(entry);
      }
    }
  }
}

/**
 * Propagates export usage through named re-export chains.
 * When `export { default as X } from './Y'` is used, this ensures
 * the original export in './Y' is also marked as used.
 */
function propagateReExportUsage(graph: DependencyGraph): void {
  let changed = true;
  // The loop is monotone (usages are only ever added) and bounded by the number
  // of re-export links, so `changed` alone terminates it. The cap is now only a
  // guard against a pathological graph, and must NOT be a small constant: since
  // the builder stopped marking re-export chains unconditionally, truncating the
  // fixpoint leaves the tail of a deep chain un-restored, which suppresses its
  // edges and reports live declarations *and files* as dead. Worst case is one
  // link restored per sweep, depending on `graph.files` insertion order.
  const maxIterations = Math.max(1000, graph.files.size + 1);
  let iteration = 0;

  while (changed && iteration < maxIterations) {
    changed = false;
    iteration++;

    for (const [filePath, fileNode] of graph.files) {
      for (const exp of fileNode.exports) {
        if (!exp.isReExport || !exp.reExportSource) continue;

        const reExportKey = makeExportKey(filePath, exp.name);
        const usages = graph.exportUsages.get(reExportKey);
        if (!usages || usages.size === 0) continue;

        const originalName = exp.originalName || exp.name;
        // Resolve the target exactly as buildGraphFromFileNodes does, so every
        // usage it declines to register unconditionally for a named re-export
        // is restored here once the re-export is known to be live.
        const target =
          resolveReExportTarget(fileNode, exp.reExportSource, graph.files) ?? exp.reExportSource;
        const sourceKey = makeExportKey(target, originalName);

        let sourceUsages = graph.exportUsages.get(sourceKey);
        if (!sourceUsages && exp.name !== '*') {
          // The target may itself expose the name through an `export *` chain.
          sourceUsages = resolveStarReExport(target, originalName, graph.files, graph.exportUsages);
        }
        if (!sourceUsages) {
          sourceUsages = new Set();
          graph.exportUsages.set(sourceKey, sourceUsages);
        }

        const prevSize = sourceUsages.size;
        for (const user of usages) {
          sourceUsages.add(user);
        }
        if (sourceUsages.size > prevSize) {
          changed = true;
        }
      }
    }
  }
}

/**
 * Analyzes internal references between exports within the same TypeScript file.
 * If an export is referenced by another export that has external usage,
 * mark it as internally used by adding an entry to exportUsages.
 */
function analyzeInternalReferences(graph: DependencyGraph, programs: ts.Program[]): void {
  if (programs.length === 0) return;

  for (const [filePath, fileNode] of graph.files) {
    if (!isTypeScriptFamily(filePath)) continue;

    const program = programs.find((p) => p.getSourceFile(filePath));
    if (!program) continue;
    const sourceFile = program.getSourceFile(filePath)!;
    const checker = program.getTypeChecker();

    // Only worth doing when at least one export of this file is used elsewhere
    let hasExternallyUsed = false;
    for (const exp of fileNode.exports) {
      const usages = graph.exportUsages.get(makeExportKey(filePath, exp.name));
      if (usages && usages.size > 0) {
        hasExternallyUsed = true;
        break;
      }
    }
    if (!hasExternallyUsed) continue;

    // Collect the symbols of every currently-unused export in one go, so the
    // source file only has to be walked once.
    const exportedSymbols = new Map<ts.Symbol, string>();
    for (const exp of fileNode.exports) {
      const usages = graph.exportUsages.get(makeExportKey(filePath, exp.name));
      if (usages && usages.size > 0) continue;

      const symbol = findSymbolByName(exp.name, sourceFile, checker);
      if (symbol && !exportedSymbols.has(symbol)) {
        exportedSymbols.set(symbol, exp.name);
      }
    }
    if (exportedSymbols.size === 0) continue;

    const referenced = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        const name = symbol ? exportedSymbols.get(symbol) : undefined;
        if (name !== undefined && !isDeclarationName(node)) {
          referenced.add(name);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    for (const name of referenced) {
      const key = makeExportKey(filePath, name);
      const usages = graph.exportUsages.get(key);
      if (usages) {
        usages.add(filePath);
      } else {
        graph.exportUsages.set(key, new Set([filePath]));
      }
    }
  }
}

/**
 * True when the identifier is the name site of its own declaration.
 */
function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isEnumDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node)
  );
}

/**
 * Finds a symbol by name in a source file's top-level statements.
 */
function findSymbolByName(
  name: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return checker.getSymbolAtLocation(stmt.name);
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return checker.getSymbolAtLocation(stmt.name);
    }
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) {
      return checker.getSymbolAtLocation(stmt.name);
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      return checker.getSymbolAtLocation(stmt.name);
    }
    if (ts.isEnumDeclaration(stmt) && stmt.name.text === name) {
      return checker.getSymbolAtLocation(stmt.name);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return checker.getSymbolAtLocation(decl.name);
        }
      }
    }
  }
  return undefined;
}

/**
 * Regex-based internal reference detection for non-TypeScript files
 * (.py, .go, .java, .dart, etc.).
 */
function markInternalReferencesRegex(graph: DependencyGraph): void {
  for (const [filePath, fileNode] of graph.files) {
    if (isTypeScriptFamily(filePath)) continue;

    const content = readSource(filePath);
    if (content === null) continue;

    const externallyUsed = new Set<string>();
    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) externallyUsed.add(exp.name);
    }
    if (externallyUsed.size === 0) continue;

    const stripped = stripSourceNoise(content, filePath, false);

    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) continue;
      if (exp.name.length <= 2) continue; // skip short names prone to false matches

      const regex = new RegExp(`\\b${escapeRegex(exp.name)}\\b`, 'g');
      const matches = stripped.match(regex);
      const refCount = (matches?.length || 0) - 1; // subtract the declaration itself

      if (refCount > 0) {
        if (!usages) {
          graph.exportUsages.set(key, new Set([filePath]));
        } else {
          usages.add(filePath);
        }
      }
    }
  }
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies container file rules to the merged graph after all language graphs
 * have been built and merged. For each container file, marks all exports of
 * every module it imports as "used".
 *
 * This is the language-agnostic equivalent of the TypeScript-specific logic in
 * buildDependencyGraph and covers Python, Go, Java, Dart container files.
 */
function applyContainerFileRules(
  graph: DependencyGraph,
  containerFilePaths: Set<string>
): void {
  for (const containerPath of containerFilePaths) {
    const fileNode = graph.files.get(containerPath);
    if (!fileNode) continue;

    for (const importInfo of fileNode.imports) {
      const resolvedPath = importInfo.resolvedPath;
      const targetFile = graph.files.get(resolvedPath);
      if (!targetFile) continue;

      // Mark all exports of the imported module as used by this container file
      for (const exp of targetFile.exports) {
        const key = makeExportKey(resolvedPath, exp.name);
        const usages = graph.exportUsages.get(key);
        if (usages) {
          usages.add(containerPath);
        } else {
          graph.exportUsages.set(key, new Set([containerPath]));
        }
      }
    }
  }
}

/**
 * Resolves containerFiles glob patterns to the set of absolute file paths
 * from the files being analyzed.
 */
function resolveContainerFiles(
  analyzedFiles: string[],
  containerPatterns: string[],
  rootDir: string
): Set<string> {
  if (containerPatterns.length === 0) return new Set();

  const result = new Set<string>();
  for (const filePath of analyzedFiles) {
    // Test against both the absolute path and the path relative to rootDir
    const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const matches = containerPatterns.some(
      (pattern) =>
        minimatch(filePath, pattern, { matchBase: true }) ||
        minimatch(relative, pattern, { matchBase: true }) ||
        minimatch(filePath, pattern) ||
        minimatch(relative, pattern)
    );
    if (matches) {
      result.add(filePath);
    }
  }
  return result;
}

// Re-export types and utilities
export type { AnalysisResult } from '../types/analysis';
export { clearProgramCache } from './programFactory';
