import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createPrograms, createProgram, clearProgramCache } from '../../../src/analyzer/programFactory';

describe('programFactory', () => {
  let dir: string;

  const w = (rel: string, content: string): string => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return path.normalize(abs);
  };

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'program-factory-test-')));
    clearProgramCache();
  });

  afterEach(() => {
    clearProgramCache();
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('createPrograms', () => {
    it("groups files by nearest tsconfig within rootDir and applies each config's paths", () => {
      w('packages/a/tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@a/*":["src/*"]}}}');
      w('packages/b/tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@b/*":["src/*"]}}}');
      const a = w('packages/a/src/index.ts', "import { x } from '@a/util';");
      const au = w('packages/a/src/util.ts', 'export const x = 1;');
      const b = w('packages/b/src/index.ts', "import { y } from '@b/util';");
      const bu = w('packages/b/src/util.ts', 'export const y = 1;');
      const loose = w('tools/x.ts', 'export const t = 1;');

      const groups = createPrograms([a, au, b, bu, loose], dir);

      expect(groups).toHaveLength(3);
      const byCfg = Object.fromEntries(
        groups.map((g) => [
          g.configPath ? path.relative(dir, g.configPath) : 'default',
          g.files.map((f) => path.basename(f)).sort(),
        ])
      );
      expect(byCfg[path.join('packages', 'a', 'tsconfig.json')]).toEqual(['index.ts', 'util.ts']);
      expect(byCfg[path.join('packages', 'b', 'tsconfig.json')]).toEqual(['index.ts', 'util.ts']);
      expect(byCfg['default']).toEqual(['x.ts']);
      expect(
        groups
          .find((g) => g.configPath?.includes(path.join('packages', 'a')))!
          .program.getCompilerOptions().paths
      ).toHaveProperty('@a/*');
    });

    it('produces a single group when an explicit tsconfigPath is given', () => {
      const cfg = w('tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}');
      w('packages/a/tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}');
      const a = w('packages/a/src/index.ts', 'export const x = 1;');
      const loose = w('tools/x.ts', 'export const t = 1;');

      const groups = createPrograms([a, loose], dir, cfg);

      expect(groups).toHaveLength(1);
      expect(groups[0].configPath).toBe(cfg);
      expect(groups[0].files.sort()).toEqual([a, loose].sort());
    });

    it('does not walk above rootDir when looking for a tsconfig', () => {
      w('tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}');
      const nested = w('nested/src/index.ts', 'export const x = 1;');

      const groups = createPrograms([nested], path.join(dir, 'nested'));

      expect(groups).toHaveLength(1);
      expect(groups[0].configPath).toBeUndefined();
    });

    it('accepts .vue files through the SFC host', () => {
      const v = w(
        'App.vue',
        '<template><p/></template>\n<script setup lang="ts">\nexport const fromVue: number = 1;\n</script>'
      );
      const [g] = createPrograms([v], dir);
      const sf = g.program.getSourceFile(v)!;
      expect(sf.text.split('\n')[2]).toBe('export const fromVue: number = 1;');
    });

    it('accepts .svelte files through the SFC host', () => {
      const s = w('Widget.svelte', '<script lang="ts">\nexport const label = "hi";\n</script>\n<p>{label}</p>');
      const [g] = createPrograms([s], dir);
      const sf = g.program.getSourceFile(s)!;
      expect(sf.text.split('\n')[1]).toBe('export const label = "hi";');
      expect(sf.text).not.toContain('<p>');
    });
  });

  describe('createProgram', () => {
    it('still returns a single program for existing callers', () => {
      const f = w('src/index.ts', 'export const x = 1;');
      const program = createProgram([f]);
      expect(program.getSourceFile(f)).toBeDefined();
    });

    it('honours an explicit tsconfig path', () => {
      const cfg = w('tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@z/*":["src/*"]}}}');
      const f = w('src/index.ts', 'export const x = 1;');
      const program = createProgram([f], cfg);
      expect(program.getCompilerOptions().paths).toHaveProperty('@z/*');
    });
  });
});
