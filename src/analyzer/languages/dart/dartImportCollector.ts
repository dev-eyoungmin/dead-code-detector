import type { ImportInfo, ImportSpecifier } from '../../../types';
import { resolveDartImport } from './dartModuleResolver';

/**
 * Collects all imports and export directives from a Dart source file
 */
export function collectDartImports(
  content: string,
  filePath: string,
  rootDir: string,
  packageName: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Match import and export directives
  const importRegex = /^(?:import|export)\s+'([^']+)'(?:\s+as\s+(\w+))?(?:\s+(show|hide)\s+([^;]+))?;/gm;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const source = match[1];
    const asAlias = match[2];
    const showHide = match[3] as 'show' | 'hide' | undefined;
    const namesList = match[4]?.trim();

    const resolved = resolveDartImport(source, filePath, rootDir, packageName);
    const resolvedPath = resolved || source;

    const specifiers: ImportSpecifier[] = [];
    let isNamespaceImport = false;

    if (asAlias) {
      // import 'x' as alias -> namespace import
      isNamespaceImport = true;
      specifiers.push({
        name: '*',
        alias: asAlias,
        isDefault: false,
        isNamespace: true,
      });
    } else if (showHide === 'show' && namesList) {
      // import 'x' show A, B -> selective import
      isNamespaceImport = false;
      const names = namesList.split(',').map(n => n.trim()).filter(Boolean);
      for (const name of names) {
        specifiers.push({
          name,
          isDefault: false,
          isNamespace: false,
        });
      }
    } else if (showHide === 'hide') {
      // import 'x' hide A -> treat as namespace (all except hidden)
      isNamespaceImport = true;
    } else {
      // Plain import/export -> namespace import (all public symbols)
      isNamespaceImport = true;
    }

    imports.push({
      source,
      resolvedPath,
      specifiers,
      isNamespaceImport,
      isDynamicImport: false,
      isTypeOnly: false,
    });
  }

  return imports;
}
