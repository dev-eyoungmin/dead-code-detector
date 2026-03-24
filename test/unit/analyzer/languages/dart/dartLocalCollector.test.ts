import { describe, it, expect } from 'vitest';
import { collectDartLocals } from '../../../../../src/analyzer/languages/dart/dartLocalCollector';

describe('dartLocalCollector', () => {
  it('should collect private class as local', () => {
    const content = 'class _InternalState {\n  int value = 0;\n}\nfinal state = _InternalState();';
    const locals = collectDartLocals(content, new Set());
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('_InternalState');
    expect(locals[0].kind).toBe('class');
    expect(locals[0].references).toBe(1);
  });

  it('should collect private function as local', () => {
    const content = 'void _helper() {}\nvoid doThing() { _helper(); }';
    const locals = collectDartLocals(content, new Set());
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('_helper');
    expect(locals[0].kind).toBe('function');
    expect(locals[0].references).toBe(1);
  });

  it('should not collect public symbols as locals', () => {
    const content = 'class PublicClass {}\nvoid publicFn() {}';
    const locals = collectDartLocals(content, new Set(['PublicClass', 'publicFn']));
    expect(locals).toHaveLength(0);
  });

  it('should count zero references for unused private symbol', () => {
    const content = 'class _UnusedHelper {}';
    const locals = collectDartLocals(content, new Set());
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('_UnusedHelper');
    expect(locals[0].references).toBe(0);
  });
});
