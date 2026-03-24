import { describe, it, expect } from 'vitest';
import { collectDartExports, isPartFile } from '../../../../../src/analyzer/languages/dart/dartExportCollector';

describe('dartExportCollector', () => {
  it('should collect public class', () => {
    const content = 'class UserModel {\n  String name;\n}';
    const exports = collectDartExports(content, '/project/lib/user.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('UserModel');
    expect(exports[0].kind).toBe('class');
  });

  it('should skip private class', () => {
    const content = 'class _InternalState {}';
    const exports = collectDartExports(content, '/project/lib/state.dart');
    expect(exports).toHaveLength(0);
  });

  it('should collect mixin', () => {
    const content = 'mixin Validatable {}';
    const exports = collectDartExports(content, '/project/lib/mixin.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Validatable');
    expect(exports[0].kind).toBe('class');
  });

  it('should collect enum', () => {
    const content = 'enum Status { active, inactive }';
    const exports = collectDartExports(content, '/project/lib/status.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Status');
    expect(exports[0].kind).toBe('enum');
  });

  it('should collect typedef', () => {
    const content = 'typedef StringCallback = void Function(String);';
    const exports = collectDartExports(content, '/project/lib/types.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('StringCallback');
    expect(exports[0].kind).toBe('type');
  });

  it('should collect top-level function', () => {
    const content = 'String formatDate(DateTime date) {\n  return date.toString();\n}';
    const exports = collectDartExports(content, '/project/lib/utils.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('formatDate');
    expect(exports[0].kind).toBe('function');
  });

  it('should collect top-level variables', () => {
    const content = 'final String appName = "MyApp";\nconst int maxRetries = 3;';
    const exports = collectDartExports(content, '/project/lib/config.dart');
    expect(exports).toHaveLength(2);
    expect(exports.map(e => e.name)).toContain('appName');
    expect(exports.map(e => e.name)).toContain('maxRetries');
  });

  it('should skip private functions', () => {
    const content = 'void _internalHelper() {}\nvoid publicHelper() {}';
    const exports = collectDartExports(content, '/project/lib/helpers.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('publicHelper');
  });

  it('should collect export directives as re-exports', () => {
    const content = "export 'src/models.dart';\nexport 'src/utils.dart' show formatDate;";
    const exports = collectDartExports(content, '/project/lib/main.dart');
    const reExports = exports.filter(e => e.isReExport);
    expect(reExports).toHaveLength(2);
    expect(reExports[0].name).toBe('*');
    expect(reExports[1].name).toBe('formatDate');
  });

  it('should collect extension', () => {
    const content = 'extension StringExt on String {\n  bool get isBlank => trim().isEmpty;\n}';
    const exports = collectDartExports(content, '/project/lib/ext.dart');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('StringExt');
  });

  it('should detect part of file', () => {
    expect(isPartFile("part of 'parent.dart';\nclass Widget {}")).toBe(true);
    expect(isPartFile("import 'dart:core';\nclass Widget {}")).toBe(false);
  });
});
