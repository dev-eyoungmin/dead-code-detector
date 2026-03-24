import * as path from 'path';
import * as fs from 'fs';

/**
 * Reads the Dart package name from pubspec.yaml
 */
export function getPackageName(rootDir: string): string | undefined {
  const pubspecPath = path.join(rootDir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) return undefined;

  try {
    const content = fs.readFileSync(pubspecPath, 'utf-8');
    const match = content.match(/^name:\s*(\S+)/m);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a Dart import path to an absolute file path.
 * Returns undefined for external packages and SDK imports.
 */
export function resolveDartImport(
  importPath: string,
  containingFile: string,
  rootDir: string,
  packageName: string
): string | undefined {
  // dart: SDK imports → external
  if (importPath.startsWith('dart:')) {
    return undefined;
  }

  // package: imports
  if (importPath.startsWith('package:')) {
    const withoutScheme = importPath.slice('package:'.length);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex === -1) return undefined;

    const pkgName = withoutScheme.slice(0, slashIndex);
    const rest = withoutScheme.slice(slashIndex + 1);

    if (pkgName === packageName) {
      // Internal package import → resolve to lib/ directory
      return path.join(rootDir, 'lib', rest);
    }

    // External package → skip
    return undefined;
  }

  // Relative imports
  const dir = path.dirname(containingFile);
  return path.resolve(dir, importPath);
}
