import { describe, it, expect } from 'vitest';
import type { FileNode, ImportInfo, ExportInfo } from '../../../src/types';
import { buildGraphFromFileNodes, markAllExportsUsed } from '../../../src/analyzer/graphBuilder';
import { makeExportKey } from '../../../src/analyzer/dependencyGraph';

const exp = (name: string, extra: Partial<ExportInfo> = {}): ExportInfo =>
  ({ name, isDefault: false, isReExport: false, line: 1, column: 0, kind: 'variable', isTypeOnly: false, ...extra });
const imp = (resolvedPath: string, names: string[], extra: Partial<ImportInfo> = {}): ImportInfo => ({
  source: resolvedPath, resolvedPath, isNamespaceImport: false, isDynamicImport: false, isTypeOnly: false,
  specifiers: names.map((n) => ({ name: n, isDefault: n === 'default', isNamespace: n === '*' })), ...extra,
});
const node = (filePath: string, imports: ImportInfo[], exports: ExportInfo[]): FileNode => ({ filePath, imports, exports, locals: [] });
const usages = (g: ReturnType<typeof buildGraphFromFileNodes>, f: string, n: string) => g.exportUsages.get(makeExportKey(f, n))?.size ?? 0;

describe('buildGraphFromFileNodes', () => {
  const A = '/p/a.ts', B = '/p/barrel.ts', X = '/p/x.ts', Y = '/p/y.ts';

  it('export * creates an edge but marks no export used', () => {
    const fm = new Map([
      [B, node(B, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('*', { isReExport: true, reExportSource: X })])],
      [X, node(X, [], [exp('deadA'), exp('deadB')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(g.inboundEdges.get(X)?.has(B)).toBe(true);
    expect(usages(g, X, 'deadA')).toBe(0);
    expect(usages(g, X, 'deadB')).toBe(0);
  });

  it('named import through a star chain marks only that export used', () => {
    const fm = new Map([
      [A, node(A, [imp(B, ['used'])], [])],
      [B, node(B, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('*', { isReExport: true, reExportSource: X })])],
      [X, node(X, [], [exp('used'), exp('dead')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(usages(g, X, 'used')).toBe(1);
    expect(usages(g, X, 'dead')).toBe(0);
  });

  it('namespace import of a barrel propagates through star re-exports', () => {
    const fm = new Map([
      [A, node(A, [imp(B, ['*'], { isNamespaceImport: true })], [])],
      [B, node(B, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('*', { isReExport: true, reExportSource: X })])],
      [X, node(X, [imp(Y, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('a'), exp('*', { isReExport: true, reExportSource: Y })])],
      [Y, node(Y, [], [exp('deep')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(usages(g, X, 'a')).toBe(1);
    expect(usages(g, Y, 'deep')).toBe(1);
  });

  it('glob imports add edges and namespace usage to every matching file', () => {
    const fm = new Map([
      [A, node(A, [{ ...imp('/p/locales', []), globPattern: '/p/locales/**' }], [])],
      ['/p/locales/en.ts', node('/p/locales/en.ts', [], [exp('default', { isDefault: true })])],
      ['/p/other.ts', node('/p/other.ts', [], [exp('o')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(g.inboundEdges.get('/p/locales/en.ts')?.has(A)).toBe(true);
    expect(usages(g, '/p/locales/en.ts', 'default')).toBe(1);
    expect(usages(g, '/p/other.ts', 'o')).toBe(0);
  });

  it('container files mark all exports of everything they import as used', () => {
    const fm = new Map([
      [A, node(A, [imp(X, ['deadA'])], [])],
      [X, node(X, [], [exp('deadA'), exp('deadB')])],
    ]);
    const g = buildGraphFromFileNodes(fm, { containerFilePaths: new Set([A]) });
    expect(usages(g, X, 'deadB')).toBe(1);
  });

  it('markAllExportsUsed is idempotent on cycles', () => {
    const fm = new Map([
      [X, node(X, [imp(Y, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('x'), exp('*', { isReExport: true, reExportSource: Y })])],
      [Y, node(Y, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('y'), exp('*', { isReExport: true, reExportSource: X })])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    markAllExportsUsed(g, X, A);
    expect(usages(g, X, 'x')).toBe(1);
    expect(usages(g, Y, 'y')).toBe(1);
  });
});
