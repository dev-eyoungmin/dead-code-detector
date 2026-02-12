import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { parseExportKey, makeExportKey, buildDependencyGraph } from '../../../src/analyzer/dependencyGraph';

describe('dependencyGraph utilities', () => {
  describe('makeExportKey', () => {
    it('should create a key with :: separator', () => {
      const key = makeExportKey('/src/file.ts', 'myExport');
      expect(key).toBe('/src/file.ts::myExport');
    });

    it('should handle empty export name', () => {
      const key = makeExportKey('/src/file.ts', '');
      expect(key).toBe('/src/file.ts::');
    });
  });

  describe('parseExportKey', () => {
    it('should parse a valid export key', () => {
      const result = parseExportKey('/src/file.ts::myExport');
      expect(result.filePath).toBe('/src/file.ts');
      expect(result.exportName).toBe('myExport');
    });

    it('should handle export names containing colons', () => {
      const result = parseExportKey('/src/file.ts::some::value');
      expect(result.filePath).toBe('/src/file.ts::some');
      expect(result.exportName).toBe('value');
    });

    it('should throw on invalid key without :: separator', () => {
      expect(() => parseExportKey('invalidkey')).toThrow(
        'Invalid export key format'
      );
    });

    it('should throw on empty string', () => {
      expect(() => parseExportKey('')).toThrow('Invalid export key format');
    });

    it('should roundtrip with makeExportKey', () => {
      const filePath = '/project/src/utils.ts';
      const exportName = 'helperFn';
      const key = makeExportKey(filePath, exportName);
      const parsed = parseExportKey(key);
      expect(parsed.filePath).toBe(filePath);
      expect(parsed.exportName).toBe(exportName);
    });
  });
});

describe('buildDependencyGraph - default export tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-graph-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgram(files: string[]): ts.Program {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    };
    return ts.createProgram(files, compilerOptions);
  }

  it('should track default export function usage via default import', () => {
    const componentFile = path.join(tempDir, 'Button.ts');
    const consumerFile = path.join(tempDir, 'App.ts');

    fs.writeFileSync(componentFile, 'export default function Button() { return null; }');
    fs.writeFileSync(consumerFile, "import Button from './Button';\nButton();");

    const program = createProgram([componentFile, consumerFile]);
    const graph = buildDependencyGraph([componentFile, consumerFile], program);

    const key = makeExportKey(componentFile, 'default');
    const usages = graph.exportUsages.get(key);
    expect(usages).toBeDefined();
    expect(usages!.size).toBeGreaterThan(0);
    expect(usages!.has(consumerFile)).toBe(true);
  });

  it('should track default export class usage via default import', () => {
    const classFile = path.join(tempDir, 'MyClass.ts');
    const consumerFile = path.join(tempDir, 'main.ts');

    fs.writeFileSync(classFile, 'export default class MyClass { method() {} }');
    fs.writeFileSync(consumerFile, "import MyClass from './MyClass';\nnew MyClass();");

    const program = createProgram([classFile, consumerFile]);
    const graph = buildDependencyGraph([classFile, consumerFile], program);

    const key = makeExportKey(classFile, 'default');
    const usages = graph.exportUsages.get(key);
    expect(usages).toBeDefined();
    expect(usages!.size).toBeGreaterThan(0);
  });

  it('should track export default X (ExportAssignment) usage', () => {
    const moduleFile = path.join(tempDir, 'config.ts');
    const consumerFile = path.join(tempDir, 'app.ts');

    fs.writeFileSync(moduleFile, 'const config = { port: 3000 };\nexport default config;');
    fs.writeFileSync(consumerFile, "import config from './config';\nconsole.log(config);");

    const program = createProgram([moduleFile, consumerFile]);
    const graph = buildDependencyGraph([moduleFile, consumerFile], program);

    const key = makeExportKey(moduleFile, 'default');
    const usages = graph.exportUsages.get(key);
    expect(usages).toBeDefined();
    expect(usages!.size).toBeGreaterThan(0);
  });
});

describe('buildDependencyGraph - star re-export tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-graph-reexport-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgram(files: string[]): ts.Program {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    };
    return ts.createProgram(files, compilerOptions);
  }

  it('should track named import through export * from chain', () => {
    const buttonFile = path.join(tempDir, 'Button.ts');
    const indexFile = path.join(tempDir, 'index.ts');
    const consumerFile = path.join(tempDir, 'App.ts');

    fs.writeFileSync(buttonFile, 'export function Button() { return null; }');
    fs.writeFileSync(indexFile, "export * from './Button';");
    fs.writeFileSync(consumerFile, "import { Button } from './index';\nButton();");

    const allFiles = [buttonFile, indexFile, consumerFile];
    const program = createProgram(allFiles);
    const graph = buildDependencyGraph(allFiles, program);

    // Button export in Button.ts should be marked as used
    const key = makeExportKey(buttonFile, 'Button');
    const usages = graph.exportUsages.get(key);
    expect(usages).toBeDefined();
    expect(usages!.size).toBeGreaterThan(0);
    expect(usages!.has(consumerFile)).toBe(true);
  });

  it('should track named import through nested re-export chain', () => {
    const srcFile = path.join(tempDir, 'helpers.ts');
    const midFile = path.join(tempDir, 'utils.ts');
    const indexFile = path.join(tempDir, 'index.ts');
    const consumerFile = path.join(tempDir, 'App.ts');

    fs.writeFileSync(srcFile, 'export function formatDate() { return ""; }');
    fs.writeFileSync(midFile, "export * from './helpers';");
    fs.writeFileSync(indexFile, "export * from './utils';");
    fs.writeFileSync(consumerFile, "import { formatDate } from './index';\nformatDate();");

    const allFiles = [srcFile, midFile, indexFile, consumerFile];
    const program = createProgram(allFiles);
    const graph = buildDependencyGraph(allFiles, program);

    const key = makeExportKey(srcFile, 'formatDate');
    const usages = graph.exportUsages.get(key);
    expect(usages).toBeDefined();
    expect(usages!.size).toBeGreaterThan(0);
    expect(usages!.has(consumerFile)).toBe(true);
  });

  it('should collect export * from as import in the re-exporting file', () => {
    const srcFile = path.join(tempDir, 'components.ts');
    const indexFile = path.join(tempDir, 'index.ts');

    fs.writeFileSync(srcFile, 'export function Card() { return null; }');
    fs.writeFileSync(indexFile, "export * from './components';");

    const allFiles = [srcFile, indexFile];
    const program = createProgram(allFiles);
    const graph = buildDependencyGraph(allFiles, program);

    // index.ts should have an outbound edge to components.ts
    const outbound = graph.outboundEdges.get(indexFile);
    expect(outbound).toBeDefined();
    expect(outbound!.has(srcFile)).toBe(true);

    // components.ts should have an inbound edge from index.ts
    const inbound = graph.inboundEdges.get(srcFile);
    expect(inbound).toBeDefined();
    expect(inbound!.has(indexFile)).toBe(true);
  });
});
