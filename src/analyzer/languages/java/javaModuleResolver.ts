import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves a Java import to the corresponding .java file.
 *
 * Java imports use dot-separated package names that map to directory structures.
 * E.g., `com.example.MyClass` -> `com/example/MyClass.java`
 */
export function resolveJavaImport(
  importPath: string,
  rootDir: string,
  sourceRoots: string[]
): string {
  // Remove wildcard for resolution
  const isWildcard = importPath.endsWith('.*');
  const cleanPath = isWildcard
    ? importPath.substring(0, importPath.length - 2)
    : importPath;

  // Convert dot notation to path
  const relativePath = cleanPath.replace(/\./g, path.sep);

  for (const sourceRoot of sourceRoots) {
    if (isWildcard) {
      // Wildcard import: resolve to directory
      const dirPath = path.join(sourceRoot, relativePath);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        return dirPath;
      }
    } else {
      // Specific class import: resolve to .java file
      const javaFile = path.join(sourceRoot, relativePath + '.java');
      if (fs.existsSync(javaFile)) {
        return javaFile;
      }
    }
  }

  // External import — return as-is
  return importPath;
}

/**
 * Detects Java source root directories.
 * Looks for Maven/Gradle conventions first, then falls back to src/.
 */
export function detectSourceRoots(rootDir: string): string[] {
  const sourceRoots: string[] = [];

  // Maven/Gradle convention
  const mavenSrc = path.join(rootDir, 'src', 'main', 'java');
  if (fs.existsSync(mavenSrc)) {
    sourceRoots.push(mavenSrc);
  }

  // Gradle test sources
  const mavenTest = path.join(rootDir, 'src', 'test', 'java');
  if (fs.existsSync(mavenTest)) {
    sourceRoots.push(mavenTest);
  }

  // Simple src/ directory
  if (sourceRoots.length === 0) {
    const srcDir = path.join(rootDir, 'src');
    if (fs.existsSync(srcDir)) {
      sourceRoots.push(srcDir);
    }
  }

  // Root directory as fallback
  if (sourceRoots.length === 0) {
    sourceRoots.push(rootDir);
  }

  return sourceRoots;
}

/**
 * Extracts the package name from a Java file's content.
 */
export function extractPackageName(content: string): string | null {
  const match = content.match(/^package\s+([\w.]+)\s*;/m);
  return match ? match[1] : null;
}
