import { scanFiles } from '../scanner';
import { analyze } from '../analyzer';
import type { AnalysisResult } from '../types';
import type { ExtensionConfig, SupportedLanguage } from '../types';
import { detectLanguage, getAllAnalyzers } from '../analyzer/languages';

/**
 * Result of a full project analysis run
 */
export interface RunAnalysisResult {
  result: AnalysisResult;
  fileCount: number;
  entryPoints: string[];
  /** Absolute paths of the files that were actually scanned and analyzed (after `enabledLanguages` filtering). */
  analyzedFiles: string[];
}

/**
 * Runs a full-project dead code analysis: scans files under `rootDir` using
 * `config.include`/`config.exclude`, restricts the scanned files to the
 * languages enabled in `config.enabledLanguages`, auto-detects entry points
 * via the language analyzers whose language is enabled when `config.entryPoints`
 * is empty, and runs `analyze()` with the complete configuration.
 */
export async function runProjectAnalysis(
  rootDir: string,
  config: ExtensionConfig
): Promise<RunAnalysisResult> {
  const scanResult = await scanFiles({
    rootDir,
    include: config.include,
    exclude: config.exclude,
  });

  const enabledLanguages = new Set(config.enabledLanguages);
  const files = scanResult.files.filter((file) => {
    const language = detectLanguage(file);
    return language !== undefined && enabledLanguages.has(language);
  });

  // Nothing to analyze: skip entry-point detection and analyze() entirely so
  // callers can short-circuit without paying for unnecessary filesystem work.
  if (files.length === 0) {
    return {
      result: createEmptyResult(),
      fileCount: 0,
      entryPoints: [],
      analyzedFiles: [],
    };
  }

  let entryPoints = config.entryPoints;
  if (entryPoints.length === 0) {
    entryPoints = await findEntryPoints(rootDir, enabledLanguages);
  }

  const result = await analyze({
    files,
    rootDir,
    entryPoints,
    ignorePatterns: config.ignorePatterns,
    entryPointDecorators: config.entryPointDecorators,
    containerFiles: config.containerFiles,
    alwaysUsedPatterns: config.alwaysUsedPatterns,
  });

  return {
    result,
    fileCount: files.length,
    entryPoints,
    analyzedFiles: files,
  };
}

/**
 * Builds an empty `AnalysisResult` for the "nothing to analyze" case.
 */
function createEmptyResult(): AnalysisResult {
  return {
    unusedFiles: [],
    unusedExports: [],
    unusedLocals: [],
    analyzedFileCount: 0,
    totalExportCount: 0,
    totalLocalCount: 0,
    durationMs: 0,
    timestamp: Date.now(),
  };
}

/**
 * Auto-detects entry points by collecting them from the language analyzers
 * whose language is present in `enabledLanguages`. Analyzers for disabled
 * languages are skipped so their (potentially expensive) filesystem probing
 * (e.g. `pom.xml`, `go.mod`, `pubspec.yaml`) never runs, and their entry
 * points never leak into the result when the user has turned that language off.
 */
async function findEntryPoints(
  rootDir: string,
  enabledLanguages: Set<SupportedLanguage>
): Promise<string[]> {
  const entryPoints: string[] = [];
  const analyzers = getAllAnalyzers().filter((analyzer) =>
    enabledLanguages.has(analyzer.language)
  );

  for (const analyzer of analyzers) {
    const points = await analyzer.findEntryPoints(rootDir);
    for (const point of points) {
      if (!entryPoints.includes(point)) {
        entryPoints.push(point);
      }
    }
  }

  return entryPoints;
}
