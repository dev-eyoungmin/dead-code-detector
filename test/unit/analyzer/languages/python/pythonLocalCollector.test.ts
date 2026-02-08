import { describe, it, expect } from 'vitest';
import { collectPythonLocals } from '../../../../../src/analyzer/languages/python/pythonLocalCollector';

describe('pythonLocalCollector', () => {
  it('should collect private functions', () => {
    const content = `def _private_helper():
    return "private"

def public_func():
    _private_helper()`;
    const exported = new Set(['public_func']);
    const locals = collectPythonLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('_private_helper');
    expect(locals[0].kind).toBe('function');
  });

  it('should count references correctly', () => {
    const content = `def _helper():
    return "value"

def public_func():
    x = _helper()
    y = _helper()
    return x + y`;
    const exported = new Set(['public_func']);
    const locals = collectPythonLocals(content, exported);
    expect(locals[0].name).toBe('_helper');
    expect(locals[0].references).toBe(2);
  });

  it('should detect unused private functions (0 references)', () => {
    const content = `def _unused():
    return "never called"

def public_func():
    return "used"`;
    const exported = new Set(['public_func']);
    const locals = collectPythonLocals(content, exported);
    expect(locals[0].name).toBe('_unused');
    expect(locals[0].references).toBe(0);
  });

  it('should collect private variables', () => {
    const content = `_private_var = 42
public_var = "hello"`;
    const exported = new Set(['public_var']);
    const locals = collectPythonLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('_private_var');
    expect(locals[0].kind).toBe('variable');
  });

  it('should collect private classes', () => {
    const content = `class _InternalClass:
    pass

class PublicClass:
    pass`;
    const exported = new Set(['PublicClass']);
    const locals = collectPythonLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('_InternalClass');
    expect(locals[0].kind).toBe('class');
  });

  it('should not collect dunder names', () => {
    const content = `__all__ = ['x']
__version__ = "1.0"`;
    const exported = new Set<string>();
    const locals = collectPythonLocals(content, exported);
    expect(locals).toHaveLength(0);
  });

  it('should include line numbers', () => {
    const content = `_first = 1

_second = 2`;
    const exported = new Set<string>();
    const locals = collectPythonLocals(content, exported);
    expect(locals[0].line).toBe(1);
    expect(locals[1].line).toBe(3);
  });

  it('should not count references in comments', () => {
    const content = `def _helper():
    return "value"

# _helper is not used here
def public_func():
    return "done"`;
    const exported = new Set(['public_func']);
    const locals = collectPythonLocals(content, exported);
    expect(locals[0].name).toBe('_helper');
    expect(locals[0].references).toBe(0);
  });
});
