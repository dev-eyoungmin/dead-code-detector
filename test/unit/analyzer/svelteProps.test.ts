import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectUnusedExports } from '../../../src/analyzer/unusedExportDetector';
import type { DependencyGraph } from '../../../src/types';

function graphWithExport(
  filePath: string,
  exportInfo: { name: string; kind: string }
): DependencyGraph {
  return {
    files: new Map([
      [
        filePath,
        {
          filePath,
          imports: [],
          exports: [
            {
              name: exportInfo.name,
              line: 1,
              column: 0,
              isDefault: false,
              isReExport: false,
              isTypeOnly: false,
              kind: exportInfo.kind,
            },
          ],
          locals: [],
        },
      ],
    ]),
    exportUsages: new Map(),
  } as unknown as DependencyGraph;
}

describe('unusedExportDetector - Svelte component props', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-props-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('gives low confidence to `export let prop` in a .svelte file', () => {
    const file = path.join(tempDir, 'Button.svelte');
    fs.writeFileSync(file, '<script>export let label;</script>\n<button>{label}</button>');

    const results = detectUnusedExports(graphWithExport(file, { name: 'label', kind: 'variable' }), []);

    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('still reports non-variable .svelte exports at the normal confidence', () => {
    const file = path.join(tempDir, 'helpers.svelte');
    fs.writeFileSync(file, '<script context="module">export function format() {}</script>');

    const results = detectUnusedExports(graphWithExport(file, { name: 'format', kind: 'function' }), []);

    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });
});
