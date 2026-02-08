import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves a Go import path to the directory containing the package files.
 *
 * Go imports reference packages, not individual files.
 * A package is a directory containing .go files with the same package declaration.
 *
 * For local imports (those starting with the module path from go.mod),
 * resolves to the directory under the project root.
 */
export function resolveGoImport(
  importPath: string,
  rootDir: string,
  modulePath: string
): string {
  // Check if it's a local import (starts with the module path)
  if (modulePath && importPath.startsWith(modulePath)) {
    const relativePath = importPath.substring(modulePath.length);
    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    const fullPath = path.join(rootDir, cleanPath);

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      return fullPath;
    }
  }

  // Try as a relative path from root
  const directPath = path.join(rootDir, importPath);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
    return directPath;
  }

  // External package — return as-is
  return importPath;
}

/**
 * Reads the module path from go.mod
 */
export function readModulePath(rootDir: string): string {
  const goModPath = path.join(rootDir, 'go.mod');
  if (!fs.existsSync(goModPath)) {
    return '';
  }

  try {
    const content = fs.readFileSync(goModPath, 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/**
 * Collects all .go files in a directory (single package).
 * Excludes test files.
 */
export function collectPackageFiles(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }

  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
