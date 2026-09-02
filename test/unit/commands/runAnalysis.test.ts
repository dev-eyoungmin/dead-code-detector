import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { runProjectAnalysis } from '../../../src/commands/runAnalysis';
import { DEFAULT_INCLUDE_PATTERNS, DEFAULT_EXCLUDE_PATTERNS } from '../../../src/constants';
const base = { include: DEFAULT_INCLUDE_PATTERNS, exclude: DEFAULT_EXCLUDE_PATTERNS, entryPoints: [], analyzeOnSave: false, reportFormat: 'json' as const, confidenceThreshold: 'low' as const, ignorePatterns: [], enabledLanguages: ['typescript', 'python', 'go', 'java', 'dart', 'php'] as const, entryPointDecorators: [], containerFiles: [], alwaysUsedPatterns: [] };
describe('runProjectAnalysis', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('auto-detects entry points, honours enabledLanguages and alwaysUsedPatterns', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"src/index.ts"}');
    fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src/index.ts'), "import { a } from './svc'; console.log(a);");
    fs.writeFileSync(path.join(dir, 'src/svc.ts'), 'export const a = 1; export const UserRepository = 2; export const dead = 3;');
    fs.writeFileSync(path.join(dir, 'ignored.py'), 'def orphan(): pass');
    const { result, entryPoints, fileCount } = await runProjectAnalysis(dir, { ...base, enabledLanguages: ['typescript'], alwaysUsedPatterns: ['*Repository'] });
    expect(entryPoints).toContain(path.join(dir, 'src/index.ts'));
    expect(fileCount).toBe(2);
    expect(result.unusedExports.map((e) => e.exportName)).toEqual(['dead']);
  });

  it('does not auto-detect entry points for languages disabled by enabledLanguages', async () => {
    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n\nfunc main() {}\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"src/index.ts"}');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/index.ts'), 'console.log(1);');
    const { entryPoints } = await runProjectAnalysis(dir, { ...base, enabledLanguages: ['typescript'] });
    expect(entryPoints).not.toContain(path.join(dir, 'main.go'));
    expect(entryPoints).toContain(path.join(dir, 'src/index.ts'));
  });

  it('excludes files whose language is disabled from analyzedFiles', async () => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/index.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n\nfunc main() {}\n');
    const { analyzedFiles } = await runProjectAnalysis(dir, { ...base, enabledLanguages: ['typescript'] });
    expect(analyzedFiles).toContain(path.join(dir, 'src/index.ts'));
    expect(analyzedFiles).not.toContain(path.join(dir, 'main.go'));
  });

  it('skips entry-point detection and analysis entirely when no files match', async () => {
    fs.writeFileSync(path.join(dir, 'ignored.py'), 'def orphan(): pass');
    const { result, fileCount, entryPoints, analyzedFiles } = await runProjectAnalysis(dir, {
      ...base,
      enabledLanguages: ['typescript'],
    });
    expect(fileCount).toBe(0);
    expect(entryPoints).toEqual([]);
    expect(analyzedFiles).toEqual([]);
    expect(result.unusedFiles).toEqual([]);
    expect(result.unusedExports).toEqual([]);
    expect(result.unusedLocals).toEqual([]);
  });
});
