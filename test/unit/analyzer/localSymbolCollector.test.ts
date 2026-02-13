import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { collectLocals } from '../../../src/analyzer/localSymbolCollector';

describe('collectLocals - shorthand property references', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-symbol-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgramAndCollect(code: string) {
    const filePath = path.join(tempDir, 'test.ts');
    fs.writeFileSync(filePath, code);

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    };
    const program = ts.createProgram([filePath], compilerOptions);
    const sourceFile = program.getSourceFile(filePath)!;
    const checker = program.getTypeChecker();

    return collectLocals(sourceFile, checker);
  }

  it('should count shorthand property as a reference (return { x })', () => {
    const locals = createProgramAndCollect(`
      export function test() {
        const x = 42;
        return { x };
      }
    `);

    const xLocal = locals.find((l) => l.name === 'x');
    expect(xLocal).toBeDefined();
    expect(xLocal!.references).toBeGreaterThanOrEqual(1);
  });

  it('should count nested shorthand property as a reference (return { inner: { x } })', () => {
    const locals = createProgramAndCollect(`
      export function test() {
        const x = 42;
        return { inner: { x } };
      }
    `);

    const xLocal = locals.find((l) => l.name === 'x');
    expect(xLocal).toBeDefined();
    expect(xLocal!.references).toBeGreaterThanOrEqual(1);
  });

  it('should count multiple shorthand properties while detecting truly unused', () => {
    const locals = createProgramAndCollect(`
      export function test() {
        const a = 1;
        const b = 2;
        const c = 3;
        return { a, b };
      }
    `);

    const aLocal = locals.find((l) => l.name === 'a');
    const bLocal = locals.find((l) => l.name === 'b');
    const cLocal = locals.find((l) => l.name === 'c');
    expect(aLocal).toBeDefined();
    expect(bLocal).toBeDefined();
    expect(cLocal).toBeDefined();
    expect(aLocal!.references).toBeGreaterThanOrEqual(1);
    expect(bLocal!.references).toBeGreaterThanOrEqual(1);
    expect(cLocal!.references).toBe(0);
  });

  it('should count shorthand property in function argument', () => {
    const locals = createProgramAndCollect(`
      function consume(obj: { value: number }) { return obj; }
      export function test() {
        const value = 42;
        consume({ value });
      }
    `);

    const valueLocal = locals.find((l) => l.name === 'value');
    expect(valueLocal).toBeDefined();
    expect(valueLocal!.references).toBeGreaterThanOrEqual(1);
  });

  it('should report truly unused variable with zero references', () => {
    const locals = createProgramAndCollect(`
      export function test() {
        const unused = 'dead';
        return 42;
      }
    `);

    const unusedLocal = locals.find((l) => l.name === 'unused');
    expect(unusedLocal).toBeDefined();
    expect(unusedLocal!.references).toBe(0);
  });

  it('should count normal (non-shorthand) references correctly', () => {
    const locals = createProgramAndCollect(`
      export function test() {
        const x = 10;
        const y = x + 1;
        return y;
      }
    `);

    const xLocal = locals.find((l) => l.name === 'x');
    expect(xLocal).toBeDefined();
    expect(xLocal!.references).toBeGreaterThanOrEqual(1);
  });

  it('should handle destructured variable used in shorthand', () => {
    const locals = createProgramAndCollect(`
      export function test(obj: { a: number; b: number }) {
        const a = obj.a;
        const b = obj.b;
        return { a, b };
      }
    `);

    const aLocal = locals.find((l) => l.name === 'a');
    const bLocal = locals.find((l) => l.name === 'b');
    expect(aLocal).toBeDefined();
    expect(bLocal).toBeDefined();
    expect(aLocal!.references).toBeGreaterThanOrEqual(1);
    expect(bLocal!.references).toBeGreaterThanOrEqual(1);
  });
});

describe('collectLocals - destructuring patterns', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'destructuring-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgramAndCollect(code: string) {
    const filePath = path.join(tempDir, 'test.ts');
    fs.writeFileSync(filePath, code);

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    };
    const program = ts.createProgram([filePath], compilerOptions);
    const sourceFile = program.getSourceFile(filePath)!;
    const checker = program.getTypeChecker();

    return collectLocals(sourceFile, checker);
  }

  it('should collect object destructuring variables', () => {
    const locals = createProgramAndCollect(`
      const obj = { a: 1, b: 2 };
      const { a, b } = obj;
      export const result = a;
    `);

    const aLocal = locals.find((l) => l.name === 'a');
    const bLocal = locals.find((l) => l.name === 'b');
    // a is used in export, so references >= 1
    expect(aLocal).toBeDefined();
    expect(aLocal!.references).toBeGreaterThanOrEqual(1);
    // b is unused
    expect(bLocal).toBeDefined();
    expect(bLocal!.references).toBe(0);
  });

  it('should collect array destructuring variables', () => {
    const locals = createProgramAndCollect(`
      const arr = [1, 2];
      const [x, y] = arr;
      export const result = x;
    `);

    const xLocal = locals.find((l) => l.name === 'x');
    const yLocal = locals.find((l) => l.name === 'y');
    expect(xLocal).toBeDefined();
    expect(xLocal!.references).toBeGreaterThanOrEqual(1);
    expect(yLocal).toBeDefined();
    expect(yLocal!.references).toBe(0);
  });

  it('should skip non-rest siblings when rest element exists (ignoreRestSiblings)', () => {
    const locals = createProgramAndCollect(`
      const props = { removed: 1, kept: 2, value: 3 };
      const { removed, ...rest } = props;
      export const result = rest;
    `);

    // 'removed' should NOT be collected (omit pattern sibling)
    const removedLocal = locals.find((l) => l.name === 'removed');
    expect(removedLocal).toBeUndefined();

    // 'rest' should be collected
    const restLocal = locals.find((l) => l.name === 'rest');
    expect(restLocal).toBeDefined();
    expect(restLocal!.references).toBeGreaterThanOrEqual(1);
  });

  it('should collect all elements when no rest exists in object destructuring', () => {
    const locals = createProgramAndCollect(`
      const obj = { a: 1, b: 2 };
      const { a, b } = obj;
      export const result = a + b;
    `);

    const aLocal = locals.find((l) => l.name === 'a');
    const bLocal = locals.find((l) => l.name === 'b');
    expect(aLocal).toBeDefined();
    expect(bLocal).toBeDefined();
  });

  it('should collect nested destructuring variables', () => {
    const locals = createProgramAndCollect(`
      const obj = { nested: { x: 42 } };
      const { nested: { x } } = obj;
      export const result = x;
    `);

    const xLocal = locals.find((l) => l.name === 'x');
    expect(xLocal).toBeDefined();
    expect(xLocal!.references).toBeGreaterThanOrEqual(1);
  });

  it('should collect parameter destructuring variables', () => {
    const locals = createProgramAndCollect(`
      export function test({ a, b }: { a: number; b: number }) {
        return a;
      }
    `);

    const aLocal = locals.find((l) => l.name === 'a');
    const bLocal = locals.find((l) => l.name === 'b');
    expect(aLocal).toBeDefined();
    expect(aLocal!.references).toBeGreaterThanOrEqual(1);
    expect(bLocal).toBeDefined();
    expect(bLocal!.references).toBe(0);
  });

  it('should collect array destructuring in function parameters', () => {
    const locals = createProgramAndCollect(`
      export function test([first, second]: number[]) {
        return first;
      }
    `);

    const firstLocal = locals.find((l) => l.name === 'first');
    const secondLocal = locals.find((l) => l.name === 'second');
    expect(firstLocal).toBeDefined();
    expect(firstLocal!.references).toBeGreaterThanOrEqual(1);
    expect(secondLocal).toBeDefined();
    expect(secondLocal!.references).toBe(0);
  });
});
