import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { clearSourceCache } from '../../../../../src/analyzer/sourceCache';
import {
  detectPhpFrameworks,
  findPhpFrameworkEntryPoints,
  getPhpConventionalExports,
  matchesPhpConventionalPattern,
  PHP_MAGIC_METHODS,
} from '../../../../../src/analyzer/languages/php/phpFrameworkDetector';

describe('phpFrameworkDetector', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'php-framework-test-')));
    clearSourceCache();
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    clearSourceCache();
  });

  function w(rel: string, content: string): string {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    return full;
  }

  it('detects laravel/symfony from composer.json and wordpress from wp-config.php', () => {
    w('composer.json', '{"require":{"laravel/framework":"^11","symfony/framework-bundle":"^7"}}');
    w('wp-config.php', '<?php');
    expect(detectPhpFrameworks(dir).sort()).toEqual(['laravel', 'symfony', 'wordpress']);
  });

  it('detects wordpress from a Plugin Name header when there is no wp-config.php or wp-content dir', () => {
    // Standalone plugin repository: the project itself is the plugin, so it ships
    // without wp-config.php or a wp-content/ directory.
    w('my-plugin.php', '<?php\n/**\n * Plugin Name: My\n */');
    expect(detectPhpFrameworks(dir)).toEqual(['wordpress']);
  });

  it('does not detect wordpress when no header, wp-config.php, or wp-content dir is present', () => {
    w('my-plugin.php', '<?php\n\nfunction doThing() {}\n');
    expect(detectPhpFrameworks(dir)).toEqual([]);
  });

  it('does not misclassify a laravel project as wordpress from a stray Plugin Name comment', () => {
    w('composer.json', '{"require":{"laravel/framework":"^11"}}');
    w('some-file.php', '<?php\n/**\n * Plugin Name: Not Actually WordPress\n */');
    expect(detectPhpFrameworks(dir)).toEqual(['laravel']);
  });

  it('returns generic + laravel entry points', async () => {
    const idx = w('public/index.php', '');
    const route = w('routes/web.php', '');
    const ctl = w('app/Http/Controllers/UserController.php', '');
    const blade = w('resources/views/home.blade.php', '');
    const model = w('app/Models/User.php', '');
    const out = await findPhpFrameworkEntryPoints(dir, ['laravel']);
    for (const p of [idx, route, ctl, blade]) expect(out).toContain(p);
    expect(out).not.toContain(model);
  });

  it('returns symfony attribute-annotated files and wordpress plugin headers', async () => {
    const cmd = w('src/Command/Sync.php', '<?php #[AsCommand(name: "sync")] class Sync {}');
    const svc = w('src/Service/Plain.php', '<?php class Plain {}');
    const plugin = w('wp-content/plugins/my/my.php', '<?php\n/**\n * Plugin Name: My\n */');
    const other = w('wp-content/plugins/my/lib.php', '<?php');
    const out = await findPhpFrameworkEntryPoints(dir, ['symfony', 'wordpress']);
    expect(out).toContain(cmd);
    expect(out).not.toContain(svc);
    expect(out).toContain(plugin);
    expect(out).not.toContain(other);
  });

  it('merges conventional exports', () => {
    w('composer.json', '{"require":{"laravel/framework":"^11"}}');
    const c = getPhpConventionalExports(dir);
    expect(c).toContain('__construct');
    expect(c).toContain('boot');
    expect(c).not.toContain('getSubscribedEvents');
    expect(matchesPhpConventionalPattern('scopeActive')).toBe(true);
    expect(matchesPhpConventionalPattern('getFullNameAttribute')).toBe(true);
    expect(matchesPhpConventionalPattern('getUser')).toBe(false);
  });

  it('exposes PHP_MAGIC_METHODS including interface methods', () => {
    expect(PHP_MAGIC_METHODS).toContain('__construct');
    expect(PHP_MAGIC_METHODS).toContain('jsonSerialize');
    expect(PHP_MAGIC_METHODS).toContain('current');
  });
});
