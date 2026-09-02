import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { applyMemberNameUsage, stripSourceNoise, MEMBER_USAGE_SENTINEL } from '../../../src/analyzer/memberUsage';
import { buildGraphFromFileNodes } from '../../../src/analyzer/graphBuilder';
import { makeExportKey } from '../../../src/analyzer/dependencyGraph';
import { clearSourceCache } from '../../../src/analyzer/sourceCache';
import type { FileNode } from '../../../src/types';

describe('applyMemberNameUsage', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-')); clearSourceCache(); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const node = (filePath: string, exports: Array<{ name: string; kind: string }>): FileNode =>
    ({ filePath, imports: [], locals: [], exports: exports.map((e) => ({ ...e, isDefault: false, isReExport: false, line: 1, column: 0, isTypeOnly: false })) });

  it('marks a Java public method used when another file calls it by name', () => {
    const helper = path.join(dir, 'StringHelper.java'); const main = path.join(dir, 'Main.java');
    fs.writeFileSync(helper, 'public class StringHelper { public String capitalize(String s) {} public String unused() {} public static final String APP_NAME = "x"; }');
    fs.writeFileSync(main, 'public class Main { void run() { new StringHelper().capitalize("a"); System.out.println(StringHelper.APP_NAME); } }');
    const g = buildGraphFromFileNodes(new Map([[helper, node(helper, [{ name: 'StringHelper', kind: 'class' }, { name: 'capitalize', kind: 'method' }, { name: 'unused', kind: 'method' }, { name: 'APP_NAME', kind: 'constant' }])], [main, node(main, [])]]));
    applyMemberNameUsage(g);
    expect(g.exportUsages.get(makeExportKey(helper, 'capitalize'))?.has(MEMBER_USAGE_SENTINEL)).toBe(true);
    expect(g.exportUsages.get(makeExportKey(helper, 'APP_NAME'))?.has(MEMBER_USAGE_SENTINEL)).toBe(true);
    expect(g.exportUsages.get(makeExportKey(helper, 'unused'))?.size).toBe(0);
    expect(g.exportUsages.get(makeExportKey(helper, 'StringHelper'))?.size).toBe(0); // classes are not members
  });

  it('does not count same-file references and ignores TypeScript files', () => {
    const svc = path.join(dir, 'Svc.php'); const ts = path.join(dir, 'a.ts');
    fs.writeFileSync(svc, '<?php class Svc { public function a() { $this->b(); } public function b() {} }');
    fs.writeFileSync(ts, 'export const b = 1; obj.b();');
    const g = buildGraphFromFileNodes(new Map([[svc, node(svc, [{ name: 'a', kind: 'method' }, { name: 'b', kind: 'method' }])], [ts, node(ts, [{ name: 'b', kind: 'variable' }])]]));
    applyMemberNameUsage(g);
    expect(g.exportUsages.get(makeExportKey(svc, 'b'))?.size).toBe(0);
    expect(g.exportUsages.get(makeExportKey(ts, 'b'))?.size).toBe(0);
  });

  it('counts PHP callable strings ([Foo::class, "index"], "Foo@index", add_action)', () => {
    const ctl = path.join(dir, 'Ctl.php'); const routes = path.join(dir, 'routes.php');
    fs.writeFileSync(ctl, '<?php class Ctl { public function index() {} public function show() {} public function hook() {} }');
    fs.writeFileSync(routes, "<?php Route::get('/', [Ctl::class, 'index']); Route::get('/s', 'Ctl@show'); add_action('init', 'hook');");
    const g = buildGraphFromFileNodes(new Map([[ctl, node(ctl, [{ name: 'index', kind: 'method' }, { name: 'show', kind: 'method' }, { name: 'hook', kind: 'method' }])], [routes, node(routes, [])]]));
    applyMemberNameUsage(g);
    for (const n of ['index', 'show', 'hook']) expect(g.exportUsages.get(makeExportKey(ctl, n))?.size).toBe(1);
  });
  it('ignores references that appear only in comments', () => {
    const helper = path.join(dir, 'Helper.java'); const main = path.join(dir, 'Main.java');
    fs.writeFileSync(helper, 'public class Helper { public String capitalize(String s) {} public String other(String s) {} }');
    fs.writeFileSync(main, 'public class Main { /* also calls Helper.capitalize() */ void run() { // helper.capitalize()\n new Helper().other("a"); } }');
    const g = buildGraphFromFileNodes(new Map([[helper, node(helper, [{ name: 'capitalize', kind: 'method' }, { name: 'other', kind: 'method' }])], [main, node(main, [])]]));
    applyMemberNameUsage(g);
    expect(g.exportUsages.get(makeExportKey(helper, 'capitalize'))?.size).toBe(0);
    expect(g.exportUsages.get(makeExportKey(helper, 'other'))?.has(MEMBER_USAGE_SENTINEL)).toBe(true);
  });

  it('does not let a hash inside a PHP string swallow the rest of the line', () => {
    const ctl = path.join(dir, 'Theme.php'); const use = path.join(dir, 'use.php');
    fs.writeFileSync(ctl, '<?php class Theme { public function paint() {} }');
    fs.writeFileSync(use, "<?php $color = '#fff'; $t->paint(); # $t->ignored();");
    const g = buildGraphFromFileNodes(new Map([[ctl, node(ctl, [{ name: 'paint', kind: 'method' }])], [use, node(use, [])]]));
    applyMemberNameUsage(g);
    expect(g.exportUsages.get(makeExportKey(ctl, 'paint'))?.has(MEMBER_USAGE_SENTINEL)).toBe(true);
  });
});

describe('stripSourceNoise', () => {
  it('does not treat a # inside a PHP string as a comment', () => {
    expect(stripSourceNoise("<?php $color = '#fff'; $name = 'keepMe';", '/a.php', false))
      .toBe("<?php $color = ''; $name = '';");
  });

  it('preserves PHP 8 attributes while stripping real # comments', () => {
    expect(stripSourceNoise('#[Route] # gone\nkeep', '/a.php', false)).toBe('#[Route] \nkeep');
  });

  it('leaves # alone outside Python and PHP', () => {
    expect(stripSourceNoise('a # b', '/a.java', false)).toBe('a # b');
  });

  it('keeps string literals when asked', () => {
    expect(stripSourceNoise("$x->y(); // $x->z();", '/a.php', true)).toBe('$x->y(); ');
  });
});
