import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectUnusedExports } from '../../../src/analyzer/unusedExportDetector';
import type { DependencyGraph } from '../../../src/types';

/**
 * Creates a minimal DependencyGraph with one file that has a single unused export.
 */
function createGraphWithExport(
  filePath: string,
  exportInfo: {
    name: string;
    line: number;
    column: number;
    isDefault: boolean;
    isReExport: boolean;
    isTypeOnly: boolean;
    kind: string;
  }
): DependencyGraph {
  return {
    files: new Map([
      [
        filePath,
        {
          filePath,
          imports: [],
          exports: [exportInfo],
          locals: [],
        },
      ],
    ]),
    exportUsages: new Map(),
  };
}

describe('unusedExportDetector - React pattern heuristics', () => {
  let tempDir: string;
  let tempFile: string;

  // Create a temp file so readFileSync works (for ignore comment check)
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-export-test-'));
    tempFile = path.join(tempDir, 'Component.tsx');
    fs.writeFileSync(tempFile, 'export default function Component() {}');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence to React hook exports (use* pattern)', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'useAuth',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to useTheme hook', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'useTheme',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to HOC exports (with* function pattern)', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'withRouter',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should NOT assign low confidence to with* exports that are not functions', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'withPrefix',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign low confidence to Context exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'ThemeContext',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to Provider exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'AuthProvider',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to Consumer exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'ThemeConsumer',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to .jsx PascalCase default exports', () => {
    const jsxFile = path.join(tempDir, 'Button.jsx');
    fs.writeFileSync(jsxFile, 'export default function Button() {}');

    const graph = createGraphWithExport(jsxFile, {
      name: 'Button',
      line: 1,
      column: 0,
      isDefault: true,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign medium confidence to regular named function exports', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'regularFunction',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should not match lowercase use* as React hook', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'useless',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign low confidence to PascalCase variable exports in .tsx', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'Input',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should NOT assign low confidence to PascalCase variable exports in .ts', () => {
    const tsFile = path.join(tempDir, 'Utils.ts');
    fs.writeFileSync(tsFile, 'export const MyHelper = {};');

    const graph = createGraphWithExport(tsFile, {
      name: 'MyHelper',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign low confidence to renderItem function export', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'renderItem',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to handleSubmit function export', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'handleSubmit',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to onPress function export', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'onPress',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to selectUser function export', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'selectUser',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to exports in .test.ts files', () => {
    const testFile = path.join(tempDir, 'utils.test.ts');
    fs.writeFileSync(testFile, 'export function helper() {}');

    const graph = createGraphWithExport(testFile, {
      name: 'helper',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to exports in __tests__/ files', () => {
    const testsDir = path.join(tempDir, '__tests__');
    fs.mkdirSync(testsDir, { recursive: true });
    const testFile = path.join(testsDir, 'helper.ts');
    fs.writeFileSync(testFile, 'export function createMock() {}');

    const graph = createGraphWithExport(testFile, {
      name: 'createMock',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to PascalCase named story exports in .stories.tsx', () => {
    const storiesFile = path.join(tempDir, 'Button.stories.tsx');
    fs.writeFileSync(storiesFile, 'export const Primary = {};');

    const graph = createGraphWithExport(storiesFile, {
      name: 'Primary',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should NOT assign low confidence to lowercase story exports in .stories.tsx', () => {
    const storiesFile = path.join(tempDir, 'Button.stories.tsx');
    fs.writeFileSync(storiesFile, 'export const args = {};');

    const graph = createGraphWithExport(storiesFile, {
      name: 'args',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should NOT assign low confidence to lowercase variable in .tsx', () => {
    const graph = createGraphWithExport(tempFile, {
      name: 'myVariable',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'variable',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });
});

describe('unusedExportDetector - Python pattern heuristics', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-export-py-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence to exports in test_utils.py', () => {
    const testFile = path.join(tempDir, 'test_utils.py');
    fs.writeFileSync(testFile, 'def helper(): pass');

    const graph = createGraphWithExport(testFile, {
      name: 'helper',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to exports in utils_test.py', () => {
    const testFile = path.join(tempDir, 'utils_test.py');
    fs.writeFileSync(testFile, 'def helper(): pass');

    const graph = createGraphWithExport(testFile, {
      name: 'helper',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to exports in conftest.py', () => {
    const testFile = path.join(tempDir, 'conftest.py');
    fs.writeFileSync(testFile, 'def fixture(): pass');

    const graph = createGraphWithExport(testFile, {
      name: 'fixture',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to Python dunder exports (__init__)', () => {
    const pyFile = path.join(tempDir, 'module.py');
    fs.writeFileSync(pyFile, 'class Meta: pass');

    const graph = createGraphWithExport(pyFile, {
      name: '__init__',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });
});

describe('unusedExportDetector - Java pattern heuristics', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-export-java-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence to exports in UserTest.java', () => {
    const testFile = path.join(tempDir, 'UserTest.java');
    fs.writeFileSync(testFile, 'public class UserTest {}');

    const graph = createGraphWithExport(testFile, {
      name: 'testGetUser',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to exports in src/test/ directory', () => {
    const testDir = path.join(tempDir, 'src', 'test', 'java', 'com');
    fs.mkdirSync(testDir, { recursive: true });
    const testFile = path.join(testDir, 'Helper.java');
    fs.writeFileSync(testFile, 'public class Helper {}');

    const graph = createGraphWithExport(testFile, {
      name: 'createMock',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to toString export in .java', () => {
    const javaFile = path.join(tempDir, 'User.java');
    fs.writeFileSync(javaFile, 'public class User {}');

    const graph = createGraphWithExport(javaFile, {
      name: 'toString',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign low confidence to enum exports in .java', () => {
    const javaFile = path.join(tempDir, 'Status.java');
    fs.writeFileSync(javaFile, 'public enum Status { ACTIVE, INACTIVE }');

    const graph = createGraphWithExport(javaFile, {
      name: 'Status',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'enum',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });
});

describe('unusedExportDetector - Go pattern heuristics', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-export-go-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence to exports in testdata/ directory', () => {
    const testDir = path.join(tempDir, 'testdata');
    fs.mkdirSync(testDir, { recursive: true });
    const goFile = path.join(testDir, 'helper.go');
    fs.writeFileSync(goFile, 'package testdata');

    const graph = createGraphWithExport(goFile, {
      name: 'Helper',
      line: 1,
      column: 0,
      isDefault: false,
      isReExport: false,
      isTypeOnly: false,
      kind: 'function',
    });

    const results = detectUnusedExports(graph, []);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });
});
