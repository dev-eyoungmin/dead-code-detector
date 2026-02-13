import { minimatch } from 'minimatch';
import type { AnalysisResult } from '../types/analysis';
import { createProgram } from './programFactory';
import { buildDependencyGraph } from './dependencyGraph';
import { detectUnusedFiles } from './unusedFileDetector';
import { detectUnusedExports } from './unusedExportDetector';
import { detectUnusedLocals } from './unusedLocalDetector';
import { createEmptyGraph, mergeGraphInto } from './graphBuilder';
import { groupFilesByLanguage, getAnalyzer } from './languages';
import { getFrameworkConventionalExports } from './frameworkDetector';
import { getPythonConventionalExports } from './languages/python/pythonFrameworkDetector';
import { getJavaConventionalExports } from './languages/java/javaFrameworkDetector';
import { getGoConventionalExports } from './languages/go/goFrameworkDetector';

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
  for (const [language, files] of filesByLanguage) {
    if (language === 'typescript') {
      // For TypeScript, use the direct path for backward compatibility
      const program = createProgram(files, options.tsconfigPath);
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

  // Detect unused code
  const frameworkExports = [
    ...getFrameworkConventionalExports(options.rootDir),
    ...getPythonConventionalExports(options.rootDir),
    ...getJavaConventionalExports(options.rootDir),
    ...getGoConventionalExports(options.rootDir),
  ];
  let unusedFiles = detectUnusedFiles(mergedGraph, options.entryPoints);
  let unusedExports = detectUnusedExports(
    mergedGraph,
    options.entryPoints,
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

// Re-export types and utilities
export type { AnalysisResult } from '../types/analysis';
export { clearProgramCache } from './programFactory';
