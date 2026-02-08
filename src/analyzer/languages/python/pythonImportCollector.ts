import type { ImportInfo, ImportSpecifier } from '../../../types';
import { resolvePythonImport } from './pythonModuleResolver';

/**
 * Collects all imports from a Python source file.
 *
 * Handles:
 * - `import module`
 * - `import module as alias`
 * - `from module import name1, name2`
 * - `from module import *`
 * - `from . import x` (relative)
 * - `from ..pkg import y` (relative)
 * - Multi-line imports with parentheses
 */
export function collectPythonImports(
  content: string,
  filePath: string,
  rootDir: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Normalize line continuations
  const normalized = content.replace(/\\\n/g, ' ');

  // Handle multi-line imports with parentheses by joining them
  const lines = joinMultilineImports(normalized);

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    // from module import name1, name2
    const fromMatch = trimmed.match(
      /^from\s+(\.*)(\S*)\s+import\s+(.+)$/
    );
    if (fromMatch) {
      const dots = fromMatch[1].length;
      const moduleName = fromMatch[2];
      const importsPart = fromMatch[3].trim();

      // Remove trailing comments
      const cleanImports = importsPart.replace(/#.*$/, '').trim();

      const resolvedPath = resolvePythonImport(
        moduleName,
        filePath,
        rootDir,
        dots
      );

      if (cleanImports === '*') {
        imports.push({
          source: dots > 0 ? '.'.repeat(dots) + moduleName : moduleName,
          resolvedPath,
          specifiers: [{ name: '*', isDefault: false, isNamespace: true }],
          isNamespaceImport: true,
          isDynamicImport: false,
          isTypeOnly: false,
        });
      } else {
        const specifiers = parseImportNames(cleanImports);
        imports.push({
          source: dots > 0 ? '.'.repeat(dots) + moduleName : moduleName,
          resolvedPath,
          specifiers,
          isNamespaceImport: false,
          isDynamicImport: false,
          isTypeOnly: false,
        });
      }
      continue;
    }

    // import module / import module as alias / import mod1, mod2
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      const importsPart = importMatch[1].replace(/#.*$/, '').trim();
      const modules = importsPart.split(',').map((m) => m.trim());

      for (const mod of modules) {
        const asMatch = mod.match(/^(\S+)\s+as\s+(\S+)$/);
        const moduleName = asMatch ? asMatch[1] : mod;
        const alias = asMatch ? asMatch[2] : undefined;

        const resolvedPath = resolvePythonImport(moduleName, filePath, rootDir);

        imports.push({
          source: moduleName,
          resolvedPath,
          specifiers: [
            {
              name: '*',
              alias,
              isDefault: false,
              isNamespace: true,
            },
          ],
          isNamespaceImport: true,
          isDynamicImport: false,
          isTypeOnly: false,
        });
      }
      continue;
    }
  }

  return imports;
}

function parseImportNames(namesPart: string): ImportSpecifier[] {
  // Remove surrounding parens if present
  const cleaned = namesPart.replace(/^\(/, '').replace(/\)$/, '').trim();

  return cleaned
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const asMatch = s.match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) {
        return {
          name: asMatch[1],
          alias: asMatch[2],
          isDefault: false,
          isNamespace: false,
        };
      }
      return {
        name: s,
        isDefault: false,
        isNamespace: false,
      };
    });
}

function joinMultilineImports(content: string): string[] {
  const result: string[] = [];
  const rawLines = content.split('\n');
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Check if this line starts a multi-line import with parentheses
    if (
      (trimmed.startsWith('from ') || trimmed.startsWith('import ')) &&
      trimmed.includes('(') &&
      !trimmed.includes(')')
    ) {
      let combined = trimmed;
      i++;
      while (i < rawLines.length) {
        const nextLine = rawLines[i].trim();
        combined += ' ' + nextLine;
        i++;
        if (nextLine.includes(')')) {
          break;
        }
      }
      // Clean up the parentheses
      combined = combined.replace(/\(\s*/g, '').replace(/\s*\)/g, '');
      result.push(combined);
    } else {
      result.push(trimmed);
      i++;
    }
  }

  return result;
}
