import { describe, it, expect } from 'vitest';
import { collectPythonImports } from '../../../../../src/analyzer/languages/python/pythonImportCollector';
import * as path from 'path';

const rootDir = '/project';
const filePath = '/project/main.py';

describe('pythonImportCollector', () => {
  it('should parse simple import statement', () => {
    const content = `import os`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('os');
    expect(imports[0].isNamespaceImport).toBe(true);
  });

  it('should parse import with alias', () => {
    const content = `import numpy as np`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('numpy');
    expect(imports[0].specifiers[0].alias).toBe('np');
  });

  it('should parse from-import statement', () => {
    const content = `from utils import helper_function, SOME_CONSTANT`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifiers).toHaveLength(2);
    expect(imports[0].specifiers[0].name).toBe('helper_function');
    expect(imports[0].specifiers[1].name).toBe('SOME_CONSTANT');
    expect(imports[0].isNamespaceImport).toBe(false);
  });

  it('should parse from-import with alias', () => {
    const content = `from utils import helper_function as hf`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifiers[0].name).toBe('helper_function');
    expect(imports[0].specifiers[0].alias).toBe('hf');
  });

  it('should parse from-import star', () => {
    const content = `from utils import *`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(true);
    expect(imports[0].specifiers[0].name).toBe('*');
  });

  it('should parse relative imports', () => {
    const content = `from . import sibling`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('.');
  });

  it('should parse multi-dot relative imports', () => {
    const content = `from ..pkg import something`;
    const subFilePath = '/project/sub/module.py';
    const imports = collectPythonImports(content, subFilePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('..pkg');
    expect(imports[0].specifiers[0].name).toBe('something');
  });

  it('should parse multi-line imports with parentheses', () => {
    const content = `from utils import (
    helper_function,
    SOME_CONSTANT,
    unused_helper
)`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifiers).toHaveLength(3);
    expect(imports[0].specifiers[0].name).toBe('helper_function');
    expect(imports[0].specifiers[1].name).toBe('SOME_CONSTANT');
    expect(imports[0].specifiers[2].name).toBe('unused_helper');
  });

  it('should handle multiple import statements', () => {
    const content = `import os
import sys
from utils import helper_function`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(3);
  });

  it('should skip comments', () => {
    const content = `# import os
import sys`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('sys');
  });

  it('should handle line continuation', () => {
    const content = `from utils import \\
    helper_function`;
    const imports = collectPythonImports(content, filePath, rootDir);
    expect(imports).toHaveLength(1);
    expect(imports[0].specifiers[0].name).toBe('helper_function');
  });
});
