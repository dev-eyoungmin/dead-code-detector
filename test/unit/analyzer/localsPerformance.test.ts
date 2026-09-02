import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { analyze, clearProgramCache } from '../../../src/analyzer';
import { collectLocals } from '../../../src/analyzer/localSymbolCollector';

/** 2000 functions x (1 parameter + 2 variables) = 6000 locals */
const EXPECTED_LOCALS = 6000;

function writeBigFile(dir: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 2000; i++) {
    lines.push(
      `export function f${i}(p${i}: number) { const a${i} = p${i} + 1; const b${i} = a${i} * 2; return b${i}; }`
    );
  }
  const big = path.join(dir, 'big.ts');
  fs.writeFileSync(big, lines.join('\n'));
  return big;
}

describe('local reference counting scales linearly', () => {
  it('analyses a 2000-function file in under 3 seconds', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
    try {
      const big = writeBigFile(dir);
      clearProgramCache();
      const t0 = Date.now();
      const r = await analyze({ files: [big], rootDir: dir, entryPoints: [big] });
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(r.totalLocalCount).toBe(EXPECTED_LOCALS);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collects locals of a 2000-function file in under 1.5 seconds', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-collect-'));
    try {
      const big = writeBigFile(dir);
      const program = ts.createProgram([big], {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        strict: true,
      });
      const sourceFile = program.getSourceFile(big)!;
      const checker = program.getTypeChecker();

      const t0 = Date.now();
      const locals = collectLocals(sourceFile, checker);
      const elapsed = Date.now() - t0;

      expect(locals).toHaveLength(EXPECTED_LOCALS);
      expect(elapsed).toBeLessThan(1500);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
