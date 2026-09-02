import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  mapBuildPathToSource,
  resolvePackageJsonEntries,
  findWorkspacePackageDirs,
  findConventionalEntries,
  findHtmlScriptEntries,
  findServerlessEntries,
} from '../../../src/analyzer/entryPointResolver';

describe('entryPointResolver', () => {
  let dir: string;

  const w = (rel: string, content: string): string => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return path.normalize(abs);
  };

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'entry-point-resolver-test-')));
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('mapBuildPathToSource', () => {
    it('maps dist/x.js to src/x.ts using tsconfig rootDir/outDir', () => {
      w('tsconfig.json', '{"compilerOptions":{"rootDir":"src","outDir":"dist"}}');
      const src = w('src/extension.ts', '');
      expect(mapBuildPathToSource(dir, path.join(dir, 'dist/extension.js'))).toBe(src);
    });

    it('falls back to src/ and tries tsx/mts/js', () => {
      const src = w('src/index.tsx', '');
      expect(mapBuildPathToSource(dir, path.join(dir, 'build/index.js'))).toBe(src);
    });

    it('maps .d.ts to .ts and returns existing paths unchanged', () => {
      const src = w('src/a.ts', '');
      expect(mapBuildPathToSource(dir, path.join(dir, 'lib/a.d.ts'))).toBe(src);
      expect(mapBuildPathToSource(dir, src)).toBe(src);
    });

    it('returns undefined when nothing matches', () => {
      expect(mapBuildPathToSource(dir, path.join(dir, 'dist/nope.js'))).toBeUndefined();
    });
  });

  describe('resolvePackageJsonEntries', () => {
    it('reads main/module/types/bin/exports/scripts and maps build output to source', () => {
      w('src/extension.ts', '');
      w('src/cli.ts', '');
      w('src/lib.ts', '');
      w('src/types.ts', '');
      w('scripts/migrate.ts', '');
      w(
        'package.json',
        JSON.stringify({
          main: 'dist/extension.js',
          types: 'dist/types.d.ts',
          bin: { tool: 'dist/cli.js' },
          exports: { '.': { import: './dist/lib.js', require: './dist/lib.cjs' } },
          scripts: { migrate: 'tsx scripts/migrate.ts --force' },
        })
      );
      const out = resolvePackageJsonEntries(dir)
        .map((p) => path.relative(dir, p))
        .sort();
      expect(out).toEqual(['scripts/migrate.ts', 'src/cli.ts', 'src/extension.ts', 'src/lib.ts', 'src/types.ts']);
    });
  });

  describe('findWorkspacePackageDirs', () => {
    it('expands package.json workspaces and pnpm-workspace.yaml', async () => {
      w('packages/a/package.json', '{}');
      w('packages/b/package.json', '{}');
      w('apps/web/package.json', '{}');
      w('package.json', '{"workspaces":["packages/*"]}');
      w('pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n');
      const dirs = (await findWorkspacePackageDirs(dir)).map((p) => path.relative(dir, p)).sort();
      expect(dirs).toEqual(['apps/web', 'packages/a', 'packages/b']);
    });
  });

  describe('findHtmlScriptEntries / findServerlessEntries', () => {
    it('reads <script src> from index.html', async () => {
      const m = w('src/main.ts', '');
      w('index.html', '<html><script type="module" src="/src/main.ts"></script></html>');
      expect(await findHtmlScriptEntries(dir)).toEqual([m]);
    });

    it('finds vercel api routes only with vercel.json, netlify and firebase functions, serverless.yml handlers', async () => {
      const api = w('api/hello.ts', '');
      w('vercel.json', '{}');
      const nf = w('netlify/functions/x.ts', '');
      const fb = w('functions/src/index.ts', '');
      const sls = w('src/handlers/user.ts', '');
      w('serverless.yml', 'functions:\n  user:\n    handler: src/handlers/user.main\n');
      const out = (await findServerlessEntries(dir)).sort();
      expect(out).toEqual([api, fb, nf, sls].sort());
    });
  });

  describe('findConventionalEntries', () => {
    it('finds src/index/main/cli/server/app, bin/*, scripts/* files', async () => {
      const idx = w('src/index.ts', '');
      const bin = w('bin/tool.js', '');
      const script = w('scripts/build.ts', '');
      const out = (await findConventionalEntries(dir)).sort();
      expect(out).toEqual([bin, idx, script].sort());
    });
  });
});
