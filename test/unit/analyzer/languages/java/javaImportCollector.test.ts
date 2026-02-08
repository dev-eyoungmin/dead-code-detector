import { describe, it, expect } from 'vitest';
import { collectJavaImports } from '../../../../../src/analyzer/languages/java/javaImportCollector';

const rootDir = '/project';
const filePath = '/project/src/com/example/Main.java';
const sourceRoots = ['/project/src'];

describe('javaImportCollector', () => {
  it('should parse single class import', () => {
    const content = `package com.example;

import com.example.util.StringHelper;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('com.example.util.StringHelper');
    expect(imports[0].specifiers[0].name).toBe('StringHelper');
    expect(imports[0].isNamespaceImport).toBe(false);
  });

  it('should parse wildcard import', () => {
    const content = `package com.example;

import com.example.util.*;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('com.example.util.*');
    expect(imports[0].isNamespaceImport).toBe(true);
    expect(imports[0].specifiers[0].name).toBe('*');
  });

  it('should parse static import', () => {
    const content = `package com.example;

import static com.example.util.Constants.MAX_SIZE;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('com.example.util.Constants.MAX_SIZE');
    expect(imports[0].specifiers[0].name).toBe('MAX_SIZE');
  });

  it('should parse static wildcard import', () => {
    const content = `package com.example;

import static com.example.util.Constants.*;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(true);
  });

  it('should handle multiple imports', () => {
    const content = `package com.example;

import java.util.List;
import java.util.Map;
import com.example.util.StringHelper;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports).toHaveLength(3);
    expect(imports[0].source).toBe('java.util.List');
    expect(imports[1].source).toBe('java.util.Map');
    expect(imports[2].source).toBe('com.example.util.StringHelper');
  });

  it('should skip comments', () => {
    const content = `package com.example;

// import java.util.Set;
import java.util.List;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('java.util.List');
  });

  it('should extract class name as specifier', () => {
    const content = `package com.example;

import java.util.ArrayList;

public class Main {}`;
    const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
    expect(imports[0].specifiers[0].name).toBe('ArrayList');
  });
});
