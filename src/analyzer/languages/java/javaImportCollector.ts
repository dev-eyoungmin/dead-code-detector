import type { ImportInfo, ImportSpecifier } from '../../../types';
import { resolveJavaImport } from './javaModuleResolver';

/**
 * Collects all imports from a Java source file.
 *
 * Handles:
 * - `import com.example.ClassName;`
 * - `import com.example.*;`
 * - `import static com.example.ClassName.methodName;`
 * - `import static com.example.ClassName.*;`
 */
export function collectJavaImports(
  content: string,
  filePath: string,
  rootDir: string,
  sourceRoots: string[]
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Static import: import static pkg.Class.member; or import static pkg.Class.*;
    const staticMatch = trimmed.match(
      /^import\s+static\s+([\w.*]+)\s*;/
    );
    if (staticMatch) {
      const fullPath = staticMatch[1];
      const lastDot = fullPath.lastIndexOf('.');
      const className = fullPath.substring(0, lastDot);
      const memberName = fullPath.substring(lastDot + 1);

      const resolvedPath = resolveJavaImport(className, rootDir, sourceRoots);

      const specifiers: ImportSpecifier[] = [];
      if (memberName === '*') {
        specifiers.push({ name: '*', isDefault: false, isNamespace: true });
      } else {
        specifiers.push({ name: memberName, isDefault: false, isNamespace: false });
      }

      imports.push({
        source: fullPath,
        resolvedPath,
        specifiers,
        isNamespaceImport: memberName === '*',
        isDynamicImport: false,
        isTypeOnly: false,
      });
      continue;
    }

    // Regular import: import pkg.ClassName; or import pkg.*;
    const importMatch = trimmed.match(
      /^import\s+([\w.]+(?:\.\*)?)\s*;/
    );
    if (importMatch) {
      const importPath = importMatch[1];
      const isWildcard = importPath.endsWith('.*');

      const resolvedPath = resolveJavaImport(importPath, rootDir, sourceRoots);

      if (isWildcard) {
        imports.push({
          source: importPath,
          resolvedPath,
          specifiers: [{ name: '*', isDefault: false, isNamespace: true }],
          isNamespaceImport: true,
          isDynamicImport: false,
          isTypeOnly: false,
        });
      } else {
        // Extract class name from fully qualified path
        const lastDot = importPath.lastIndexOf('.');
        const className = lastDot >= 0 ? importPath.substring(lastDot + 1) : importPath;

        imports.push({
          source: importPath,
          resolvedPath,
          specifiers: [{ name: className, isDefault: false, isNamespace: false }],
          isNamespaceImport: false,
          isDynamicImport: false,
          isTypeOnly: false,
        });
      }
      continue;
    }
  }

  return imports;
}
