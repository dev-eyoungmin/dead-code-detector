import { describe, it, expect } from 'vitest';
import { collectGoExports } from '../../../../../src/analyzer/languages/go/goExportCollector';

describe('goExportCollector', () => {
  it('should detect exported functions (uppercase start)', () => {
    const content = `package utils

func FormatName(name string) string {
	return name
}

func unexported() {}`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('FormatName');
    expect(exports[0].kind).toBe('function');
  });

  it('should detect exported types (struct)', () => {
    const content = `package models

type User struct {
	Name string
}`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('User');
    expect(exports[0].kind).toBe('struct');
  });

  it('should detect exported interfaces', () => {
    const content = `package pkg

type Handler interface {
	Handle() error
}`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Handler');
    expect(exports[0].kind).toBe('interface');
  });

  it('should detect exported constants', () => {
    const content = `package pkg

const MaxRetries = 3
const minRetries = 1`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('MaxRetries');
    expect(exports[0].kind).toBe('constant');
  });

  it('should detect exported variables', () => {
    const content = `package pkg

var GlobalState = make(map[string]int)
var localState = 0`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('GlobalState');
    expect(exports[0].kind).toBe('variable');
  });

  it('should handle const/var blocks', () => {
    const content = `package pkg

const (
	MaxSize = 100
	minSize = 10
	DefaultName = "test"
)`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(2);
    expect(exports[0].name).toBe('MaxSize');
    expect(exports[1].name).toBe('DefaultName');
  });

  it('should detect exported methods with receiver', () => {
    const content = `package pkg

func (u *User) GetName() string {
	return u.Name
}

func (u *User) getName() string {
	return u.Name
}`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('GetName');
    expect(exports[0].kind).toBe('method');
  });

  it('should include line numbers', () => {
    const content = `package pkg

func First() {}

func Second() {}`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports[0].line).toBe(3);
    expect(exports[1].line).toBe(5);
  });

  it('should skip comments', () => {
    const content = `package pkg

// func FakeExport() {}
func RealExport() {}`;
    const exports = collectGoExports(content, '/test.go');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('RealExport');
  });
});
