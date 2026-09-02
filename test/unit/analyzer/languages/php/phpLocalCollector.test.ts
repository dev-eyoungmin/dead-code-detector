import { describe, it, expect } from 'vitest';
import { collectPhpLocals } from '../../../../../src/analyzer/languages/php/phpLocalCollector';

describe('collectPhpLocals', () => {
  it('reports private members with reference counts', () => {
    const src = `<?php\nclass A {\n  private int $used = 1;\n  private $unusedProp;\n  private const SECRET = 'x';\n  private function helper() { return $this->used; }\n  private function dead() {}\n  public function run() { return $this->helper() . self::SECRET; }\n}`;
    const l = collectPhpLocals(src, new Set(['A', 'run']));
    const byName = Object.fromEntries(l.map((x) => [x.name, { r: x.references, k: x.kind }]));
    expect(byName.used).toEqual({ r: 1, k: 'field' }); expect(byName.unusedProp).toEqual({ r: 0, k: 'field' });
    expect(byName.SECRET).toEqual({ r: 1, k: 'constant' }); expect(byName.helper).toEqual({ r: 1, k: 'method' }); expect(byName.dead).toEqual({ r: 0, k: 'method' });
  });
  it('reports local variables that are assigned but never read', () => {
    const src = `<?php\nfunction f($p) {\n  $unused = 1;\n  $read = 2; echo $read;\n  $interp = 3; echo "v=$interp";\n  $compact = 4; return compact('compact');\n  $cb = function () use ($p) {}; $cb();\n  $_ignored = 5; $this->x = 6; $GLOBALS['a'] = 7;\n}`;
    const l = collectPhpLocals(src, new Set(['f']));
    expect(l.filter((x) => x.kind === 'variable').map((x) => [x.name, x.references])).toEqual([['unused', 0], ['read', 1], ['interp', 1], ['compact', 1], ['cb', 1]]);
  });
  it('does not report variables assigned in a loop head or foreach as unused when used in the body', () => {
    const src = `<?php\nfunction f($items) { foreach ($items as $k => $v) { echo $v; } for ($i = 0; $i < 2; $i++) {} }`;
    const l = collectPhpLocals(src, new Set());
    expect(l.find((x) => x.name === 'v')?.references).toBe(1);
    expect(l.find((x) => x.name === 'k')?.references).toBe(0);
    expect(l.find((x) => x.name === 'i')?.references).toBeGreaterThan(0);
  });
  it('credits every name in a multi-argument compact() call, not just the first', () => {
    const src = `<?php\nfunction f() { $a = 1; $b = 2; return compact('a', 'b'); }`;
    const l = collectPhpLocals(src, new Set(['f']));
    const byName = Object.fromEntries(l.map((x) => [x.name, x.references]));
    expect(byName.a).toBe(1);
    expect(byName.b).toBe(1);
  });
  it('recognizes by-reference foreach variables as declarations', () => {
    const deadSrc = `<?php\nfunction f($items) { foreach ($items as &$v) {} }`;
    const deadLocals = collectPhpLocals(deadSrc, new Set());
    expect(deadLocals.find((x) => x.name === 'v')?.references).toBe(0);

    const usedSrc = `<?php\nfunction f($items) { foreach ($items as &$v) {} echo $v; }`;
    const usedLocals = collectPhpLocals(usedSrc, new Set());
    expect(usedLocals.find((x) => x.name === 'v')?.references).toBe(1);
  });
  it('collects every name in a comma-separated private property list', () => {
    const src = `<?php\nclass A {\n  private $a, $b;\n  public function run() { return $this->a; }\n}`;
    const l = collectPhpLocals(src, new Set(['A', 'run']));
    const byName = Object.fromEntries(l.map((x) => [x.name, { r: x.references, k: x.kind }]));
    expect(byName.a).toEqual({ r: 1, k: 'field' });
    expect(byName.b).toEqual({ r: 0, k: 'field' });
  });
  it('does not let a PSR-12 promoted-property constructor list overrun into the body ($this must never be reported)', () => {
    const src = `<?php\nclass C {\n    public function __construct(\n        private readonly string $name,\n        private int $age\n    ) {\n        $this->log = 'ctor';\n    }\n}`;
    const l = collectPhpLocals(src, new Set(['C', '__construct']));
    expect(l.find((x) => x.name === 'this')).toBeUndefined();
    const byName = Object.fromEntries(l.map((x) => [x.name, { r: x.references, k: x.kind }]));
    expect(byName.name).toEqual({ r: 0, k: 'field' });
    expect(byName.age).toEqual({ r: 0, k: 'field' });
  });
});
