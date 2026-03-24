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

    // export * from 'module' / export { x } from 'module' — treated as imports too
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const source = node.moduleSpecifier.text;
      const resolvedPath = resolveImportPath(source, fileDir, program);
      const specifiers: ImportSpecifier[] = [];
      let isNamespaceImport = false;

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        // export { x, y } from 'module'
        for (const element of node.exportClause.elements) {
          specifiers.push({
            name: element.propertyName?.text || element.name.text,
            alias: element.propertyName ? element.name.text : undefined,
            isDefault: false,
            isNamespace: false,
          });
        }
      } else {
        // export * from 'module' or export * as X from 'module'
        isNamespaceImport = true;
        specifiers.push({
          name: '*',
          isDefault: false,
          isNamespace: true,
        });
      }

      imports.push({
        source,
        resolvedPath,
        specifiers,
        isNamespaceImport,
        isDynamicImport: false,
        isTypeOnly: node.isTypeOnly || false,
      });
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
    return path.normalize(resolved.resolvedModule.resolvedFileName);
  }

  // 2. TS resolution failed + non-relative path → try path alias fallback before treating as external
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    const aliasResolved = resolveWithPathAlias(importPath, compilerOptions);
    if (aliasResolved) {
      return path.normalize(aliasResolved);
    }
    // Still not resolved → external module
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
  return tryResolveFile(basePath) ?? importPath;
}

/**
 * Resolves a module path using tsconfig paths mapping as fallback
 * when ts.resolveModuleName() fails (e.g., @/src/data/MealDTO).
 */
function resolveWithPathAlias(
  moduleName: string,
  compilerOptions: ts.CompilerOptions
): string | undefined {
  const paths = compilerOptions.paths;
  const baseUrl = compilerOptions.baseUrl;
  if (!paths || !baseUrl) {
    return undefined;
  }

  for (const [pattern, mappings] of Object.entries(paths)) {
    const starIndex = pattern.indexOf('*');
    if (starIndex === -1) {
      // Exact match (no wildcard) — try all mappings
      if (moduleName === pattern) {
        for (const mapping of mappings) {
          const resolved = tryResolveFile(path.resolve(baseUrl, mapping));
          if (resolved) return resolved;
        }
      }
      continue;
    }

    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);

    if (moduleName.startsWith(prefix) && moduleName.endsWith(suffix)) {
      // Guard: prefix + suffix must not exceed module name length
      if (prefix.length + suffix.length > moduleName.length) {
        continue;
      }
      const matchedWildcard = moduleName.slice(
        prefix.length,
        moduleName.length - suffix.length
      );

      for (const mapping of mappings) {
        const mappedPath = mapping.replace('*', matchedWildcard);
        const absolutePath = path.resolve(baseUrl, mappedPath);
        const resolved = tryResolveFile(absolutePath);
        if (resolved) return resolved;
      }
    }
  }

  return undefined;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];

/**
 * Tries to resolve a file path with common TypeScript/JavaScript extensions
 * and index file conventions.
 */
function tryResolveFile(basePath: string): string | undefined {
  // Try exact path first (already has extension)
  try {
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
      return basePath;
    }
  } catch {
    // continue
  }

  // Try with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = basePath + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }

  // Try as directory with index files
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}
