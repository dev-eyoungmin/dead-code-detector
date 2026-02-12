import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectUnusedExports } from '../../../src/analyzer/unusedExportDetector';
import type { DependencyGraph } from '../../../src/types';

/**
 * Creates a minimal DependencyGraph with one file that has a single unused export.
 */
function createGraphWithExport(
  filePath: string,
  exportInfo: {
    name: string;
    line: number;
    column: number;
    isDefault: boolean;
    isReExport: boolean;
    isTypeOnly: boolean;
    kind: string;
  }
): DependencyGraph {
  return {
    files: new Map([
      [
        filePath,
        {
          filePath,
          imports: [],
          exports: [exportInfo],
          locals: [],
        },
      ],
    ]),
    exportUsages: new Map(),
  };
}

describe('unusedExportDetector - React pattern heuristics', () => {
  let tempDir: string;
  let tempFile: string;

  // Create a temp file so readFileSync works (for ignore comment check)
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-export-test-'));
    tempFile = path.join(tempDir, 'Component.tsx');
    fs.writeFileSync(tempFile, 'export default function Component() {}');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence to React hook exports (use* pattern)', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'useAuth',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to useTheme hook', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'useTheme',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to HOC exports (with* function pattern)', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'withRouter',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should NOT assign low confidence to with* exports that are not functions', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'withPrefix',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign low confidence to Context exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'ThemeContext',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to Provider exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'AuthProvider',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to Consumer exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'ThemeConsumer',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to .jsx PascalCase default exports', () => {
    const jsxFile = path.join(tempDir, 'Button.jsx');
    fs.writeFileSync(jsxFile, 'export default function Button() {}');

    const graph = createGraphWithExport(jsxFile, {
      name: 'Button',
      line: 1,
      column: 0,
      isDefault: true,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign medium confidence to regular named function exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'regularFunction',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should not match lowercase use* as React hook', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'useless',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });
});
