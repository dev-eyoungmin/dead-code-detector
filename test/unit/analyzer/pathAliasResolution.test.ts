import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { collectImports } from '../../../src/analyzer/importCollector';

describe('path alias resolution fallback', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-alias-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgram(files: string[], tsconfigPath?: string): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
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

  it('should resolve @/ alias when ts.resolveModuleName fails', () => {
    const srcDir = path.join(tempDir, 'src');
    const dataDir = path.join(srcDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
      },
    }));

    fs.writeFileSync(path.join(srcDir, 'data', 'MealDTO.ts'),
      'export type MealDTO = { name: string };'
    );

    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(mainFile,
      "import { MealDTO } from '@/src/data/MealDTO';\nconsole.log({} as MealDTO);"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram(
      [mainFile, path.join(srcDir, 'data', 'MealDTO.ts')],
      tsconfigPath
    );
    const sourceFile = program.getSourceFile(mainFile)!;
    const imports = collectImports(sourceFile, program);

    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toContain('MealDTO');
    expect(imports[0].resolvedPath).not.toBe('@/src/data/MealDTO');
    expect(path.isAbsolute(imports[0].resolvedPath)).toBe(true);
  });

  it('should resolve alias with index file', () => {
    const utilsDir = path.join(tempDir, 'src', 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
      },
    }));

    fs.writeFileSync(path.join(utilsDir, 'index.ts'), 'export const helper = 1;');

    const mainFile = path.join(tempDir, 'src', 'main.ts');
    fs.writeFileSync(mainFile, "import { helper } from '@/src/utils';");

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram(
      [mainFile, path.join(utilsDir, 'index.ts')],
      tsconfigPath
    );
    const sourceFile = program.getSourceFile(mainFile)!;
    const imports = collectImports(sourceFile, program);

    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toContain('index.ts');
    expect(path.isAbsolute(imports[0].resolvedPath)).toBe(true);
  });

  it('should not resolve actual external modules as aliases', () => {
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
      },
    }));

    const mainFile = path.join(tempDir, 'main.ts');
    fs.writeFileSync(mainFile, "import React from 'react';");

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;
    const imports = collectImports(sourceFile, program);

    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toBe('react');
  });
});
