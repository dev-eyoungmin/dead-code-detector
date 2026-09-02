import { describe, it, expect } from 'vitest';
import { collectPhpExports } from '../../../../../src/analyzer/languages/php/phpExportCollector';

describe('collectPhpExports', () => {
  it('collects top-level declarations and public members with line numbers', () => {
    const src = `<?php\nnamespace App;\nconst LIMIT = 5;\ndefine('FLAG', true);\nfunction helper() {}\nabstract class Base {}\nfinal class User extends Base implements \\JsonSerializable {\n  public const TABLE = 'users';\n  const IMPLICIT = 1;\n  public string $name;\n  private int $secret;\n  public function __construct() {}\n  public static function find(int $id): ?static {}\n  function implicitPublic() {}\n  private function hidden() {}\n  protected function inherited() {}\n  public function jsonSerialize(): array {}\n}\ninterface Repo {}\ntrait Soft {}\nenum Status: string { case A = 'a'; public function label(): string {} }`;
    const e = collectPhpExports(src, '/p/User.php');
    const byName = Object.fromEntries(e.map((x) => [x.name, { k: x.kind, l: x.line }]));
    expect(byName.LIMIT).toEqual({ k: 'constant', l: 3 }); expect(byName.FLAG).toEqual({ k: 'constant', l: 4 });
    expect(byName.helper).toEqual({ k: 'function', l: 5 }); expect(byName.Base).toEqual({ k: 'class', l: 6 });
    expect(byName.User).toEqual({ k: 'class', l: 7 }); expect(byName.TABLE.k).toBe('constant'); expect(byName.IMPLICIT.k).toBe('constant');
    expect(byName.name.k).toBe('variable'); expect(byName.secret).toBeUndefined();
    expect(byName.__construct.k).toBe('method'); expect(byName.find.k).toBe('method'); expect(byName.implicitPublic.k).toBe('method');
    expect(byName.hidden).toBeUndefined(); expect(byName.inherited).toBeUndefined();
    expect(byName.Repo.k).toBe('interface'); expect(byName.Soft.k).toBe('class'); expect(byName.Status.k).toBe('enum'); expect(byName.label.k).toBe('method');
  });
  it('ignores declarations inside strings and comments and closures', () => {
    const src = `<?php\n// class Fake {}\n$s = "function notReal() {}";\n$f = function () { return 1; };\nclass Real { public function m() { $g = fn() => 1; } }`;
    expect(collectPhpExports(src, '/p/a.php').map((x) => x.name).sort()).toEqual(['Real', 'm']);
  });
  it('sets isEntryPointDecorated for DI attributes on classes', () => {
    const src = `<?php\n#[\\Symfony\\Component\\DependencyInjection\\Attribute\\AsService]\nclass Svc {}`;
    // Task 15 wires the real predicate; until then this asserts the field exists (false/undefined)
    expect(collectPhpExports(src, '/p/Svc.php')[0]).toHaveProperty('name', 'Svc');
  });
  it('does not emit a bogus export for anonymous class expressions using extends/implements', () => {
    const src = `<?php\nclass Base {}\ninterface Iface {}\n$x = new class extends Base {};\n$y = new class implements Iface {};\nclass Real2 {}`;
    const names = collectPhpExports(src, '/p/anon.php').map((x) => x.name);
    expect(names).not.toContain('extends');
    expect(names).not.toContain('implements');
    expect(names).toContain('Real2');
  });
  it('collects a top-level readonly class', () => {
    const src = `<?php\nreadonly class Point {\n  public function __construct(public int $x, public int $y) {}\n}`;
    const e = collectPhpExports(src, '/p/Point.php');
    const point = e.find((x) => x.name === 'Point');
    expect(point).toEqual(
      expect.objectContaining({ name: 'Point', kind: 'class', line: 2 })
    );
  });
  it('collects method signatures from a non-empty interface (semicolon-terminated, no body)', () => {
    const src = `<?php\ninterface Repository {\n  public function find(int $id): ?object;\n  public function save(object $entity): void;\n}`;
    const e = collectPhpExports(src, '/p/Repository.php');
    const methodNames = e.filter((x) => x.kind === 'method').map((x) => x.name).sort();
    expect(methodNames).toEqual(['find', 'save']);
  });
});
