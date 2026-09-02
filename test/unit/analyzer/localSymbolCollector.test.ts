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

describe('collectLocals - scopes, members, parameters', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-scope-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function collectFromSource(code: string) {
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

  it('collects locals inside nested arrow functions and callbacks', () => {
    const locals = collectFromSource(
      `export function f() { const h = () => { const nested = 1; return 2; }; [1].forEach((n) => { const inCb = n; }); return h(); }`
    );
    const byName = Object.fromEntries(locals.map((l) => [l.name, l.references]));
    expect(byName.nested).toBe(0);
    expect(byName.inCb).toBe(0);
    expect(byName.h).toBe(1);
  });

  it('collects private members and counts this.x / this.#x references', () => {
    const locals = collectFromSource(
      `export class S { private used = 1; private unusedField = 2; #priv() {} private unusedMethod() {} private usedMethod() { return this.used + this.#priv(); } public run() { return this.usedMethod(); } }`
    );
    const byName = Object.fromEntries(
      locals.map((l) => [l.name, { r: l.references, k: l.kind }])
    );
    expect(byName.used).toEqual({ r: 1, k: 'field' });
    expect(byName.unusedField).toEqual({ r: 0, k: 'field' });
    expect(byName.unusedMethod).toEqual({ r: 0, k: 'method' });
    expect(byName.usedMethod.r).toBe(1);
    expect(byName['#priv']).toEqual({ r: 1, k: 'method' });
    expect(locals.find((l) => l.name === 'run')).toBeUndefined();
  });

  it('marks constructor parameter properties', () => {
    const locals = collectFromSource(
      `export class S { constructor(private readonly svc: number, public pub: number) {} }`
    );
    const svc = locals.find((l) => l.name === 'svc')!;
    expect(svc.isParameterProperty).toBe(true);
    expect(svc.kind).toBe('field');
    expect(locals.find((l) => l.name === 'pub')).toBeUndefined();
  });

  it('applies the after-used rule to parameters', () => {
    const locals = collectFromSource(
      `export function cb(err: Error, data: string) { return data; } export function g(a: number, b: number) { return a; }`
    );
    const names = locals.filter((l) => l.kind === 'parameter').map((l) => l.name);
    expect(names).not.toContain('err'); // before a used param
    expect(names).toContain('b'); // after the last used param
  });

  it('skips parameters of methods in classes that extend/implement', () => {
    const locals = collectFromSource(
      `interface H { handle(req: string, res: string): string } export class C implements H { handle(req: string, res: string) { return res; } } export class D extends C { other(x: number) { return 1; } }`
    );
    expect(locals.filter((l) => l.kind === 'parameter')).toHaveLength(0);
  });

  it('skips decorated members and abstract/overload signatures', () => {
    const locals = collectFromSource(
      `declare const dec: any; export abstract class A { @dec private decorated = 1; abstract m(x: number): void; over(a: number): void; over(a: number) {} }`
    );
    expect(locals.map((l) => l.name)).not.toContain('decorated');
    expect(locals.filter((l) => l.kind === 'parameter').map((l) => l.name)).toEqual([]);
  });
});

describe('collectLocals - after-used ordering, framework signatures, loops', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-fixes-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function collectFromSource(code: string, fileName = 'test.ts') {
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, code);

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      experimentalDecorators: true,
    };
    const program = ts.createProgram([filePath], compilerOptions);
    const sourceFile = program.getSourceFile(filePath)!;
    const checker = program.getTypeChecker();

    return collectLocals(sourceFile, checker);
  }

  it('applies the after-used rule across destructured parameter names', () => {
    const locals = collectFromSource(
      `export const C = ({ children, className }: any, ref: any) => ref;`
    );

    // both destructured names precede the used `ref` parameter
    expect(locals.find((l) => l.name === 'children')).toBeUndefined();
    expect(locals.find((l) => l.name === 'className')).toBeUndefined();
  });

  it('reports a destructured name only when nothing after it is used', () => {
    const locals = collectFromSource(
      `export const ids = [{ id: 1, name: 'a' }].map(({ id, name }, index) => id + index);`
    );

    // `name` is followed by the used `index` parameter
    expect(locals.find((l) => l.name === 'name')).toBeUndefined();
  });

  it('does not report setter parameters', () => {
    const locals = collectFromSource(
      `export class S { private set only(v: number) {} private get other() { return 1; } }`
    );

    expect(locals.find((l) => l.name === 'v')).toBeUndefined();
  });

  it('skips decorated parameters and decorated parameter properties', () => {
    const locals = collectFromSource(
      `declare function Inject(): any; declare function Body(): any;
       export class S { constructor(@Inject() private dep: number) {} }
       export class T { run(@Body() payload: string) { return 1; } }`
    );

    expect(locals.find((l) => l.name === 'dep')).toBeUndefined();
    expect(locals.find((l) => l.name === 'payload')).toBeUndefined();
  });

  it('skips parameters of constructor overload implementations', () => {
    const locals = collectFromSource(
      `export class S {
         constructor(a: number);
         constructor(a: number, b: string);
         constructor(a: number, b?: string) { this.value = a; }
         value = 0;
       }`
    );

    expect(locals.filter((l) => l.kind === 'parameter')).toHaveLength(0);
  });

  it("counts this['name'] element access as a reference to private members", () => {
    const locals = collectFromSource(
      `export class S { private a = 1; private helper() { return 2; } run() { return this['a'] + this['helper'](); } }`
    );

    const byName = Object.fromEntries(locals.map((l) => [l.name, l.references]));
    expect(byName.a).toBeGreaterThanOrEqual(1);
    expect(byName.helper).toBeGreaterThanOrEqual(1);
  });

  it('skips parameters of class arrow-function properties in derived classes', () => {
    const locals = collectFromSource(
      `class Base {} export class C extends Base { private onClick = (e: Event, extra: number) => 1; }`
    );

    expect(locals.find((l) => l.name === 'e')).toBeUndefined();
    expect(locals.find((l) => l.name === 'extra')).toBeUndefined();
  });

  it('collects for / for-of / for-in bindings but not catch variables', () => {
    const locals = collectFromSource(
      `export function run(items: string[], obj: Record<string, number>) {
         for (let i = 0; i < 1; i++) {}
         for (const item of items) {}
         for (const key in obj) {}
         try { items.pop(); } catch (err) {}
       }`
    );

    const byName = Object.fromEntries(locals.map((l) => [l.name, l.references]));
    expect(byName.item).toBe(0);
    expect(byName.key).toBe(0);
    expect(byName.i).toBeGreaterThanOrEqual(1);
    expect(locals.find((l) => l.name === 'err')).toBeUndefined();
  });
});
