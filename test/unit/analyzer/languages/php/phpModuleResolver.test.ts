import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseNamespace,
  parseUseStatements,
  buildClassIndex,
  loadComposerAutoload,
  resolveFqcn,
  resolveClassReference,
  resolveInclude,
} from '../../../../../src/analyzer/languages/php/phpModuleResolver';

describe('phpModuleResolver', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'php-resolver-test-')));
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

  describe('parseNamespace / parseUseStatements', () => {
    it('parses namespace and grouped, aliased, function and const uses', () => {
      const src = `<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nuse App\\Services\\{Mailer, Payment as Pay};\nuse function App\\Helpers\\fmt;\nuse const App\\Consts\\LIMIT;`;
      expect(parseNamespace(src)).toBe('App\\Http');
      const u = parseUseStatements(src);
      expect(u.classes.get('User')).toBe('App\\Models\\User');
      expect(u.classes.get('Pay')).toBe('App\\Services\\Payment');
      expect(u.classes.get('Mailer')).toBe('App\\Services\\Mailer');
      expect(u.functions.get('fmt')).toBe('App\\Helpers\\fmt');
      expect(u.consts.get('LIMIT')).toBe('App\\Consts\\LIMIT');
    });

    it('ignores trait-use adaptation blocks inside a class body but still parses a normal use import', () => {
      const src = `<?php\nnamespace App;\nuse App\\Models\\Thing;\nclass Foo {\n    use TraitA, TraitB {\n        TraitA::foo insteadof TraitB;\n        TraitB::bar as protected baz;\n    }\n}`;
      const u = parseUseStatements(src);
      expect(u.classes.get('Thing')).toBe('App\\Models\\Thing');
      expect(u.classes.has('TraitA')).toBe(false);
      expect(u.classes.has('TraitB')).toBe(false);
      for (const value of u.classes.values()) {
        expect(value).not.toContain('::');
        expect(value).not.toContain('{');
      }
    });
  });

  describe('buildClassIndex / resolveFqcn', () => {
    it('indexes classes, interfaces, traits, enums and functions by FQCN (case-insensitive)', () => {
      const f = w(
        'src/Models/User.php',
        '<?php\nnamespace App\\Models;\nclass User {}\ninterface HasName {}\ntrait Soft {}\nenum Status: string {}\nfunction helper() {}'
      );
      const idx = buildClassIndex([f]);
      for (const n of [
        'App\\Models\\User',
        'app\\models\\hasname',
        'App\\Models\\Soft',
        'App\\Models\\Status',
        'App\\Models\\helper',
      ]) {
        expect(idx.get(n.toLowerCase())).toBe(f);
      }
    });

    it('does not index PHP 7 anonymous classes as top-level declarations', () => {
      const f = w(
        'src/App.php',
        '<?php\nnamespace App;\n$a = new class extends Foo {};\n$b = new class implements Bar {};\nclass RealClass {}'
      );
      const idx = buildClassIndex([f]);
      expect(idx.get('app\\extends')).toBeUndefined();
      expect(idx.get('app\\implements')).toBeUndefined();
      expect(idx.get('app\\realclass')).toBe(f);
    });

    it('falls back to composer PSR-4 for files not in the index', () => {
      w('composer.json', '{"autoload":{"psr-4":{"App\\\\":"app/","Lib\\\\":["lib/src/"]}}}');
      const target = w('app/Http/Kernel.php', '<?php');
      const lib = w('lib/src/Tool.php', '<?php');
      const ctx = { index: new Map(), autoload: loadComposerAutoload(dir) };
      expect(resolveFqcn('App\\Http\\Kernel', ctx)).toBe(target);
      expect(resolveFqcn('Lib\\Tool', ctx)).toBe(lib);
      expect(resolveFqcn('Nope\\X', ctx)).toBeUndefined();
    });
  });

  describe('resolveClassReference', () => {
    it('resolves fully-qualified, aliased, same-namespace and global names', () => {
      const user = w('src/Models/User.php', '<?php namespace App\\Models; class User {}');
      const repo = w('src/Http/UserRepo.php', '<?php namespace App\\Http; class UserRepo {}');
      const glob = w('src/Legacy.php', '<?php class Legacy {}');
      const ctx = { index: buildClassIndex([user, repo, glob]), autoload: loadComposerAutoload(dir) };
      const uses = parseUseStatements('<?php use App\\Models\\User as U;');
      expect(resolveClassReference('\\App\\Models\\User', 'App\\Http', uses, ctx)).toBe(user);
      expect(resolveClassReference('U', 'App\\Http', uses, ctx)).toBe(user);
      expect(resolveClassReference('UserRepo', 'App\\Http', uses, ctx)).toBe(repo);
      expect(resolveClassReference('Legacy', 'App\\Http', uses, ctx)).toBe(glob);
      expect(resolveClassReference('string', 'App\\Http', uses, ctx)).toBeUndefined();
    });
  });

  describe('resolveInclude', () => {
    it('resolves relative, __DIR__ and dirname(__FILE__) forms', () => {
      const inc = w('lib/helpers.php', '<?php');
      const from = w('lib/app.php', '<?php');
      expect(resolveInclude("'helpers.php'", from)).toBe(inc);
      expect(resolveInclude("__DIR__ . '/helpers.php'", from)).toBe(inc);
      expect(resolveInclude("dirname(__FILE__) . '/helpers.php'", from)).toBe(inc);
      expect(resolveInclude("dirname(__DIR__) . '/lib/helpers.php'", from)).toBe(inc);
      expect(resolveInclude("$base . '/x.php'", from)).toBeUndefined();
    });
  });
});
