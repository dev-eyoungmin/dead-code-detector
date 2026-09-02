import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import type { ImportInfo, ImportSpecifier } from '../types';

const NAMESPACE_SPECIFIER: ImportSpecifier = {
  name: '*',
  isDefault: false,
  isNamespace: true,
};

/**
 * Collects all imports from a source file
 *
 * @param rootDir Optional workspace root. When provided, node_modules resolutions whose
 *                real path lives inside the workspace (symlinked monorepo packages) are
 *                treated as internal files instead of external modules.
 */
export function collectImports(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  rootDir?: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const fileDir = path.dirname(sourceFile.fileName);
  const normalizedRoot = normalizeRootDir(rootDir);

  const resolve = (source: string): string =>
    resolveImportPath(source, fileDir, program, normalizedRoot);

  function visit(node: ts.Node, parent?: ts.Node): void {
    // import x from 'module'
    // import { x, y } from 'module'
    // import * as x from 'module'
    if (ts.isImportDeclaration(node)) {
      const importDecl = node;
      const moduleSpecifier = importDecl.moduleSpecifier;

      if (ts.isStringLiteral(moduleSpecifier)) {
        const source = moduleSpecifier.text;
        const resolvedPath = resolve(source);
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
        const resolvedPath = resolve(source);

        imports.push({
          source,
          resolvedPath,
          specifiers: [{ ...NAMESPACE_SPECIFIER }],
          isNamespaceImport: true,
          isDynamicImport: true,
          isTypeOnly: false,
        });
      } else {
        // import(`./locales/${lang}`) / import('./locales/' + lang + '.ts')
        const prefix = getStaticPrefix(arg);
        if (prefix !== undefined && prefix.length > 0) {
          const glob = globFromPrefix(prefix, fileDir);
          imports.push({
            source: prefix,
            resolvedPath: glob.basePath,
            specifiers: [{ ...NAMESPACE_SPECIFIER }],
            isNamespaceImport: true,
            isDynamicImport: true,
            isTypeOnly: false,
            globPattern: glob.pattern,
          });
        }
      }
    }

    // export * from 'module' / export { x } from 'module' — treated as imports too
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const source = node.moduleSpecifier.text;
      const resolvedPath = resolve(source);
      const specifiers: ImportSpecifier[] = [];
      let isNamespaceImport = false;
      let isStarReExport = false;
      let isNamedReExport = false;

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        // export { x, y } from 'module' — a forward, not a consumption
        isNamedReExport = true;
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
        // isNamespaceImport stays true for backward compatibility
        isNamespaceImport = true;
        isStarReExport = true;
        specifiers.push({ ...NAMESPACE_SPECIFIER });
      }

      imports.push({
        source,
        resolvedPath,
        specifiers,
        isNamespaceImport,
        isDynamicImport: false,
        isTypeOnly: node.isTypeOnly || false,
        ...(isStarReExport ? { isStarReExport: true } : {}),
        ...(isNamedReExport ? { isNamedReExport: true } : {}),
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
        const resolvedPath = resolve(source);
        const destructured = getRequireDestructuring(parent);

        imports.push({
          source,
          resolvedPath,
          specifiers: destructured ?? [{ ...NAMESPACE_SPECIFIER }],
          isNamespaceImport: destructured === undefined,
          isDynamicImport: false,
          isTypeOnly: false,
        });
      }
    }

    // import.meta.glob('./mods/*.ts') / import.meta.globEager(...)
    if (isImportMetaGlobCall(node)) {
      for (const literal of getGlobLiterals(node.arguments[0])) {
        const absolute = path.resolve(fileDir, literal);
        imports.push({
          source: literal,
          resolvedPath: absolute,
          specifiers: [{ ...NAMESPACE_SPECIFIER }],
          isNamespaceImport: true,
          isDynamicImport: true,
          isTypeOnly: false,
          globPattern: absolute,
        });
      }
    }

    // require.context('./mods', true, /\.ts$/)
    if (isRequireContextCall(node)) {
      const arg = node.arguments[0];
      if (ts.isStringLiteralLike(arg)) {
        const absolute = path.resolve(fileDir, arg.text);
        imports.push({
          source: arg.text,
          resolvedPath: absolute,
          specifiers: [{ ...NAMESPACE_SPECIFIER }],
          isNamespaceImport: true,
          isDynamicImport: true,
          isTypeOnly: false,
          globPattern: absolute + '/**',
        });
      }
    }

    // new Worker(new URL('./w.ts', import.meta.url)) / new SharedWorker('./w.ts')
    // new URL('./asset.ts', import.meta.url)
    const assetSource = getRuntimeAssetSource(node, parent);
    if (assetSource !== undefined) {
      const resolvedPath = resolve(assetSource);
      if (isExistingFile(resolvedPath)) {
        imports.push({
          source: assetSource,
          resolvedPath,
          specifiers: [{ ...NAMESPACE_SPECIFIER }],
          isNamespaceImport: true,
          isDynamicImport: true,
          isTypeOnly: false,
        });
      }
    }

    ts.forEachChild(node, (child) => visit(child, node));
  }

  visit(sourceFile);
  return imports;
}

/**
 * Returns named specifiers when a require() call initializes an object binding
 * pattern: `const { a, b: renamed } = require('./x')`.
 * Returns undefined when the whole module is bound (namespace import).
 */
function getRequireDestructuring(
  parent: ts.Node | undefined
): ImportSpecifier[] | undefined {
  if (!parent || !ts.isVariableDeclaration(parent)) {
    return undefined;
  }
  if (!ts.isObjectBindingPattern(parent.name)) {
    return undefined;
  }

  const specifiers: ImportSpecifier[] = [];
  for (const element of parent.name.elements) {
    // `const { ...rest } = require(...)` may touch any export → namespace
    if (element.dotDotDotToken) {
      return undefined;
    }

    const propertyName = element.propertyName
      ? getBindingPropertyName(element.propertyName)
      : undefined;
    const localName = ts.isIdentifier(element.name)
      ? element.name.text
      : undefined;
    const name = propertyName ?? localName;
    if (!name) {
      continue;
    }

    specifiers.push({
      name,
      alias: propertyName && localName ? localName : undefined,
      isDefault: false,
      isNamespace: false,
    });
  }

  return specifiers;
}

function getBindingPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/**
 * Extracts the static leading part of a dynamic import specifier:
 * `\`./locales/${x}\`` → './locales/', `'./locales/' + x + '.ts'` → './locales/'
 */
function getStaticPrefix(node: ts.Expression): string | undefined {
  if (ts.isTemplateExpression(node)) {
    return node.head.text;
  }

  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
      return undefined;
    }
    // Walk down to the left-most operand of the concatenation chain
    let left: ts.Expression = node.left;
    while (
      ts.isBinaryExpression(left) &&
      left.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      left = left.left;
    }
    if (ts.isStringLiteralLike(left)) {
      return left.text;
    }
    if (ts.isTemplateExpression(left)) {
      return left.head.text;
    }
  }

  return undefined;
}

/**
 * Builds an absolute glob pattern from the static prefix of a dynamic import.
 */
function globFromPrefix(
  prefix: string,
  containingFileDir: string
): { basePath: string; pattern: string } {
  const absolute = path.resolve(containingFileDir, prefix);
  const isDirectory =
    prefix.endsWith('/') || prefix.endsWith(path.sep) || isExistingDirectory(absolute);

  return {
    basePath: absolute,
    pattern: isDirectory ? absolute + '/**' : absolute + '*',
  };
}

function isImportMetaGlobCall(
  node: ts.Node
): node is ts.CallExpression & { arguments: ts.NodeArray<ts.Expression> } {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) {
    return false;
  }
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isMetaProperty(callee.expression) &&
    callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    (callee.name.text === 'glob' || callee.name.text === 'globEager')
  );
}

function isRequireContextCall(
  node: ts.Node
): node is ts.CallExpression & { arguments: ts.NodeArray<ts.Expression> } {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) {
    return false;
  }
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'require' &&
    callee.name.text === 'context'
  );
}

/** import.meta.glob accepts a single pattern or an array of patterns */
function getGlobLiterals(arg: ts.Expression): string[] {
  if (ts.isStringLiteralLike(arg)) {
    return [arg.text];
  }
  if (ts.isArrayLiteralExpression(arg)) {
    return arg.elements
      .filter(ts.isStringLiteralLike)
      .map((element) => element.text);
  }
  return [];
}

/**
 * Resolves the module specifier referenced by runtime asset constructors:
 * `new Worker(new URL('./w.ts', import.meta.url))`, `new SharedWorker('./w.ts')`,
 * `new URL('./w.ts', import.meta.url)`.
 * Returns undefined when the node is not such a reference, or when it is a
 * `new URL(...)` already consumed by an enclosing Worker (collected once).
 */
function getRuntimeAssetSource(
  node: ts.Node,
  parent: ts.Node | undefined
): string | undefined {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) {
    return undefined;
  }
  const args = node.arguments;
  if (!args || args.length === 0) {
    return undefined;
  }
  const calleeName = node.expression.text;

  if (calleeName === 'Worker' || calleeName === 'SharedWorker') {
    const first = args[0];
    if (ts.isStringLiteralLike(first)) {
      return first.text;
    }
    // new Worker(new URL('./w.ts', import.meta.url))
    const nestedUrlArg = getUrlConstructionSpecifier(first);
    if (nestedUrlArg !== undefined) {
      return nestedUrlArg;
    }
    return undefined;
  }

  if (calleeName === 'URL') {
    if (!ts.isStringLiteralLike(args[0]) || args.length < 2 || !isImportMetaUrl(args[1])) {
      return undefined;
    }
    // Already collected through the enclosing `new Worker(new URL(...))`
    if (isWorkerArgument(node, parent)) {
      return undefined;
    }
    return args[0].text;
  }

  return undefined;
}

/** `new URL('./w.ts', import.meta.url)` → './w.ts' */
function getUrlConstructionSpecifier(node: ts.Expression): string | undefined {
  if (
    !ts.isNewExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'URL' ||
    !node.arguments ||
    node.arguments.length === 0
  ) {
    return undefined;
  }
  const first = node.arguments[0];
  return ts.isStringLiteralLike(first) ? first.text : undefined;
}

function isWorkerArgument(node: ts.Node, parent: ts.Node | undefined): boolean {
  return (
    !!parent &&
    ts.isNewExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    (parent.expression.text === 'Worker' || parent.expression.text === 'SharedWorker') &&
    parent.arguments?.[0] === node
  );
}

function isImportMetaUrl(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === 'url'
  );
}

/**
 * Resolves an import path to an absolute file path
 */
function resolveImportPath(
  importPath: string,
  containingFileDir: string,
  program: ts.Program,
  /** Already normalized by normalizeRootDir(): no trailing separator */
  normalizedRoot?: string
): string {
  // Strip bundler suffixes: './w?worker', './style.css?raw', './mod#frag'
  const clean = importPath.replace(/[?#].*$/, '');
  if (clean.length === 0) {
    return importPath;
  }

  // 1. Always try TS resolver first (handles path aliases, baseUrl, etc.)
  const compilerOptions = program.getCompilerOptions();
  const resolved = ts.resolveModuleName(
    clean,
    path.join(containingFileDir, 'dummy.ts'),
    compilerOptions,
    ts.sys
  );

  if (resolved.resolvedModule) {
    // node_modules module → external, unless it is a symlinked workspace package
    if (resolved.resolvedModule.isExternalLibraryImport) {
      // Symlinked workspace package (monorepo): real path lives inside the workspace
      if (normalizedRoot) {
        const real = safeRealpath(resolved.resolvedModule.resolvedFileName);
        if (
          real.startsWith(normalizedRoot + path.sep) &&
          !real.split(path.sep).includes('node_modules')
        ) {
          return path.normalize(real);
        }
      }
      return importPath;
    }
    return path.normalize(resolved.resolvedModule.resolvedFileName);
  }

  // 2. TS resolution failed + non-relative path → try path alias fallback before treating as external
  if (!clean.startsWith('.') && !clean.startsWith('/')) {
    const aliasResolved = resolveWithPathAlias(clean, compilerOptions);
    if (aliasResolved) {
      return path.normalize(aliasResolved);
    }
    // Still not resolved → external module
    return importPath;
  }

  // 3. Relative path fallback
  return resolvePathManually(clean, containingFileDir);
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

const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.vue',
  '.svelte',
];

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

function isExistingFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Normalizes the workspace root so prefix comparisons are reliable:
 * collapses separators and strips any trailing separator ('/foo/' -> '/foo').
 */
function normalizeRootDir(rootDir?: string): string | undefined {
  if (!rootDir) {
    return undefined;
  }
  const normalized = path.normalize(rootDir).replace(/[/\\]+$/, '');
  return normalized.length > 0 ? normalized : rootDir;
}

function safeRealpath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}
