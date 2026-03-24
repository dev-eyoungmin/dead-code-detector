import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectDartFramework,
  findDartFrameworkEntryPoints,
  getDartConventionalExports,
  getDartIgnorePatterns,
} from '../../../../../src/analyzer/languages/dart/dartFrameworkDetector';

describe('dartFrameworkDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-fw-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should detect Flutter from pubspec.yaml', () => {
    fs.writeFileSync(path.join(tempDir, 'pubspec.yaml'),
      'name: my_app\ndependencies:\n  flutter:\n    sdk: flutter\n'
    );
    expect(detectDartFramework(tempDir)).toBe('flutter');
  });

  it('should return null for non-Flutter Dart project', () => {
    fs.writeFileSync(path.join(tempDir, 'pubspec.yaml'),
      'name: my_cli\ndependencies:\n  args: ^2.0.0\n'
    );
    expect(detectDartFramework(tempDir)).toBeNull();
  });

  it('should find Flutter entry points', async () => {
    fs.writeFileSync(path.join(tempDir, 'pubspec.yaml'),
      'name: my_app\ndependencies:\n  flutter:\n    sdk: flutter\n'
    );
    const libDir = path.join(tempDir, 'lib');
    const testDir = path.join(tempDir, 'test');
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'main.dart'), 'void main() {}');
    fs.writeFileSync(path.join(testDir, 'widget_test.dart'), 'void main() {}');

    const entries = await findDartFrameworkEntryPoints(tempDir, 'flutter');
    expect(entries.some(e => e.endsWith('main.dart'))).toBe(true);
    expect(entries.some(e => e.endsWith('widget_test.dart'))).toBe(true);
  });

  it('should return conventional exports for Flutter', () => {
    const exports = getDartConventionalExports('flutter');
    expect(exports).toContain('build');
    expect(exports).toContain('createState');
    expect(exports).toContain('dispose');
    expect(exports).toContain('toJson');
  });

  it('should return ignore patterns for generated files', () => {
    const patterns = getDartIgnorePatterns();
    expect(patterns).toContain('*.g.dart');
    expect(patterns).toContain('*.freezed.dart');
  });
});
