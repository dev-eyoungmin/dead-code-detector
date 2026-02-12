import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { collectExports } from '../../../src/analyzer/exportCollector';

function parseSource(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
}

describe('exportCollector', () => {
  describe('default export name normalization', () => {
    it('should register export default function X() as name "default"', () => {
      const source = parseSource('export default function HeaderBackButton() { return null; }');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('default');
      expect(exports[0].isDefault).toBe(true);
      expect(exports[0].kind).toBe('default');
    });

    it('should register export default class X as name "default"', () => {
      const source = parseSource('export default class MyComponent {}');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('default');
      expect(exports[0].isDefault).toBe(true);
      expect(exports[0].kind).toBe('default');
    });

    it('should register export default X (ExportAssignment) as name "default"', () => {
      const source = parseSource('const Foo = 42;\nexport default Foo;');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('default');
      expect(exports[0].isDefault).toBe(true);
      expect(exports[0].kind).toBe('default');
    });

    it('should register export default arrow function as name "default"', () => {
      const source = parseSource('export default () => {};');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('default');
      expect(exports[0].isDefault).toBe(true);
    });
  });

  describe('named exports', () => {
    it('should register export function X() with name "X"', () => {
      const source = parseSource('export function doSomething() { return 1; }');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('doSomething');
      expect(exports[0].isDefault).toBe(false);
      expect(exports[0].kind).toBe('function');
    });

    it('should register export class X with name "X"', () => {
      const source = parseSource('export class MyService {}');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('MyService');
      expect(exports[0].isDefault).toBe(false);
      expect(exports[0].kind).toBe('class');
    });

    it('should register export const X with name "X"', () => {
      const source = parseSource('export const API_URL = "http://example.com";');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('API_URL');
      expect(exports[0].isDefault).toBe(false);
      expect(exports[0].kind).toBe('variable');
    });

    it('should register multiple const exports', () => {
      const source = parseSource('export const a = 1, b = 2;');
      const exports = collectExports(source);
      expect(exports).toHaveLength(2);
      expect(exports[0].name).toBe('a');
      expect(exports[1].name).toBe('b');
    });
  });

  describe('aliased exports (Bug 4)', () => {
    it('should use exported name for export { x as y }', () => {
      const source = parseSource('const calculateFoo = 1;\nexport { calculateFoo as computeFoo };');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('computeFoo');
      expect(exports[0].isDefault).toBe(false);
    });

    it('should use exported name for export { x as y } from "module"', () => {
      const source = parseSource('export { originalName as exportedName } from "./other";');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('exportedName');
      expect(exports[0].isReExport).toBe(true);
    });

    it('should use name directly when no alias', () => {
      const source = parseSource('const foo = 1;\nexport { foo };');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('foo');
    });
  });

  describe('re-exports', () => {
    it('should register export * from "module"', () => {
      const source = parseSource('export * from "./components";');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('*');
      expect(exports[0].isReExport).toBe(true);
      expect(exports[0].reExportSource).toBe('./components');
    });

    it('should register export * as X from "module"', () => {
      const source = parseSource('export * as Utils from "./utils";');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('Utils');
      expect(exports[0].isReExport).toBe(true);
    });
  });

  describe('type exports', () => {
    it('should register export type X', () => {
      const source = parseSource('export type Foo = { bar: string };');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('Foo');
      expect(exports[0].isTypeOnly).toBe(true);
      expect(exports[0].kind).toBe('type');
    });

    it('should register export interface X', () => {
      const source = parseSource('export interface IUser { name: string }');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('IUser');
      expect(exports[0].isTypeOnly).toBe(true);
      expect(exports[0].kind).toBe('interface');
    });

    it('should register export enum X', () => {
      const source = parseSource('export enum Color { Red, Green, Blue }');
      const exports = collectExports(source);
      expect(exports).toHaveLength(1);
      expect(exports[0].name).toBe('Color');
      expect(exports[0].kind).toBe('enum');
    });
  });
});
