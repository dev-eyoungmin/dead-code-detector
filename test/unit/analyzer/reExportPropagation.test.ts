import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { collectExports } from '../../../src/analyzer/exportCollector';
import { analyze } from '../../../src/analyzer';

describe('re-export propagation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reexport-propagation-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createTsProgram(files: string[], tsconfigPath?: string): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.React,
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

  describe('originalName capture in collectExports', () => {
    it('should capture originalName "default" for export { default as IconDinner } from "./IconDinner"', () => {
      // Create actual files so program can resolve module
      const iconFile = path.join(tempDir, 'IconDinner.tsx');
      fs.writeFileSync(iconFile, 'export default function IconDinner() { return null; }');

      const indexFile = path.join(tempDir, 'index.ts');
      fs.writeFileSync(indexFile, "export { default as IconDinner } from './IconDinner';");

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
          jsx: 'react',
        },
      }));

      const program = createTsProgram([indexFile, iconFile], tsconfigPath);
      // Trigger binding so parent nodes are set
      program.getTypeChecker();
      const sourceFile = program.getSourceFile(indexFile)!;
      const exports = collectExports(sourceFile, program);

      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('IconDinner');
      expect(exports[0].originalName).toBe('default');
      expect(exports[0].isReExport).toBe(true);
      expect(exports[0].reExportSource).toBe(path.normalize(iconFile));
    });

    it('should capture originalName for renamed re-exports: export { originalFn as renamedFn } from "./mod"', () => {
      const modFile = path.join(tempDir, 'mod.ts');
      fs.writeFileSync(modFile, 'export function originalFn() { return 1; }');

      const indexFile = path.join(tempDir, 'index.ts');
      fs.writeFileSync(indexFile, "export { originalFn as renamedFn } from './mod';");

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
        },
      }));

      const program = createTsProgram([indexFile, modFile], tsconfigPath);
      program.getTypeChecker();
      const sourceFile = program.getSourceFile(indexFile)!;
      const exports = collectExports(sourceFile, program);

      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('renamedFn');
      expect(exports[0].originalName).toBe('originalFn');
      expect(exports[0].isReExport).toBe(true);
    });

    it('should have undefined originalName for non-aliased re-exports: export { helper } from "./mod"', () => {
      const modFile = path.join(tempDir, 'mod.ts');
      fs.writeFileSync(modFile, 'export function helper() { return 1; }');

      const indexFile = path.join(tempDir, 'index.ts');
      fs.writeFileSync(indexFile, "export { helper } from './mod';");

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
        },
      }));

      const program = createTsProgram([indexFile, modFile], tsconfigPath);
      program.getTypeChecker();
      const sourceFile = program.getSourceFile(indexFile)!;
      const exports = collectExports(sourceFile, program);

      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('helper');
      expect(exports[0].originalName).toBeUndefined();
      expect(exports[0].isReExport).toBe(true);
    });
  });

  describe('propagation via analyze()', () => {
    it('should not report original default export as unused when used through barrel re-export', async () => {
      // IconDinner.tsx: export default function IconDinner() {}
      const iconFile = path.join(tempDir, 'IconDinner.tsx');
      fs.writeFileSync(iconFile, 'export default function IconDinner() { return null; }');

      // index.ts (barrel): export { default as IconDinner } from './IconDinner'
      const barrelFile = path.join(tempDir, 'index.ts');
      fs.writeFileSync(barrelFile, "export { default as IconDinner } from './IconDinner';");

      // consumer.ts: import { IconDinner } from './index'
      const consumerFile = path.join(tempDir, 'consumer.ts');
      fs.writeFileSync(consumerFile, "import { IconDinner } from './index';\nconsole.log(IconDinner);");

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
          jsx: 'react',
        },
      }));

      const result = await analyze({
        files: [iconFile, barrelFile, consumerFile],
        rootDir: tempDir,
        entryPoints: [consumerFile],
        tsconfigPath,
      });

      // The default export of IconDinner.tsx should NOT be reported as unused
      const iconUnusedExports = result.unusedExports.filter(
        (e) => e.filePath === iconFile
      );
      expect(iconUnusedExports).toHaveLength(0);
    });

    it('should propagate through multi-level re-export chain A -> B -> C', async () => {
      // C.ts: export function coreHelper() {}
      const fileC = path.join(tempDir, 'C.ts');
      fs.writeFileSync(fileC, 'export function coreHelper() { return 42; }');

      // B.ts: export { coreHelper as midHelper } from './C'
      const fileB = path.join(tempDir, 'B.ts');
      fs.writeFileSync(fileB, "export { coreHelper as midHelper } from './C';");

      // A.ts: export { midHelper as topHelper } from './B'
      const fileA = path.join(tempDir, 'A.ts');
      fs.writeFileSync(fileA, "export { midHelper as topHelper } from './B';");

      // consumer.ts: import { topHelper } from './A'
      const consumerFile = path.join(tempDir, 'consumer.ts');
      fs.writeFileSync(consumerFile, "import { topHelper } from './A';\nconsole.log(topHelper);");

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
        },
      }));

      const result = await analyze({
        files: [fileC, fileB, fileA, consumerFile],
        rootDir: tempDir,
        entryPoints: [consumerFile],
        tsconfigPath,
      });

      // coreHelper in C.ts should NOT be reported as unused
      const cUnusedExports = result.unusedExports.filter(
        (e) => e.filePath === fileC
      );
      expect(cUnusedExports).toHaveLength(0);

      // midHelper in B.ts should NOT be reported as unused
      const bUnusedExports = result.unusedExports.filter(
        (e) => e.filePath === fileB
      );
      expect(bUnusedExports).toHaveLength(0);
    });

    it('should handle circular re-exports without infinite loop', async () => {
      // circA.ts: export { foo as bar } from './circB'; export function baz() {}
      const circA = path.join(tempDir, 'circA.ts');
      fs.writeFileSync(circA, "export { foo as bar } from './circB';\nexport function baz() { return 1; }");

      // circB.ts: export { baz as foo } from './circA';
      const circB = path.join(tempDir, 'circB.ts');
      fs.writeFileSync(circB, "export { baz as foo } from './circA';");

      // consumer.ts: import { bar } from './circA'
      const consumerFile = path.join(tempDir, 'consumer.ts');
      fs.writeFileSync(consumerFile, "import { bar } from './circA';\nconsole.log(bar);");

      const tsconfigPath = path.join(tempDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
        },
      }));

      // Should complete without hanging (maxIterations guard)
      const result = await analyze({
        files: [circA, circB, consumerFile],
        rootDir: tempDir,
        entryPoints: [consumerFile],
        tsconfigPath,
      });

      // Just verify it completes without timeout/infinite loop
      expect(result.analyzedFileCount).toBe(3);
    });
  });
});
