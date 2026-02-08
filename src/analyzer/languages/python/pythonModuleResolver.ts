import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves a Python module import to an absolute file path.
 *
 * Handles:
 * - Absolute imports: `import module` -> module.py or module/__init__.py
 * - Relative imports: `from . import x` or `from ..pkg import y`
 */
export function resolvePythonImport(
  importModule: string,
  containingFile: string,
  rootDir: string,
  relativeDots: number = 0
): string {
  if (relativeDots > 0) {
    return resolveRelativeImport(importModule, containingFile, relativeDots);
  }
  return resolveAbsoluteImport(importModule, rootDir);
}

function resolveRelativeImport(
  importModule: string,
  containingFile: string,
  dots: number
): string {
  let baseDir = path.dirname(containingFile);

  // Each dot after the first goes up one directory
  for (let i = 1; i < dots; i++) {
    baseDir = path.dirname(baseDir);
  }

  if (!importModule) {
    // `from . import x` — resolve to __init__.py of current package
    return resolveModulePath(baseDir, '');
  }

  const parts = importModule.split('.');
  const modulePath = path.join(baseDir, ...parts);
  return resolveModulePath(path.dirname(modulePath), path.basename(modulePath));
}

function resolveAbsoluteImport(
  importModule: string,
  rootDir: string
): string {
  const parts = importModule.split('.');
  const modulePath = path.join(rootDir, ...parts);

  // Try as a file
  const pyFile = modulePath + '.py';
  if (fs.existsSync(pyFile)) {
    return pyFile;
  }

  // Try as a package (directory with __init__.py)
  const initFile = path.join(modulePath, '__init__.py');
  if (fs.existsSync(initFile)) {
    return initFile;
  }

  // Return as-is (external module)
  return importModule;
}

function resolveModulePath(dir: string, name: string): string {
  if (name) {
    // Try module_name.py
    const pyFile = path.join(dir, name + '.py');
    if (fs.existsSync(pyFile)) {
      return pyFile;
    }

    // Try module_name/__init__.py
    const initFile = path.join(dir, name, '__init__.py');
    if (fs.existsSync(initFile)) {
      return initFile;
    }

    return path.join(dir, name);
  }

  // No module name, resolve directory's __init__.py
  const initFile = path.join(dir, '__init__.py');
  if (fs.existsSync(initFile)) {
    return initFile;
  }

  return dir;
}
