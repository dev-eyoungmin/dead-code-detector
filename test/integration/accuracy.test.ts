import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanFiles } from '../../src/scanner/fileScanner';
import { analyze } from '../../src/analyzer';
import { getAllAnalyzers } from '../../src/analyzer/languages';
import { createPrograms } from '../../src/analyzer/programFactory';
import { collectFileNodes } from '../../src/analyzer/dependencyGraph';
import { DEFAULT_INCLUDE_PATTERNS, DEFAULT_EXCLUDE_PATTERNS } from '../../src/constants';
import type { AnalysisResult } from '../../src/types/analysis';

/**
 * End-to-end accuracy fixtures.
 *
 * Each fixture is a minimal but *complete* project (it has a package.json, so
 * entry-point auto-detection has something to find) exercising one accuracy
 * area: barrel/`export *` semantics and dead clusters, CommonJS exports, Vue
 * SFCs, and a multi-tsconfig workspace. Every case is driven through the same
 * path a real run takes — `scanFiles` with the shipped include/exclude
 * defaults, entry points from the language analyzers, then `analyze()` — so a
 * regression anywhere in the pipeline shows up here.
 */

const fixturesRoot = path.resolve(__dirname, '../fixtures');

/** Runs the full scan -> entry-point detection -> analyze pipeline, like `runProjectAnalysis`. */
async function analyzeFixture(rootDir: string): Promise<AnalysisResult> {
  const scanResult = await scanFiles({
    rootDir,
    include: DEFAULT_INCLUDE_PATTERNS,
    exclude: DEFAULT_EXCLUDE_PATTERNS,
  });

  const entryPoints: string[] = [];
  for (const analyzer of getAllAnalyzers()) {
    for (const entry of await analyzer.findEntryPoints(rootDir)) {
      if (!entryPoints.includes(entry)) {
        entryPoints.push(entry);
      }
    }
  }

  return analyze({ files: scanResult.files, rootDir, entryPoints });
}

/** `[<path relative to rootDir, with / separators>, confidence]` for every unused file. */
function unusedFileTuples(result: AnalysisResult, rootDir: string): Array<[string, string]> {
  return result.unusedFiles.map((file) => [
    path.relative(rootDir, file.filePath).split(path.sep).join('/'),
    file.confidence,
  ]);
}

function unusedFilePaths(result: AnalysisResult, rootDir: string): string[] {
  return unusedFileTuples(result, rootDir).map(([relativePath]) => relativePath);
}

function unusedExportNames(result: AnalysisResult): string[] {
  return result.unusedExports.map((exp) => exp.exportName);
}

function unusedExportTuples(result: AnalysisResult): Array<[string, string]> {
  return result.unusedExports.map((exp) => [exp.exportName, exp.confidence]);
}

function unusedLocalTuples(result: AnalysisResult): Array<[string, string]> {
  return result.unusedLocals.map((local) => [local.symbolName, local.confidence]);
}

describe('Accuracy: barrel-project (export * semantics, dead clusters, nested locals)', () => {
  const rootDir = path.join(fixturesRoot, 'barrel-project');
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyzeFixture(rootDir);
  });

  it('reports exports that are only reachable through `export *` as unused', () => {
    const names = unusedExportNames(result);
    expect(names).toContain('starDeadA');
    expect(names).toContain('starDeadB');
  });

  it('reports a sibling export of a re-exported symbol as unused', () => {
    expect(unusedExportNames(result)).toContain('alsoDead');
  });

  // Satisfied by the barrel's own `export { neverImported } from './named-target2'`
  // entry, which nothing imports.
  it('reports a re-exported symbol nobody imports as unused at low confidence', () => {
    expect(unusedExportTuples(result)).toContainEqual(['neverImported', 'low']);
  });

  // A named re-export confers liveness only to the extent it is itself live,
  // so the declaration behind the barrel's dead `export { neverImported }`
  // surfaces at its own site too.
  it('reports the declaration behind a dead named re-export', () => {
    const declarationSite = result.unusedExports.find(
      (exp) =>
        exp.exportName === 'neverImported' && exp.filePath.endsWith('named-target2.ts')
    );
    expect(declarationSite).toBeDefined();
  });

  it('reports the exports of a dead cluster at low confidence', () => {
    const tuples = unusedExportTuples(result);
    expect(tuples).toContainEqual(['a', 'low']);
    expect(tuples).toContainEqual(['b', 'low']);
    expect(tuples).toContainEqual(['useA', 'low']);
  });

  it('keeps the used export out of the results', () => {
    expect(unusedExportNames(result)).not.toContain('used');
  });

  it('reports the mutually-importing dead cluster files at low confidence', () => {
    const tuples = unusedFileTuples(result, rootDir);
    expect(tuples).toContainEqual(['src/dead-cluster-a.ts', 'low']);
    expect(tuples).toContainEqual(['src/dead-cluster-b.ts', 'low']);
  });

  // A file kept alive only by a re-export nobody imports is itself dead: the
  // edge created by the unused `export { neverImported } from './named-target2'`
  // is not traversed when computing reachability.
  it('reports a file kept alive only by an unused re-export', () => {
    expect(unusedFileTuples(result, rootDir)).toContainEqual(['src/named-target2.ts', 'low']);
  });

  it('does not report dynamic-import and worker targets as unused files', () => {
    const paths = unusedFilePaths(result, rootDir);
    expect(paths).not.toContain('src/locales/en.ts');
    expect(paths).not.toContain('src/worker.ts');
  });

  it('reports locals declared inside nested functions and callbacks', () => {
    const tuples = unusedLocalTuples(result);
    expect(tuples).toContainEqual(['unusedInNested', 'high']);
    expect(tuples).toContainEqual(['unusedInCallback', 'high']);
  });

  it('reports unused private class members', () => {
    const tuples = unusedLocalTuples(result);
    expect(tuples).toContainEqual(['unusedField', 'medium']);
    expect(tuples).toContainEqual(['unusedPrivate', 'high']);
  });

  it('applies the after-used rule to parameters', () => {
    const tuples = unusedLocalTuples(result);
    // `req` is the last parameter and unused -> reported, never above medium.
    expect(tuples).toContainEqual(['req', 'medium']);
    // `err` precedes a used parameter -> removing it would break the signature.
    expect(tuples.map(([name]) => name)).not.toContain('err');
  });
});

describe('Accuracy: cjs-project (CommonJS exports)', () => {
  const rootDir = path.join(fixturesRoot, 'cjs-project');
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyzeFixture(rootDir);
  });

  it('collects `module.exports = { ... }` properties and reports only the dead one', () => {
    expect(unusedExportNames(result)).toEqual(['cjsDead']);
  });
});

describe('Accuracy: sfc-project (Vue single-file components)', () => {
  const rootDir = path.join(fixturesRoot, 'sfc-project');
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyzeFixture(rootDir);
  });

  it('does not report any file as unused', () => {
    expect(unusedFilePaths(result, rootDir)).toEqual([]);
  });

  it('reports only the helper no SFC imports', () => {
    expect(unusedExportNames(result)).toEqual(['vueDead']);
  });

  it('counts template-only references, so no local is reported', () => {
    expect(unusedLocalTuples(result)).toEqual([]);
  });
});

describe('Accuracy: monorepo-project (one tsconfig per package)', () => {
  const rootDir = path.join(fixturesRoot, 'monorepo-project');
  const linkDir = path.join(rootDir, 'node_modules', '@ws');
  const linkPath = path.join(linkDir, 'a');
  let result: AnalysisResult;
  // The workspace symlink cannot be stored in git, so it is created for the run
  // and removed afterwards. On platforms where symlink creation is not
  // permitted (Windows without developer mode) the cross-package assertion is
  // skipped rather than failed.
  let symlinked = false;

  beforeAll(async () => {
    try {
      fs.mkdirSync(linkDir, { recursive: true });
      fs.symlinkSync(path.join(rootDir, 'packages', 'a'), linkPath, 'dir');
      symlinked = true;
    } catch {
      symlinked = false;
    }
    result = await analyzeFixture(rootDir);
  });

  afterAll(() => {
    try {
      fs.rmSync(path.join(rootDir, 'node_modules'), { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('resolves each package with its own `paths` mapping', () => {
    expect(unusedFilePaths(result, rootDir)).toEqual([]);
  });

  it('reports the dead symbol of every package exactly once', () => {
    expect(unusedExportNames(result).sort()).toEqual(['aDead', 'bDead']);
  });

  // Both package roots are entry points, so a cross-package import cannot be
  // observed through `AnalysisResult` alone: the graph is inspected directly.
  it('resolves a symlinked workspace package to its source file', () => {
    if (!symlinked) {
      return;
    }
    const bIndex = path.join(rootDir, 'packages', 'b', 'src', 'index.ts');
    const groups = createPrograms([bIndex], rootDir);
    const nodes = collectFileNodes(groups[0].files, groups[0].program, { rootDir });
    const resolved = nodes.get(bIndex)!.imports.map((imp) => imp.resolvedPath);

    expect(resolved).toContain(path.join(rootDir, 'packages', 'a', 'src', 'index.ts'));
    expect(resolved).toContain(path.join(rootDir, 'packages', 'b', 'src', 'util.ts'));
  });
});
