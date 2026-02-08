import { describe, it, expect } from 'vitest';
import { collectPythonExports } from '../../../../../src/analyzer/languages/python/pythonExportCollector';

describe('pythonExportCollector', () => {
  it('should collect top-level function definitions', () => {
    const content = `def hello():
    return "hello"

def world():
    return "world"`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports).toHaveLength(2);
    expect(exports[0].name).toBe('hello');
    expect(exports[0].kind).toBe('function');
    expect(exports[1].name).toBe('world');
  });

  it('should collect top-level class definitions', () => {
    const content = `class MyClass:
    pass

class AnotherClass(Base):
    pass`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports).toHaveLength(2);
    expect(exports[0].name).toBe('MyClass');
    expect(exports[0].kind).toBe('class');
    expect(exports[1].name).toBe('AnotherClass');
  });

  it('should collect top-level variables', () => {
    const content = `name = "test"
MAX_SIZE = 100`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports).toHaveLength(2);
    expect(exports[0].name).toBe('name');
    expect(exports[0].kind).toBe('variable');
    expect(exports[1].name).toBe('MAX_SIZE');
    expect(exports[1].kind).toBe('constant');
  });

  it('should skip private names (starting with _)', () => {
    const content = `def public_func():
    pass

def _private_func():
    pass

_private_var = 42
public_var = "hello"`;
    const exports = collectPythonExports(content, '/test.py');
    const names = exports.map((e) => e.name);
    expect(names).toContain('public_func');
    expect(names).toContain('public_var');
    expect(names).not.toContain('_private_func');
    expect(names).not.toContain('_private_var');
  });

  it('should use __all__ when present', () => {
    const content = `__all__ = ['func_a', 'ClassB']

def func_a():
    pass

def func_b():
    pass

class ClassB:
    pass`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports).toHaveLength(2);
    const names = exports.map((e) => e.name);
    expect(names).toContain('func_a');
    expect(names).toContain('ClassB');
    expect(names).not.toContain('func_b');
  });

  it('should handle multi-line __all__', () => {
    const content = `__all__ = [
    'func_a',
    'func_b',
]

def func_a():
    pass

def func_b():
    pass

def func_c():
    pass`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports).toHaveLength(2);
    const names = exports.map((e) => e.name);
    expect(names).toContain('func_a');
    expect(names).toContain('func_b');
    expect(names).not.toContain('func_c');
  });

  it('should include line numbers', () => {
    const content = `def first():
    pass

def second():
    pass`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports[0].line).toBe(1);
    expect(exports[1].line).toBe(4);
  });

  it('should skip __all__ itself as an export', () => {
    const content = `__all__ = ['func_a']

def func_a():
    pass`;
    const exports = collectPythonExports(content, '/test.py');
    const names = exports.map((e) => e.name);
    expect(names).not.toContain('__all__');
  });

  it('should handle typed variable assignment', () => {
    const content = `count: int = 0
name: str = "test"`;
    const exports = collectPythonExports(content, '/test.py');
    expect(exports).toHaveLength(2);
    expect(exports[0].name).toBe('count');
    expect(exports[1].name).toBe('name');
  });
});
