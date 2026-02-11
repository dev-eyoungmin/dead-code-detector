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
