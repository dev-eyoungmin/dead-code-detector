import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { collectPhpImports } from '../../../../../src/analyzer/languages/php/phpImportCollector';
import {
  buildClassIndex,
  loadComposerAutoload,
} from '../../../../../src/analyzer/languages/php/phpModuleResolver';

describe('collectPhpImports', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'php-imports-test-')));
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function w(rel: string, content: string): string {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return full;
  }

  it('resolves use statements, inline FQCNs, same-namespace and typed references, with member specifiers', () => {
    const user = w(
      'app/Models/User.php',
      '<?php namespace App\\Models; class User { public static function find() {} public function save() {} const TABLE = "u"; }'
    );
    const post = w('app/Models/Post.php', '<?php namespace App\\Models; class Post {}');
    const mail = w(
      'app/Services/Mailer.php',
      '<?php namespace App\\Services; class Mailer { public function send() {} }'
    );
    const base = w('app/Http/Controller.php', '<?php namespace App\\Http; class Controller {}');
    const ctl = w(
      'app/Http/UserController.php',
      `<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nuse App\\Services\\Mailer as M;\nclass UserController extends Controller {\n  public function show(int $id, M $mailer): \\App\\Models\\Post {\n    $u = User::find($id); $u->save(); echo User::TABLE; $mailer->send();\n    return new \\App\\Models\\Post();\n  }\n}`
    );
    const ctx = {
      index: buildClassIndex([user, post, mail, base, ctl]),
      autoload: loadComposerAutoload(dir),
    };
    const imps = collectPhpImports(fs.readFileSync(ctl, 'utf-8'), ctl, ctx);
    const byPath = Object.fromEntries(imps.map((i) => [i.resolvedPath, i.specifiers.map((s) => s.name).sort()]));
    expect(byPath[user]).toEqual(['TABLE', 'User', 'find', 'save', 'send']); // member names are name-based within the file
    expect(byPath[mail]).toEqual(['Mailer', 'TABLE', 'find', 'save', 'send']);
    expect(byPath[post]).toEqual(['Post', 'TABLE', 'find', 'save', 'send']);
    expect(byPath[base]).toEqual(['Controller', 'TABLE', 'find', 'save', 'send']);
  });

  it('treats require/include as namespace imports and ignores unresolvable ones', () => {
    const h = w('lib/helpers.php', '<?php function x() {}');
    const a = w(
      'lib/app.php',
      "<?php require_once __DIR__ . '/helpers.php'; include 'missing.php'; require $dyn;"
    );
    const imps = collectPhpImports(fs.readFileSync(a, 'utf-8'), a, {
      index: new Map(),
      autoload: loadComposerAutoload(dir),
    });
    expect(imps).toHaveLength(1);
    expect(imps[0].resolvedPath).toBe(h);
    expect(imps[0].isNamespaceImport).toBe(true);
  });

  it('collects every name of an extends list without swallowing the implements clause', () => {
    const bar = w('src/Bar.php', '<?php namespace N; interface Bar {}');
    const baz = w('src/Baz.php', '<?php namespace N; interface Baz {}');
    const base = w('src/Base.php', '<?php namespace N; class Base {}');
    const foo = w('src/Foo.php', '<?php namespace N; interface Foo extends Bar, Baz {}');
    const sub = w('src/Sub.php', '<?php namespace N; class Sub extends Base implements Baz {}');
    const ctx = {
      index: buildClassIndex([bar, baz, base, foo, sub]),
      autoload: loadComposerAutoload(dir),
    };
    const fooPaths = collectPhpImports(fs.readFileSync(foo, 'utf-8'), foo, ctx)
      .map((i) => i.resolvedPath)
      .sort();
    expect(fooPaths).toEqual([bar, baz].sort());
    const subPaths = collectPhpImports(fs.readFileSync(sub, 'utf-8'), sub, ctx)
      .map((i) => i.resolvedPath)
      .sort();
    expect(subPaths).toEqual([base, baz].sort());
  });

  it('collects implements lists, typed properties and union-typed params and returns', () => {
    const ia = w('src/IA.php', '<?php namespace N; interface IA {}');
    const ib = w('src/IB.php', '<?php namespace N; interface IB {}');
    const prop = w('src/Prop.php', '<?php namespace N; class Prop {}');
    const x = w('src/X.php', '<?php namespace N; class X {}');
    const y = w('src/Y.php', '<?php namespace N; class Y {}');
    const impl = w(
      'src/Impl.php',
      `<?php\nnamespace N;\nclass Impl implements IA, IB {\n  private Prop $p;\n  public function pick(X|Y $c): X|Y { return $c; }\n}`
    );
    const ctx = {
      index: buildClassIndex([ia, ib, prop, x, y, impl]),
      autoload: loadComposerAutoload(dir),
    };
    const paths = collectPhpImports(fs.readFileSync(impl, 'utf-8'), impl, ctx)
      .map((i) => i.resolvedPath)
      .sort();
    expect(paths).toEqual([ia, ib, prop, x, y].sort());
  });

  it('never emits an import that resolves to the file itself', () => {
    const a = w(
      'src/A.php',
      '<?php namespace N; class A { public function f(): A { return new A(); } }'
    );
    const ctx = { index: buildClassIndex([a]), autoload: loadComposerAutoload(dir) };
    expect(collectPhpImports(fs.readFileSync(a, 'utf-8'), a, ctx)).toEqual([]);
  });

  it('collects attribute, instanceof, catch and trait-use references', () => {
    const attr = w('src/Attr/Route.php', '<?php namespace Attr; class Route {}');
    const ex = w('src/MyEx.php', '<?php class MyEx extends \\Exception {}');
    const tr = w('src/Tr.php', '<?php trait Tr {}');
    const a = w(
      'src/A.php',
      `<?php\nuse Attr\\Route;\nclass A { use Tr; #[Route('/x')] public function f($o) { if ($o instanceof MyEx) {} try {} catch (MyEx $e) {} } }`
    );
    const ctx = { index: buildClassIndex([attr, ex, tr, a]), autoload: loadComposerAutoload(dir) };
    const paths = collectPhpImports(fs.readFileSync(a, 'utf-8'), a, ctx)
      .map((i) => i.resolvedPath)
      .sort();
    expect(paths).toEqual([attr, ex, tr].sort());
  });
});
