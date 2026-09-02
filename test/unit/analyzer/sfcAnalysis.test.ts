import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { analyze, clearProgramCache } from '../../../src/analyzer';

describe('single-file components and multi-tsconfig projects through analyze()', () => {
  let dir: string;

  const w = (rel: string, content: string): string => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return path.normalize(abs);
  };

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-analysis-test-')));
    clearProgramCache();
  });

  afterEach(() => {
    clearProgramCache();
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('links TS utilities imported from .vue files and does not report template-used locals', async () => {
    const util = w('src/util.ts', 'export const helper = 1; export const dead = 2;');
    const comp = w(
      'src/Comp.vue',
      '<template><p>{{ count }}</p></template><script setup lang="ts">import { helper } from "./util"; const count = helper; const unusedLocal = 3;</script>'
    );
    const app = w(
      'src/App.vue',
      '<template><Comp /></template><script setup lang="ts">import Comp from "./Comp.vue";</script>'
    );

    const r = await analyze({ files: [util, comp, app], rootDir: dir, entryPoints: [app] });

    expect(r.unusedFiles).toHaveLength(0);
    expect(r.unusedExports.map((e) => e.exportName)).toEqual(['dead']);
    expect(r.unusedLocals.map((l) => l.symbolName)).toEqual(['unusedLocal']);
  });

  it('reports positions inside a <script> block at their real file coordinates', async () => {
    const comp = w(
      'src/Solo.vue',
      '<template><p/></template>\n<script setup lang="ts">\nconst deadLocal = 1;\n</script>\n'
    );

    const r = await analyze({ files: [comp], rootDir: dir, entryPoints: [] });

    const local = r.unusedLocals.find((l) => l.symbolName === 'deadLocal')!;
    expect(local).toBeDefined();
    const lines = fs.readFileSync(comp, 'utf-8').split('\n');
    expect(lines[local.line - 1]).toBe('const deadLocal = 1;');
    expect(local.column).toBe(lines[local.line - 1].indexOf('deadLocal'));
  });

  it('keeps reported lines correct when the template contains a U+2028 terminator', async () => {
    // U+2028 is a line terminator to the TypeScript scanner. If script
    // extraction blanked it to a space, every position below it would be
    // reported one line too high.
    const comp = w(
      'src/Sep.vue',
      '<template><p>A\u2028B</p></template>\n<script setup lang="ts">\nconst deadLocal = 1;\n</script>\n'
    );

    const r = await analyze({ files: [comp], rootDir: dir, entryPoints: [] });

    const local = r.unusedLocals.find((l) => l.symbolName === 'deadLocal')!;
    expect(local).toBeDefined();
    const lines = fs.readFileSync(comp, 'utf-8').split(/\r\n|[\n\r\u2028\u2029]/);
    expect(lines[local.line - 1]).toBe('const deadLocal = 1;');
  });

  it('still reports a local whose name collides with a script tag attribute', async () => {
    // `<script setup lang="ts">` must not count as a template reference to a
    // local named `setup`.
    const comp = w(
      'src/Attr.vue',
      '<template><p/></template>\n<script setup lang="ts">\nconst setup = 1;\n</script>\n'
    );

    const r = await analyze({ files: [comp], rootDir: dir, entryPoints: [] });

    expect(r.unusedLocals.map((l) => l.symbolName)).toEqual(['setup']);
  });

  it('counts svelte markup references and gives the component a default export', async () => {
    const widget = w(
      'src/Widget.svelte',
      '<script lang="ts">\nconst shown = 1;\nconst hidden = 2;\n</script>\n<p>{shown}</p>\n'
    );
    const app = w('src/main.ts', 'import Widget from "./Widget.svelte";\nexport const mount = (): unknown => Widget;\n');

    const r = await analyze({ files: [widget, app], rootDir: dir, entryPoints: [app] });

    expect(r.unusedLocals.map((l) => l.symbolName)).toEqual(['hidden']);
    expect(r.unusedFiles).toHaveLength(0);
    expect(r.unusedExports).toHaveLength(0);
  });

  it('resolves a monorepo where each package has its own tsconfig paths', async () => {
    w('packages/a/tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@a/*":["src/*"]}}}');
    w('packages/b/package.json', '{"name":"@repo/b","main":"src/index.js","types":"src/index.ts"}');
    const aIndex = w(
      'packages/a/src/index.ts',
      "import { x } from '@a/util';\nimport { helper } from '@repo/b';\nexport const run = (): number => x + helper;\n"
    );
    const aUtil = w('packages/a/src/util.ts', 'export const x = 1;\n');
    const bIndex = w('packages/b/src/index.ts', 'export const helper = 2;\n');

    fs.mkdirSync(path.join(dir, 'node_modules', '@repo'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'packages', 'b'), path.join(dir, 'node_modules', '@repo', 'b'), 'dir');

    const r = await analyze({
      files: [aIndex, aUtil, bIndex],
      rootDir: dir,
      entryPoints: [aIndex],
    });

    expect(r.unusedFiles.map((f) => f.filePath)).toEqual([]);
    expect(r.unusedExports.map((e) => e.exportName)).toEqual([]);
  });
});
