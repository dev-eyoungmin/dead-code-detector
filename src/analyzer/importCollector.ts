import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import type { ImportInfo, ImportSpecifier } from '../types';

/**
 * Collects all imports from a source file
 */
export function collectImports(
  sourceFile: ts.SourceFile,
  program: ts.Program
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const fileDir = path.dirname(sourceFile.fileName);

  function visit(node: ts.Node): void {
    // import x from 'module'
    // import { x, y } from 'module'
    // import * as x from 'module'
    if (ts.isImportDeclaration(node)) {
      const importDecl = node;
      const moduleSpecifier = importDecl.moduleSpecifier;

      if (ts.isStringLiteral(moduleSpecifier)) {
        const source = moduleSpecifier.text;
        const resolvedPath = resolveImportPath(source, fileDir, program);
        const specifiers: ImportSpecifier[] = [];
        let isNamespaceImport = false;
        const isTypeOnly = importDecl.importClause?.isTypeOnly || false;

        if (importDecl.importClause) {
          const importClause = importDecl.importClause;

          // Default import: import x from 'module'
          if (importClause.name) {
            specifiers.push({
              name: 'default',
              alias: importClause.name.text,
              isDefault: true,
              isNamespace: false,
            });
          }

          // Named bindings: import { x, y } or import * as x
          if (importClause.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              // import * as x from 'module'
              isNamespaceImport = true;
              specifiers.push({
                name: '*',
                alias: importClause.namedBindings.name.text,
                isDefault: false,
                isNamespace: true,
              });
            } else if (ts.isNamedImports(importClause.namedBindings)) {
              // import { x, y as z } from 'module'
              for (const element of importClause.namedBindings.elements) {
                specifiers.push({
                  name: element.propertyName?.text || element.name.text,
                  alias: element.propertyName ? element.name.text : undefined,
                  isDefault: false,
                  isNamespace: false,
                });
              }
            }
          }
        }

        imports.push({
          source,
          resolvedPath,
          specifiers,
          isNamespaceImport,
          isDynamicImport: false,
          isTypeOnly,
        });
      }
    }

    // import('module') - dynamic import
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        const source = arg.text;
        const resolvedPath = resolveImportPath(source, fileDir, program);

        imports.push({
          source,
          resolvedPath,
          specifiers: [
            {
              name: '*',
              isDefault: false,
              isNamespace: true,
            },
          ],
          isNamespaceImport: true,
          isDynamicImport: true,
          isTypeOnly: false,
        });
      }
    }

    // require('module') - CommonJS require
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        const source = arg.text;
        const resolvedPath = resolveImportPath(source, fileDir, program);

        imports.push({
          source,
          resolvedPath,
          specifiers: [
            {
              name: '*',
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

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Resolves an import path to an absolute file path
 */
function resolveImportPath(
  importPath: string,
  containingFileDir: string,
  program: ts.Program
): string {
  // 1. Always try TS resolver first (handles path aliases, baseUrl, etc.)
  const compilerOptions = program.getCompilerOptions();
  const resolved = ts.resolveModuleName(
    importPath,
    path.join(containingFileDir, 'dummy.ts'),
    compilerOptions,
    ts.sys
  );

  if (resolved.resolvedModule) {
    // node_modules module → treat as external
    if (resolved.resolvedModule.isExternalLibraryImport) {
      return importPath;
    }
    return resolved.resolvedModule.resolvedFileName;
  }

  // 2. TS resolution failed + non-relative path → external module
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return importPath;
  }

  // 3. Relative path fallback
  return resolvePathManually(importPath, containingFileDir);
}

/**
 * Manually resolves import path by trying common extensions
 */
function resolvePathManually(
  importPath: string,
  containingFileDir: string
): string {
  const basePath = path.resolve(containingFileDir, importPath);

  // Try exact path first
  try {
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
      return basePath;
    }
  } catch {
    // File may have been deleted or be inaccessible; continue with extension resolution
  }

  // Try with extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];
  for (const ext of extensions) {
    const withExt = basePath + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }

  // Try as directory with index files
  for (const ext of extensions) {
    const indexPath = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }

  // Return as-is if we couldn't resolve (might be external)
  return importPath;
}
