import type { ImportInfo } from '../../../types';
import { resolveGoImport } from './goModuleResolver';

/**
 * Collects all imports from a Go source file.
 *
 * Handles:
 * - `import "pkg"`
 * - `import alias "pkg"`
 * - `import _ "pkg"` (side-effect import)
 * - `import . "pkg"` (dot import)
 * - `import ( "pkg1" \n "pkg2" )`
 */
export function collectGoImports(
  content: string,
  filePath: string,
  rootDir: string,
  modulePath: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Match grouped import block: import ( ... )
  const groupRegex = /import\s*\(([\s\S]*?)\)/g;
  let groupMatch: RegExpExecArray | null;

  while ((groupMatch = groupRegex.exec(content)) !== null) {
    const block = groupMatch[1];
    const blockImports = parseImportBlock(block, rootDir, modulePath);
    imports.push(...blockImports);
  }

  // Match single import: import "pkg" or import alias "pkg"
  const singleRegex = /import\s+(?![\s(])((?:\w+|_|\.)\s+)?"([^"]+)"/g;
  let singleMatch: RegExpExecArray | null;

  while ((singleMatch = singleRegex.exec(content)) !== null) {
    // Make sure this isn't inside a group import block
    const beforeMatch = content.substring(0, singleMatch.index);
    const openParens = (beforeMatch.match(/import\s*\(/g) || []).length;
    const closeParens = (beforeMatch.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      continue; // Inside a group block, skip
    }

    const alias = singleMatch[1]?.trim() || undefined;
    const importPath = singleMatch[2];
    const resolvedPath = resolveGoImport(importPath, rootDir, modulePath);

    imports.push({
      source: importPath,
      resolvedPath,
      specifiers: [
        {
          name: '*',
          alias: alias === '_' || alias === '.' ? alias : alias,
          isDefault: false,
          isNamespace: true,
        },
      ],
      isNamespaceImport: true,
      isDynamicImport: false,
      isTypeOnly: false,
    });
  }

  return imports;
}

function parseImportBlock(
  block: string,
  rootDir: string,
  modulePath: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = block.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) {
      continue;
    }

    // alias "pkg" or _ "pkg" or . "pkg" or just "pkg"
    const lineMatch = trimmed.match(/^(?:([\w_.]+)\s+)?"([^"]+)"/);
    if (lineMatch) {
      const alias = lineMatch[1] || undefined;
      const importPath = lineMatch[2];
      const resolvedPath = resolveGoImport(importPath, rootDir, modulePath);

      imports.push({
        source: importPath,
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
  }

  return imports;
}
