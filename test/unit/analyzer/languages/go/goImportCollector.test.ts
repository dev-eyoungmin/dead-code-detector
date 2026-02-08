import { describe, it, expect } from 'vitest';
import { collectGoImports } from '../../../../../src/analyzer/languages/go/goImportCollector';

const rootDir = '/project';
const filePath = '/project/main.go';
const modulePath = 'example.com/myapp';

describe('goImportCollector', () => {
  it('should parse single import', () => {
    const content = `package main

import "fmt"`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('fmt');
    expect(imports[0].isNamespaceImport).toBe(true);
  });

  it('should parse aliased import', () => {
    const content = `package main

import f "fmt"`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('fmt');
    expect(imports[0].specifiers[0].alias).toBe('f');
  });

  it('should parse blank import', () => {
    const content = `package main

import _ "net/http/pprof"`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifiers[0].alias).toBe('_');
  });

  it('should parse dot import', () => {
    const content = `package main

import . "fmt"`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifiers[0].alias).toBe('.');
  });

  it('should parse grouped imports', () => {
    const content = `package main

import (
	"fmt"
	"os"
	"strings"
)`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(3);
    expect(imports[0].source).toBe('fmt');
    expect(imports[1].source).toBe('os');
    expect(imports[2].source).toBe('strings');
  });

  it('should parse grouped imports with aliases', () => {
    const content = `package main

import (
	f "fmt"
	_ "net/http/pprof"
)`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(2);
    expect(imports[0].specifiers[0].alias).toBe('f');
    expect(imports[1].specifiers[0].alias).toBe('_');
  });

  it('should skip comments in import block', () => {
    const content = `package main

import (
	"fmt"
	// "os" -- not needed
	"strings"
)`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(2);
    expect(imports[0].source).toBe('fmt');
    expect(imports[1].source).toBe('strings');
  });

  it('should handle local module imports', () => {
    const content = `package main

import "example.com/myapp/pkg/utils"`;
    const imports = collectGoImports(content, filePath, rootDir, modulePath);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('example.com/myapp/pkg/utils');
  });
});
