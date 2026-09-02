import { describe, it, expect } from 'vitest';
import * as path from 'path';
import fg from 'fast-glob';
import { analyze } from '../../../../../src/analyzer';
import { PhpAnalyzer } from '../../../../../src/analyzer/languages/php/phpAnalyzer';
import { isPhpDIAttribute } from '../../../../../src/analyzer/decoratorDetector';
import { collectPhpExports } from '../../../../../src/analyzer/languages/php/phpExportCollector';

const fixtureDir = path.resolve(__dirname, '../../../../fixtures/php-laravel-project');
const symfonyFixtureDir = path.resolve(__dirname, '../../../../fixtures/php-symfony-project');

const names = (
  arr: Array<{ exportName?: string; symbolName?: string; filePath: string; confidence: string }>
): string[] => arr.map((x) => `${path.basename(x.filePath)}:${x.exportName ?? x.symbolName}:${x.confidence}`);

describe('isPhpDIAttribute', () => {
  it('recognises built-in PHP DI attribute names', () => {
    expect(isPhpDIAttribute('AsService')).toBe(true);
    expect(isPhpDIAttribute('Injectable')).toBe(true);
    expect(isPhpDIAttribute('Autowire')).toBe(true);
  });

  it('rejects non-DI attribute names', () => {
    expect(isPhpDIAttribute('Route')).toBe(false);
  });

  it('honours the user-configured list', () => {
    expect(isPhpDIAttribute('MyBinding')).toBe(false);
    expect(isPhpDIAttribute('MyBinding', ['MyBinding'])).toBe(true);
  });
});

describe('PhpAnalyzer end-to-end on the Laravel fixture', () => {
  it('reports only genuinely dead PHP code', async () => {
    const files = await fg('**/*.php', { cwd: fixtureDir, absolute: true, onlyFiles: true });
    const entryPoints = await new PhpAnalyzer().findEntryPoints(fixtureDir);

    const r = await analyze({ files, rootDir: fixtureDir, entryPoints });

    expect(r.unusedFiles.map((f) => path.basename(f.filePath))).toEqual(['Orphan.php']);

    const exps = names(r.unusedExports);
    expect(exps).toContain('UserController.php:orphanAction:medium');
    expect(exps).toContain('User.php:unusedModelMethod:medium');
    expect(exps).toContain('Orphan.php:Orphan:medium');
    expect(exps).toContain('User.php:scopeActive:low');
    expect(exps).toContain('User.php:getFullNameAttribute:low');
    expect(exps).toContain('Mailer.php:__toString:low');
    for (const ok of [
      'index',
      'legacy',
      'send',
      'query',
      'boot',
      'register',
      'AppServiceProvider',
      'UserController',
      'User',
      'Mailer',
    ]) {
      expect(exps.find((e) => e.includes(`:${ok}:`))).toBeUndefined();
    }

    // `Route::apiResource('posts', PostController::class)` maps the seven RESTful
    // actions without ever naming them; none of them may be reported.
    for (const restful of ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy']) {
      expect(exps.find((e) => e.includes(`:${restful}:`))).toBeUndefined();
    }
    // ... but a non-RESTful action on the very same resource controller still is,
    // so the resource-route rule cannot be silently suppressing the whole file.
    expect(exps).toContain('PostController.php:orphanRestAction:medium');

    const locals = names(r.unusedLocals);
    // PHP member reference counting is regex based over source whose strings are
    // blanked, so it cannot see `call_user_func([$this, 'x'])`; a private method
    // is therefore capped at 'medium' and never claims the top tier.
    expect(locals).toContain('Mailer.php:deadPrivate:medium');
    expect(locals).toContain('UserController.php:helper:medium');
    expect(locals.find((l) => l.includes(':format:'))).toBeUndefined();
  });
});

describe('PHP method-level framework attributes', () => {
  it('collects attributed members and marks them as entry-point decorated', () => {
    const src = [
      '<?php',
      '',
      'class UserController',
      '{',
      "    #[Route('/users', name: 'app_user_list')]",
      '    public function list(): Response',
      '    {',
      '    }',
      '',
      '    #[Autowire]',
      '    public function setMailer($m)',
      '    {',
      '    }',
      '',
      '    public function plain()',
      '    {',
      '    }',
      '}',
    ].join('\n');

    const exports = collectPhpExports(src, '/p/UserController.php');
    const byName = Object.fromEntries(exports.map((e) => [e.name, e]));

    // Before this fix an attribute line made MEMBER_RE fail, so the member was
    // silently dropped from the export list entirely.
    expect(byName.list).toBeDefined();
    expect(byName.list.kind).toBe('method');
    expect(byName.list.line).toBe(6);
    expect(byName.list.isEntryPointDecorated).toBe(true);

    expect(byName.setMailer?.isEntryPointDecorated).toBe(true);

    expect(byName.plain).toBeDefined();
    expect(byName.plain.isEntryPointDecorated).toBeUndefined();
    // The line-number defect affected unattributed members too: a chunk starts at
    // the previous member's closing brace, so `plain` used to resolve to line 13.
    expect(byName.plain.line).toBe(15);
  });
});

describe('PhpAnalyzer end-to-end on the Symfony fixture', () => {
  it('does not report routed controller actions at the default threshold', async () => {
    const files = await fg('**/*.php', { cwd: symfonyFixtureDir, absolute: true, onlyFiles: true });
    const entryPoints = await new PhpAnalyzer().findEntryPoints(symfonyFixtureDir);

    const r = await analyze({ files, rootDir: symfonyFixtureDir, entryPoints });

    const exps = names(r.unusedExports);
    // Symfony action names are arbitrary, so no conventional list can cover them:
    // the method-level #[Route] attribute is what keeps them off the report.
    expect(exps).toContain('UserController.php:list:low');
    expect(exps).toContain('UserController.php:detail:low');
    // An un-routed public method in the same entry-point controller is still reported,
    // so the attribute rule is not blanket-suppressing the file.
    expect(exps).toContain('UserController.php:notRoutedAction:medium');
    // A service outside the entry-point directories is unaffected.
    expect(exps).toContain('Mailer.php:neverCalled:medium');
    expect(exps.find((e) => e.includes(':send:'))).toBeUndefined();
    // Doctrine/Validator attributes are not in any recognised list, but their
    // presence still means something outside the call graph reads the property
    // (the ORM reflectively, or a Twig template the analyzer never scans).
    expect(exps).toContain('User.php:email:low');
    // An unattributed property on the very same entity is still reported in full,
    // so the weak signal is not blanket-suppressing the file.
    expect(exps).toContain('User.php:plainProperty:medium');
  });
});

describe('PHP unrecognised member attributes', () => {
  it('treats an unrecognised attribute as a weak liveness signal', () => {
    const src = [
      '<?php',
      '',
      'class Entity',
      '{',
      "    #[ORM\\Column(type: 'string')]",
      '    public $email;',
      '',
      '    public $plainProperty;',
      '}',
    ].join('\n');

    const byName = Object.fromEntries(
      collectPhpExports(src, '/p/Entity.php').map((e) => [e.name, e])
    );

    expect(byName.email.isEntryPointDecorated).toBe(true);
    expect(byName.plainProperty.isEntryPointDecorated).toBeUndefined();
  });
});

describe('PHP class-level attribute extraction', () => {
  it('handles grouped, same-line and multi-line attributes above a class', () => {
    const src = [
      '<?php',
      '',
      '#[Foo,',
      '  AsController]',
      'class Grouped {}',
      '',
      "#[AsCommand(name: 'x')] class SameLine {}",
      '',
      '#[Route(',
      "    path: '/x',",
      "    methods: ['GET']",
      ')]',
      'class MultiLine {}',
      '',
      '#[Deprecated]',
      'class Unrecognised {}',
      '',
      'class Plain {}',
    ].join('\n');

    const byName = Object.fromEntries(
      collectPhpExports(src, '/p/attrs.php').map((e) => [e.name, e])
    );

    expect(byName.Grouped.isEntryPointDecorated).toBe(true);
    expect(byName.SameLine.isEntryPointDecorated).toBe(true);
    expect(byName.MultiLine.isEntryPointDecorated).toBe(true);
    // Class-level extraction stays strict: only recognised attributes count.
    expect(byName.Unrecognised.isEntryPointDecorated).toBeUndefined();
    expect(byName.Plain.isEntryPointDecorated).toBeUndefined();
  });
});
