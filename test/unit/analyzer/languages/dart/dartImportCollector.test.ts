import { describe, it, expect } from 'vitest';
import { collectDartImports } from '../../../../../src/analyzer/languages/dart/dartImportCollector';

const rootDir = '/project';
const filePath = '/project/lib/main.dart';
const packageName = 'my_app';

describe('dartImportCollector', () => {
  it('should parse basic internal package import', () => {
    const content = "import 'package:my_app/src/models/user.dart';";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].source).toBe('package:my_app/src/models/user.dart');
    expect(imports[0].resolvedPath).toBe('/project/lib/src/models/user.dart');
    expect(imports[0].isNamespaceImport).toBe(true);
  });

  it('should keep external package imports as-is', () => {
    const content = "import 'package:flutter/material.dart';";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toBe('package:flutter/material.dart');
  });

  it('should keep dart: SDK imports as-is', () => {
    const content = "import 'dart:async';";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toBe('dart:async');
  });

  it('should parse relative import', () => {
    const content = "import '../widgets/button.dart';";
    // filePath is /project/lib/main.dart, so ../ goes to /project/
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toBe('/project/widgets/button.dart');
  });

  it('should parse import with show', () => {
    const content = "import 'utils.dart' show formatDate, parseDate;";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(false);
    expect(imports[0].specifiers).toHaveLength(2);
    expect(imports[0].specifiers[0].name).toBe('formatDate');
    expect(imports[0].specifiers[1].name).toBe('parseDate');
  });

  it('should parse import with hide (treated as namespace)', () => {
    const content = "import 'utils.dart' hide internalHelper;";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(true);
  });

  it('should parse import with as (namespace alias)', () => {
    const content = "import 'utils.dart' as utils;";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(true);
    expect(imports[0].specifiers[0].isNamespace).toBe(true);
    expect(imports[0].specifiers[0].alias).toBe('utils');
  });

  it('should parse export directive as import', () => {
    const content = "export 'src/models.dart';";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(true);
  });

  it('should parse export with show', () => {
    const content = "export 'src/utils.dart' show formatDate;";
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(1);
    expect(imports[0].isNamespaceImport).toBe(false);
    expect(imports[0].specifiers[0].name).toBe('formatDate');
  });

  it('should handle multiple imports', () => {
    const content = `
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:my_app/src/models/user.dart';
import '../widgets/button.dart' show CustomButton;
export 'src/exports.dart';
`;
    const imports = collectDartImports(content, filePath, rootDir, packageName);
    expect(imports).toHaveLength(5);
  });
});
