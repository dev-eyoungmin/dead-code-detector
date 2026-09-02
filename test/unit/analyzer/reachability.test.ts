import { describe, it, expect } from 'vitest';
import { computeReachable } from '../../../src/analyzer/reachability';
import { createEmptyGraph } from '../../../src/analyzer/graphBuilder';
import { detectUnusedExports } from '../../../src/analyzer/unusedExportDetector';
import { makeExportKey } from '../../../src/analyzer/exportKey';
import { MEMBER_USAGE_SENTINEL } from '../../../src/analyzer/memberUsage';
import type { DependencyGraph } from '../../../src/types';

function graphWithEdges(edges: Array<[string, string]>) {
  const g = createEmptyGraph();
  for (const [from, to] of edges) {
    for (const f of [from, to]) { if (!g.files.has(f)) g.files.set(f, { filePath: f, imports: [], exports: [], locals: [] }); g.inboundEdges.set(f, g.inboundEdges.get(f) ?? new Set()); g.outboundEdges.set(f, g.outboundEdges.get(f) ?? new Set()); }
    g.outboundEdges.get(from)!.add(to); g.inboundEdges.get(to)!.add(from);
  }
  return g;
}
describe('computeReachable', () => {
  it('returns the transitive closure from entry points', () => {
    const g = graphWithEdges([['/e.ts', '/a.ts'], ['/a.ts', '/b.ts'], ['/c.ts', '/d.ts'], ['/d.ts', '/c.ts']]);
    const r = computeReachable(g, ['/e.ts']);
    expect([...r].sort()).toEqual(['/a.ts', '/b.ts', '/e.ts']);
  });
  it('returns an empty set when there are no entry points', () => {
    expect(computeReachable(graphWithEdges([['/a.ts', '/b.ts']]), []).size).toBe(0);
  });
});

describe('reachability filtering in detectUnusedExports', () => {
  const addFile = (g: DependencyGraph, filePath: string, name: string, kind: string, users: string[]) => {
    g.files.set(filePath, {
      filePath,
      imports: [],
      locals: [],
      exports: [{ name, kind, isDefault: false, isReExport: false, line: 1, column: 0, isTypeOnly: false }],
    });
    g.inboundEdges.set(filePath, new Set());
    g.outboundEdges.set(filePath, new Set());
    g.exportUsages.set(makeExportKey(filePath, name), new Set(users));
  };

  const buildGraph = (): DependencyGraph => {
    const g = createEmptyGraph();
    // Only referenced by name from another file of the same language
    addFile(g, '/member.php', 'handle', 'method', [MEMBER_USAGE_SENTINEL]);
    // Only referenced from within its own file
    addFile(g, '/self.ts', 'helper', 'function', ['/self.ts']);
    // Only referenced from a file that is itself unreachable
    addFile(g, '/dead.ts', 'gone', 'function', ['/unreachable.ts']);
    return g;
  };

  it('keeps the member-usage sentinel and self-references alive', () => {
    const g = buildGraph();
    const results = detectUnusedExports(g, [], [], [], new Set(['/entry.ts']));
    const names = results.map((r) => r.exportName);

    expect(names).not.toContain('handle');
    expect(names).not.toContain('helper');
    expect(results.find((r) => r.exportName === 'gone')?.confidence).toBe('low');
  });

  it('lets alwaysUsedPatterns win over the dead-cluster branch', () => {
    const g = buildGraph();
    const results = detectUnusedExports(g, [], [], ['gone*'], new Set(['/entry.ts']));

    expect(results.map((r) => r.exportName)).not.toContain('gone');
  });
});
