import { describe, it, expect } from 'vitest';
import { collectGoLocals } from '../../../../../src/analyzer/languages/go/goLocalCollector';

describe('goLocalCollector', () => {
  it('should collect unexported functions', () => {
    const content = `package utils

func capitalize(s string) string {
	return s
}

func FormatName(name string) string {
	return capitalize(name)
}`;
    const exported = new Set(['FormatName']);
    const locals = collectGoLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('capitalize');
    expect(locals[0].kind).toBe('function');
  });

  it('should count references correctly', () => {
    const content = `package utils

func helper() string {
	return "value"
}

func A() string {
	return helper()
}

func B() string {
	return helper()
}`;
    const exported = new Set(['A', 'B']);
    const locals = collectGoLocals(content, exported);
    expect(locals[0].name).toBe('helper');
    expect(locals[0].references).toBe(2);
  });

  it('should detect unused unexported functions (0 references)', () => {
    const content = `package utils

func unused() string {
	return "never called"
}

func Used() string {
	return "public"
}`;
    const exported = new Set(['Used']);
    const locals = collectGoLocals(content, exported);
    expect(locals[0].name).toBe('unused');
    expect(locals[0].references).toBe(0);
  });

  it('should skip main and init functions', () => {
    const content = `package main

func main() {
	init()
}

func init() {}`;
    const exported = new Set<string>();
    const locals = collectGoLocals(content, exported);
    expect(locals).toHaveLength(0);
  });

  it('should collect unexported variables', () => {
    const content = `package pkg

var internalState = 0
var PublicState = 1`;
    const exported = new Set(['PublicState']);
    const locals = collectGoLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('internalState');
    expect(locals[0].kind).toBe('variable');
  });

  it('should collect unexported constants', () => {
    const content = `package pkg

const maxRetries = 3
const MaxSize = 100`;
    const exported = new Set(['MaxSize']);
    const locals = collectGoLocals(content, exported);
    expect(locals).toHaveLength(1);
    expect(locals[0].name).toBe('maxRetries');
    expect(locals[0].kind).toBe('constant');
  });

  it('should include line numbers', () => {
    const content = `package pkg

func first() {}

func second() {}`;
    const exported = new Set<string>();
    const locals = collectGoLocals(content, exported);
    expect(locals[0].line).toBe(3);
    expect(locals[1].line).toBe(5);
  });

  it('should not count references in comments', () => {
    const content = `package pkg

func helper() string {
	return "value"
}

// helper is useful
func Main() string {
	return "done"
}`;
    const exported = new Set(['Main']);
    const locals = collectGoLocals(content, exported);
    expect(locals[0].name).toBe('helper');
    expect(locals[0].references).toBe(0);
  });
});
