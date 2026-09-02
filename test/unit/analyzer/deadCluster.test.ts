import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { analyze } from '../../../src/analyzer';
import { readSource } from '../../../src/analyzer/sourceCache';

describe('dead cluster detection', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = (n: string, c: string) => { const p = path.join(dir, n); fs.writeFileSync(p, c); return p; };

  it('reports mutually-importing files unreachable from the entry point at low confidence', async () => {
    const entry = w('index.ts', "import { used } from './used'; console.log(used);");
    const used = w('used.ts', 'export const used = 1;');
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; export const useA = () => a;");
    const r = await analyze({ files: [entry, used, a, b], rootDir: dir, entryPoints: [entry] });
    const files = r.unusedFiles.map((f) => [path.basename(f.filePath), f.confidence]);
    expect(files).toContainEqual(['a.ts', 'low']);
    expect(files).toContainEqual(['b.ts', 'low']);
    expect(files.map((f) => f[0])).not.toContain('used.ts');
    const exps = r.unusedExports.map((e) => [e.exportName, e.confidence]);
    expect(exps).toContainEqual(['a', 'low']);
    expect(exps).toContainEqual(['b', 'low']);
  });

  it('keeps today\'s behaviour when there are no entry points', async () => {
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; console.log(a);");
    const r = await analyze({ files: [a, b], rootDir: dir, entryPoints: [] });
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('treats star re-exports from an entry point as public API', async () => {
    const entry = w('index.ts', "export * from './api';");
    const api = w('api.ts', 'export const publicFn = 1;');
    const r = await analyze({ files: [entry, api], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('publicFn');
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('does not mark star re-export targets used without a consumer', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export * from './star'; export { used } from './named';");
    const star = w('star.ts', 'export const starDead = 1;');
    const named = w('named.ts', 'export const used = 1; export const alsoDead = 2;');
    const r = await analyze({ files: [entry, barrel, star, named], rootDir: dir, entryPoints: [entry] });
    const names = r.unusedExports.map((e) => e.exportName);
    expect(names).toContain('starDead');
    expect(names).toContain('alsoDead');
    expect(names).not.toContain('used');
  });

  it('ignores entry points that match no analysed file', async () => {
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; console.log(a);");
    const missing = path.join(dir, 'does-not-exist.ts');
    const r = await analyze({ files: [a, b], rootDir: dir, entryPoints: [missing] });
    // Identical to passing no entry points at all — an unmatched entry point
    // must never make the whole project look unreachable.
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('treats named re-exports from an entry point as public API', async () => {
    const entry = w('index.ts', "export { deepValue as shallow } from './barrel';");
    const barrel = w('barrel.ts', "export * from './deep';");
    const deep = w('deep.ts', 'export const deepValue = 1;');
    const r = await analyze({ files: [entry, barrel, deep], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('deepValue');
    expect(r.unusedFiles).toHaveLength(0);
  });
  it('does not retain source contents after the run', async () => {
    const a = w('a.ts', 'export const a = 1;');
    await analyze({ files: [a], rootDir: dir, entryPoints: [] });
    // The cache must not pin the codebase between analyses in a long-lived host.
    fs.rmSync(a);
    expect(readSource(a)).toBeNull();
  });
  it('skips dead-cluster analysis when only a tooling config matched', async () => {
    // Auto-detection found no source root, but the repo has a vitest.config.ts.
    // That config must not become the sole root of the application graph.
    const config = w('vitest.config.ts', 'export default { test: {} };');
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; console.log(a);");
    const r = await analyze({ files: [config, a, b], rootDir: dir, entryPoints: [] });
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('still finds dead clusters when a real entry point sits alongside a tooling config', async () => {
    const config = w('vitest.config.ts', 'export default { test: {} };');
    const entry = w('index.ts', "import { used } from './used'; console.log(used);");
    const used = w('used.ts', 'export const used = 1;');
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; console.log(a);");
    const r = await analyze({ files: [config, entry, used, a, b], rootDir: dir, entryPoints: [entry] });
    const names = r.unusedFiles.map((f) => path.basename(f.filePath));
    expect(names).toContain('a.ts');
    expect(names).toContain('b.ts');
    expect(names).not.toContain('used.ts');
  });

  it('does not apply reachability to a language that has no application entry point', async () => {
    // backend/ + frontend/ layout: TypeScript supplies a root, Python does not
    // (PythonAnalyzer.findEntryPoints only probes rootDir itself). The Python
    // subtree must behave exactly as it does with reachability switched off.
    const entry = w('index.ts', "import { used } from './used'; console.log(used);");
    const used = w('used.ts', 'export const used = 1;');
    fs.mkdirSync(path.join(dir, 'backend'));
    const service = w('backend/service.py', 'from backend.repo import fetch\n\ndef run():\n    return fetch()\n');
    const repo = w('backend/repo.py', 'from backend.service import run\n\ndef fetch():\n    return run\n');
    const r = await analyze({ files: [entry, used, service, repo], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => f.filePath)).not.toContain(service);
    expect(r.unusedFiles.map((f) => f.filePath)).not.toContain(repo);
    expect(r.unusedExports.filter((e) => e.filePath === service || e.filePath === repo)).toHaveLength(0);
  });

  it('still finds TypeScript dead clusters while another language opts out of reachability', async () => {
    const entry = w('index.ts', "import { used } from './used'; console.log(used);");
    const used = w('used.ts', 'export const used = 1;');
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; console.log(a);");
    fs.mkdirSync(path.join(dir, 'backend'));
    const service = w('backend/service.py', 'from backend.repo import fetch\n\ndef run():\n    return fetch()\n');
    const repo = w('backend/repo.py', 'from backend.service import run\n\ndef fetch():\n    return run\n');
    const r = await analyze({ files: [entry, used, a, b, service, repo], rootDir: dir, entryPoints: [entry] });
    const names = r.unusedFiles.map((f) => path.basename(f.filePath));
    expect(names).toContain('a.ts');
    expect(names).toContain('b.ts');
    expect(names).not.toContain('service.py');
    expect(names).not.toContain('repo.py');
  });

  it('keeps files pulled in by a tooling config alive once a real entry point exists', async () => {
    const config = w('vitest.config.ts', "import './setupTests'; export default { test: {} };");
    const setup = w('setupTests.ts', 'export const setup = 1;');
    const entry = w('index.ts', "import { used } from './used'; console.log(used);");
    const used = w('used.ts', 'export const used = 1;');
    const r = await analyze({ files: [config, setup, entry, used], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => path.basename(f.filePath))).not.toContain('setupTests.ts');
  });
  it('reports the declaration behind a dead named re-export', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export { used } from './target'; export { neverImported } from './target2';");
    const target = w('target.ts', 'export const used = 1;');
    const target2 = w('target2.ts', 'export const neverImported = 1;');
    const r = await analyze({ files: [entry, barrel, target, target2], rootDir: dir, entryPoints: [entry] });
    // Both the forwarding re-export and the declaration behind it are dead.
    expect(r.unusedExports.filter((e) => e.exportName === 'neverImported')).toHaveLength(2);
    expect(r.unusedFiles.map((f) => path.basename(f.filePath))).toContainEqual('target2.ts');
    // The live half of the same barrel is untouched.
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('used');
  });

  it('keeps the declaration alive through a chain of live named re-exports', async () => {
    const entry = w('index.ts', "import { deep } from './a'; console.log(deep);");
    const a = w('a.ts', "export { deep } from './b';");
    const b = w('b.ts', "export { deep } from './c';");
    const c = w('c.ts', 'export const deep = 1;');
    const r = await analyze({ files: [entry, a, b, c], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('deep');
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('keeps a named re-export that resolves through a star barrel alive', async () => {
    const entry = w('index.ts', "import { deepValue } from './mid'; console.log(deepValue);");
    const mid = w('mid.ts', "export { deepValue } from './barrel';");
    const barrel = w('barrel.ts', "export * from './deep';");
    const deep = w('deep.ts', 'export const deepValue = 1;');
    const r = await analyze({ files: [entry, mid, barrel, deep], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('deepValue');
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('keeps a file reachable when a real import coexists with a dead re-export', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; import { real } from './target'; console.log(used, real);");
    const barrel = w('barrel.ts', "export { used } from './used'; export { dead } from './target';");
    const used = w('used.ts', 'export const used = 1;');
    const target = w('target.ts', 'export const real = 1; export const dead = 2;');
    const r = await analyze({ files: [entry, barrel, used, target], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => path.basename(f.filePath))).not.toContain('target.ts');
    expect(r.unusedExports.map((e) => e.exportName)).toContain('dead');
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('real');
  });

  it('leaves star re-export edges alone', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export * from './star';");
    const star = w('star.ts', 'export const used = 1; export const starDead = 2;');
    const r = await analyze({ files: [entry, barrel, star], rootDir: dir, entryPoints: [entry] });
    const names = r.unusedExports.map((e) => e.exportName);
    expect(r.unusedFiles).toHaveLength(0); // star.ts stays reachable
    expect(names).toContain('starDead');
    expect(names).not.toContain('used');
  });
  it('does not suppress a genuine import that coexists with a dead re-export of the same name', async () => {
    // barrel.ts both consumes `Options` and forwards it. The forward is dead
    // (nothing imports Options from barrel), but the consumption is real, so
    // neither options.ts nor Options may be reported.
    const entry = w('index.ts', "import { make } from './barrel'; console.log(make);");
    const barrel = w('barrel.ts', [
      "import type { Options } from './options';",
      "export type { Options } from './options';",
      'export function make(o: Options): number { return o.n; }',
    ].join('\n'));
    const options = w('options.ts', 'export interface Options { n: number }');
    const r = await analyze({ files: [entry, barrel, options], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => f.filePath)).not.toContain(options);
    expect(r.unusedExports.filter((e) => e.filePath === options)).toHaveLength(0);
    // The barrel's own forward really is dead, and is still reported there.
    expect(r.unusedExports.map((e) => [path.basename(e.filePath), e.exportName]))
      .toContainEqual(['barrel.ts', 'Options']);
  });

  it('restores a re-export chain deeper than the old fixpoint cap', async () => {
    const depth = 24;
    const entry = w('index.ts', "import { deep } from './link0'; console.log(deep);");
    const links: string[] = [];
    for (let i = 0; i < depth; i++) {
      links.push(w(`link${i}.ts`, `export { deep } from './${i + 1 === depth ? 'leaf' : `link${i + 1}`}';`));
    }
    const leaf = w('leaf.ts', 'export const deep = 1;');
    // Reverse order is the adversarial case: propagateReExportUsage sweeps
    // `graph.files` in insertion order, so a leaf-first map restores only one
    // link per sweep and a small iteration cap truncates the chain.
    const files = [leaf, ...links.slice().reverse(), entry];
    const r = await analyze({ files, rootDir: dir, entryPoints: [entry] });
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('deep');
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('honours alwaysUsedPatterns when deciding whether a re-export is dead', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export { used } from './used'; export { publicApi } from './api';");
    const used = w('used.ts', 'export const used = 1;');
    const api = w('api.ts', 'export const publicApi = 1;');
    const r = await analyze({
      files: [entry, barrel, used, api],
      rootDir: dir,
      entryPoints: [entry],
      alwaysUsedPatterns: ['publicApi'],
    });
    // The user's opt-out must hold at file level too, not just for the export.
    expect(r.unusedFiles.map((f) => path.basename(f.filePath))).not.toContain('api.ts');
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('publicApi');
  });

  it('honours a line-level @dead-code-ignore on the re-export', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', [
      "export { used } from './used';",
      '// @dead-code-ignore',
      "export { keepMe } from './keep';",
    ].join('\n'));
    const used = w('used.ts', 'export const used = 1;');
    const keep = w('keep.ts', 'export const keepMe = 1;');
    const r = await analyze({ files: [entry, barrel, used, keep], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => path.basename(f.filePath))).not.toContain('keep.ts');
  });

  it('does not suppress edges out of a DI container file', async () => {
    const entry = w('index.ts', "import { boot } from './container'; console.log(boot);");
    const container = w('container.ts', [
      "export { registered } from './service';",
      'export const boot = 1;',
    ].join('\n'));
    const service = w('service.ts', 'export const registered = 1;');
    const r = await analyze({
      files: [entry, container, service],
      rootDir: dir,
      entryPoints: [entry],
      containerFiles: ['**/container.ts'],
    });
    // The container marks the service's exports used; the edge must agree.
    expect(r.unusedFiles.map((f) => f.filePath)).not.toContain(service);
    expect(r.unusedExports.filter((e) => e.filePath === service)).toHaveLength(0);
  });
  it('suppresses an aliased re-export edge in a plain (non-entry-point) barrel', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export { used } from './used'; export { orig as renamed } from './target';");
    const used = w('used.ts', 'export const used = 1;');
    const target = w('target.ts', 'export const orig = 1;');
    const r = await analyze({ files: [entry, barrel, used, target], rootDir: dir, entryPoints: [entry] });
    // Nothing imports `renamed` from the barrel, so the alias forwards nothing.
    expect(r.unusedFiles.map((f) => f.filePath)).toContain(target);
    expect(r.unusedExports.filter((e) => e.filePath === target && e.exportName === 'orig')).toHaveLength(1);
  });

  // Same original forwarded twice, once dead and once live. Both import records
  // carry `spec.name === 'Foo'`, so resolving by original name alone collapses
  // them onto whichever export comes first in source order.
  for (const deadFirst of [true, false]) {
    it(`keeps a file alive when one of two aliases of the same export is live (dead ${deadFirst ? 'first' : 'second'})`, async () => {
      const forwards = deadFirst
        ? "export { Foo } from './foo';\nexport { Foo as Legacy } from './foo';"
        : "export { Foo as Legacy } from './foo';\nexport { Foo } from './foo';";
      const entry = w('index.ts', "import { Legacy } from './barrel'; console.log(Legacy);");
      const barrel = w('barrel.ts', forwards);
      const foo = w('foo.ts', 'export const Foo = 1;');
      const r = await analyze({ files: [entry, barrel, foo], rootDir: dir, entryPoints: [entry] });
      expect(r.unusedFiles.map((f) => f.filePath)).not.toContain(foo);
      expect(r.unusedExports.filter((e) => e.filePath === foo)).toHaveLength(0);
      // The unaliased forward really is dead and is still reported on the barrel.
      expect(r.unusedExports.map((e) => [path.basename(e.filePath), e.exportName]))
        .toContainEqual(['barrel.ts', 'Foo']);
    });
  }

  it('does not exempt a framework conventional name from edge suppression', async () => {
    // `default` is a conventional export for Next.js/Storybook/Vue/Nuxt. A dead
    // `export { default } from './x'` barrel edge must still be suppressed.
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export { used } from './used'; export { default } from './page';");
    const used = w('used.ts', 'export const used = 1;');
    const page = w('page.ts', 'export default function Page(): number { return 1; }');
    const r = await analyze({ files: [entry, barrel, used, page], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => f.filePath)).toContain(page);
  });

  it('honours a file-level @dead-code-ignore on the barrel', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    // The tag sits in the first 3 lines (file-level) but is neither on nor
    // directly above the `keepMe` re-export, so only the file-level rule applies.
    const barrel = w('barrel.ts', [
      '// @dead-code-ignore',
      "export { used } from './used';",
      'const _pad = 0;',
      "export { keepMe } from './keep';",
    ].join('\n'));
    const used = w('used.ts', 'export const used = 1;');
    const keep = w('keep.ts', 'export const keepMe = 1;');
    const r = await analyze({ files: [entry, barrel, used, keep], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedFiles.map((f) => f.filePath)).not.toContain(keep);
  });
});
