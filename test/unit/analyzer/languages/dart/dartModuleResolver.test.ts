import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveDartImport, getPackageName } from '../../../../../src/analyzer/languages/dart/dartModuleResolver';

describe('dartModuleResolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-resolver-test-'));
    fs.writeFileSync(path.join(tempDir, 'pubspec.yaml'), 'name: my_app\n');
    fs.mkdirSync(path.join(tempDir, 'lib', 'src'), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should read package name from pubspec.yaml', () => {
    expect(getPackageName(tempDir)).toBe('my_app');
  });

  it('should resolve internal package import to lib/ path', () => {
    const result = resolveDartImport(
      'package:my_app/src/models/user.dart',
      path.join(tempDir, 'lib', 'main.dart'),
      tempDir, 'my_app'
    );
    expect(result).toBe(path.join(tempDir, 'lib', 'src', 'models', 'user.dart'));
  });

  it('should return undefined for external package import', () => {
    const result = resolveDartImport(
      'package:flutter/material.dart',
      path.join(tempDir, 'lib', 'main.dart'),
      tempDir, 'my_app'
    );
    expect(result).toBeUndefined();
  });

  it('should return undefined for dart: SDK imports', () => {
    const result = resolveDartImport('dart:async', path.join(tempDir, 'lib', 'main.dart'), tempDir, 'my_app');
    expect(result).toBeUndefined();
  });

  it('should resolve relative imports', () => {
    const result = resolveDartImport(
      '../models/user.dart',
      path.join(tempDir, 'lib', 'src', 'widgets', 'button.dart'),
      tempDir, 'my_app'
    );
    expect(result).toBe(path.join(tempDir, 'lib', 'src', 'models', 'user.dart'));
  });
});
