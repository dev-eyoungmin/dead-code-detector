import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { collectImports } from '../../../src/analyzer/importCollector';

describe('importCollector - path alias resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-collector-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgram(files: string[], tsconfigPath?: string): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    };

    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(tsconfigPath)
        );
        compilerOptions = parsed.options;
      }
    }

    return ts.createProgram(files, compilerOptions);
  }

  it('should resolve @/ path alias imports via tsconfig paths', () => {
    // Create tsconfig with path aliases
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
    };

    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2)
    );

    // Create the source file that uses alias
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'utils.ts'),
      'export function helper() { return 42; }'
    );

    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(
      mainFile,
      "import { helper } from '@/utils';\nconsole.log(helper());"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile, path.join(srcDir, 'utils.ts')], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;

    const imports = collectImports(sourceFile, program);

    expect(imports.length).toBe(1);
    expect(imports[0].source).toBe('@/utils');
    // The resolved path should point to the actual file, not be left as '@/utils'
    expect(imports[0].resolvedPath).toContain('utils.ts');
    expect(imports[0].resolvedPath).not.toBe('@/utils');
  });

  it('should resolve ~/ path alias imports via tsconfig paths', () => {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        baseUrl: '.',
        paths: {
          '~/*': ['src/*'],
        },
      },
    };

    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2)
    );

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'config.ts'),
      'export const API_URL = "http://example.com";'
    );

    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(
      mainFile,
      "import { API_URL } from '~/config';\nconsole.log(API_URL);"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile, path.join(srcDir, 'config.ts')], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;

    const imports = collectImports(sourceFile, program);

    expect(imports.length).toBe(1);
    expect(imports[0].source).toBe('~/config');
    expect(imports[0].resolvedPath).toContain('config.ts');
    expect(imports[0].resolvedPath).not.toBe('~/config');
  });

  it('should still treat true external modules as external', () => {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
    };

    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2)
    );

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(
      mainFile,
      "import * as path from 'path';\nconsole.log(path.join('a', 'b'));"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;

    const imports = collectImports(sourceFile, program);

    expect(imports.length).toBe(1);
    expect(imports[0].source).toBe('path');
    // External modules should keep their original specifier
    // (resolved as external or kept as-is)
  });

  it('should resolve relative imports normally', () => {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
      },
    };

    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2)
    );

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'helper.ts'),
      'export function help() { return true; }'
    );

    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(
      mainFile,
      "import { help } from './helper';\nconsole.log(help());"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile, path.join(srcDir, 'helper.ts')], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;

    const imports = collectImports(sourceFile, program);

    expect(imports.length).toBe(1);
    expect(imports[0].source).toBe('./helper');
    expect(imports[0].resolvedPath).toContain('helper.ts');
  });

  it('should resolve baseUrl imports without explicit paths config', () => {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        baseUrl: 'src',
      },
    };

    fs.writeFileSync(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2)
    );

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'utils.ts'),
      'export function doSomething() { return 1; }'
    );

    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(
      mainFile,
      "import { doSomething } from 'utils';\nconsole.log(doSomething());"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile, path.join(srcDir, 'utils.ts')], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;

    const imports = collectImports(sourceFile, program);

    expect(imports.length).toBe(1);
    expect(imports[0].source).toBe('utils');
    // With baseUrl='src', 'utils' should resolve to src/utils.ts
    expect(imports[0].resolvedPath).toContain('utils.ts');
  });
});

describe('collectImports - modern patterns', () => {
  let dir: string;
  beforeEach(() => {
    // realpath: on macOS os.tmpdir() itself is a symlink (/var -> /private/var)
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ic-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (rel: string, c: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c);
    return p;
  };
  const collect = (entry: string, files: string[], rootDir: string = dir) => {
    const program = ts.createProgram(files, {
      allowJs: true,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    });
    return collectImports(program.getSourceFile(entry)!, program, rootDir);
  };
  const linkWorkspacePackage = () => {
    const pkg = write('packages/lib/index.ts', 'export const lib = 1;');
    fs.writeFileSync(path.join(dir, 'packages/lib/package.json'), '{"name":"@ws/lib","main":"index.ts"}');
    fs.mkdirSync(path.join(dir, 'node_modules/@ws'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'packages/lib'), path.join(dir, 'node_modules/@ws/lib'), 'dir');
    return pkg;
  };

  it('flags export * from as a star re-export', () => {
    const x = write('x.ts', 'export const a = 1;');
    const b = write('barrel.ts', "export * from './x'; export * as ns from './x';");
    const imps = collect(b, [b, x]);
    expect(imps).toHaveLength(2);
    expect(imps.every((i) => i.isStarReExport && i.resolvedPath === x)).toBe(true);
  });

  it('flags export { x } from as a named re-export, but not a plain import', () => {
    const x = write('x.ts', 'export const a = 1;');
    // A file can both consume and forward the same name; only the
    // ExportDeclaration record is a forward.
    const b = write('barrel.ts', "import { a } from './x';\nexport { a } from './x';\nexport const use = a;");
    const imps = collect(b, [b, x]);
    expect(imps).toHaveLength(2);
    const consumption = imps.find((i) => !i.isNamedReExport);
    const forward = imps.find((i) => i.isNamedReExport);
    expect(consumption).toBeDefined();
    expect(forward).toBeDefined();
    expect(forward!.specifiers.map((sp) => sp.name)).toEqual(['a']);
    expect(forward!.isStarReExport).toBeUndefined();
  });

  it('does not flag export * from as a named re-export', () => {
    const x = write('x.ts', 'export const a = 1;');
    const b = write('barrel.ts', "export * from './x';");
    expect(collect(b, [b, x])[0].isNamedReExport).toBeUndefined();
  });

  it('strips ?query and #hash from specifiers (Vite ?worker, ?raw)', () => {
    const w = write('w.ts', 'export {}');
    const a = write('a.ts', "import W from './w?worker'; import raw from './w?raw'; import h from './w#frag';");
    expect(collect(a, [a, w]).map((i) => i.resolvedPath)).toEqual([w, w, w]);
  });

  it('collects destructured require as named specifiers', () => {
    const x = write('x.js', 'module.exports = { a: 1, b: 2 };');
    const a = write('a.js', "const { a, b: renamed } = require('./x'); const whole = require('./x');");
    const imps = collect(a, [a, x]);
    expect(imps[0].specifiers.map((s) => s.name)).toEqual(['a', 'b']);
    expect(imps[0].isNamespaceImport).toBe(false);
    expect(imps[1].isNamespaceImport).toBe(true);
  });

  it('turns template-literal and concatenated dynamic imports into directory globs', () => {
    write('locales/en.ts', 'export default 1');
    const a = write(
      'a.ts',
      'export const l = (x: string) => import(`./locales/${x}`); export const m = (x: string) => import("./locales/" + x + ".ts");'
    );
    const imps = collect(a, [a]);
    expect(imps).toHaveLength(2);
    expect(imps[0].globPattern).toBe(path.join(dir, 'locales') + '/**');
    expect(imps[1].globPattern).toBe(path.join(dir, 'locales') + '/**');
  });

  it('turns import.meta.glob and require.context into globs', () => {
    write('mods/a.ts', 'export default 1');
    const a = write('a.ts', "const m = import.meta.glob('./mods/*.ts'); const c = require.context('./mods', true, /\\.ts$/);");
    const imps = collect(a, [a]);
    expect(imps[0].globPattern).toBe(path.join(dir, 'mods', '*.ts'));
    expect(imps[1].globPattern).toBe(path.join(dir, 'mods') + '/**');
  });

  it('collects Worker / new URL(import.meta.url) targets as namespace imports', () => {
    const w = write('w.ts', 'self.onmessage = () => {};');
    const a = write(
      'a.ts',
      "new Worker(new URL('./w.ts', import.meta.url)); new SharedWorker('./w.ts'); const u = new URL('./w.ts', import.meta.url);"
    );
    const imps = collect(a, [a, w]);
    expect(imps).toHaveLength(3);
    expect(imps.every((i) => i.resolvedPath === w && i.isNamespaceImport)).toBe(true);
  });

  it('resolves symlinked workspace packages inside rootDir as internal', () => {
    const pkg = linkWorkspacePackage();
    const a = write('app/a.ts', "import { lib } from '@ws/lib';");
    expect(collect(a, [a, pkg])[0].resolvedPath).toBe(pkg);
  });

  it('resolves symlinked workspace packages when rootDir has a trailing separator', () => {
    const pkg = linkWorkspacePackage();
    const a = write('app/a.ts', "import { lib } from '@ws/lib';");
    expect(collect(a, [a, pkg], dir + path.sep)[0].resolvedPath).toBe(pkg);
  });
});
