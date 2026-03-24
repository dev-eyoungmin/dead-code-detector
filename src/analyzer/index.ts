import * as ts from 'typescript';
import * as fs from 'fs';
import { minimatch } from 'minimatch';
import type { AnalysisResult } from '../types/analysis';
import type { DependencyGraph } from '../types/graph';
import { createProgram } from './programFactory';
import { buildDependencyGraph } from './dependencyGraph';
import { detectUnusedFiles } from './unusedFileDetector';
import { detectUnusedExports } from './unusedExportDetector';
import { detectUnusedLocals } from './unusedLocalDetector';
import { createEmptyGraph, mergeGraphInto } from './graphBuilder';
import { makeExportKey } from './dependencyGraph';
import { groupFilesByLanguage, getAnalyzer } from './languages';
import { getFrameworkConventionalExports, findToolingEntryPoints } from './frameworkDetector';
import { getPythonConventionalExports } from './languages/python/pythonFrameworkDetector';
import { getJavaConventionalExports } from './languages/java/javaFrameworkDetector';
import { getGoConventionalExports } from './languages/go/goFrameworkDetector';
import { getDartConventionalExports, getDartIgnorePatterns, detectDartFramework } from './languages/dart/dartFrameworkDetector';

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
}

/**
 * Analyzes files for dead code across all supported languages
 */
export async function analyze(
  options: AnalyzeOptions
): Promise<AnalysisResult> {
  const startTime = Date.now();

  const filesByLanguage = groupFilesByLanguage(options.files);
  const mergedGraph = createEmptyGraph();
  let tsProgram: ts.Program | undefined;

  for (const [language, files] of filesByLanguage) {
    if (language === 'typescript') {
      // For TypeScript, use the direct path for backward compatibility
      const program = createProgram(files, options.tsconfigPath);
      tsProgram = program; // save reference for internal reference analysis
      const graph = buildDependencyGraph(files, program);
      mergeGraphInto(mergedGraph, graph);
    } else {
      const analyzer = getAnalyzer(language);
      if (!analyzer) {
        continue;
      }
      const graph = analyzer.buildGraph(files, options.rootDir);
      mergeGraphInto(mergedGraph, graph);
    }
  }

  // Propagate usage through re-export chains
  propagateReExportUsage(mergedGraph);

  // Mark exports that are referenced internally by other used exports
  if (tsProgram) {
    analyzeInternalReferences(mergedGraph, tsProgram);
  }
  markInternalReferencesRegex(mergedGraph);

  // Detect unused code
  const dartFramework = detectDartFramework(options.rootDir);
  const frameworkExports = [
    ...getFrameworkConventionalExports(options.rootDir),
    ...getPythonConventionalExports(options.rootDir),
    ...getJavaConventionalExports(options.rootDir),
    ...getGoConventionalExports(options.rootDir),
    ...getDartConventionalExports(dartFramework),
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
  // Merge tooling entry points (jest.config, vitest.config, etc.)
  const toolingEntries = await findToolingEntryPoints(options.rootDir);
  const allEntryPoints = [...new Set([...options.entryPoints, ...toolingEntries])];

  let unusedFiles = detectUnusedFiles(mergedGraph, allEntryPoints);
  let unusedExports = detectUnusedExports(
    mergedGraph,
    allEntryPoints,
    frameworkExports
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
 * Propagates export usage through named re-export chains.
 * When `export { default as X } from './Y'` is used, this ensures
 * the original export in './Y' is also marked as used.
 */
function propagateReExportUsage(graph: DependencyGraph): void {
  let changed = true;
  const maxIterations = 10;
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
        const sourceKey = makeExportKey(exp.reExportSource, originalName);

        let sourceUsages = graph.exportUsages.get(sourceKey);
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
function analyzeInternalReferences(graph: DependencyGraph, program: ts.Program): void {
  const checker = program.getTypeChecker();

  for (const [filePath, fileNode] of graph.files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) continue;

    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;

    // Find which exports have external usage
    const externallyUsed = new Set<string>();
    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) externallyUsed.add(exp.name);
    }
    if (externallyUsed.size === 0) continue;

    // For each unused export, check if referenced in same file
    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) continue;

      const symbol = findSymbolByName(exp.name, sourceFile, checker);
      if (!symbol) continue;

      const refCount = countNonDeclarationReferences(symbol, sourceFile, checker);
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
 * Counts references to a symbol in a source file, excluding declaration sites.
 */
function countNonDeclarationReferences(
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      if (sym === symbol) {
        const parent = node.parent;
        const isDecl =
          (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
          (ts.isFunctionDeclaration(parent) && parent.name === node) ||
          (ts.isClassDeclaration(parent) && parent.name === node) ||
          (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
          (ts.isEnumDeclaration(parent) && parent.name === node) ||
          (ts.isVariableDeclaration(parent) && parent.name === node);
        if (!isDecl) count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

/**
 * Regex-based internal reference detection for non-TypeScript files
 * (.py, .go, .java, .dart, etc.).
 */
function markInternalReferencesRegex(graph: DependencyGraph): void {
  for (const [filePath, fileNode] of graph.files) {
    if (/\.(ts|tsx|js|jsx)$/.test(filePath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const externallyUsed = new Set<string>();
    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) externallyUsed.add(exp.name);
    }
    if (externallyUsed.size === 0) continue;

    const stripped = stripCommentsAndStrings(content);

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
 * Strips comments and string literals from source code to avoid false matches.
 */
function stripCommentsAndStrings(content: string): string {
  let result = content.replace(/\/\/.*$/gm, '');
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  result = result.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return result;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Re-export types and utilities
export type { AnalysisResult } from '../types/analysis';
export { clearProgramCache } from './programFactory';
