import * as ts from 'typescript';
import type { ExportInfo } from '../types';
import type { ExportKind } from '../types/analysis';

/**
 * Collects all exports from a source file
 */
export function collectExports(sourceFile: ts.SourceFile): ExportInfo[] {
  const exports: ExportInfo[] = [];

  function visit(node: ts.Node): void {
    // export const/let/var x = ...
    // export function x() {}
    // export class X {}
    // export type X = ...
    // export interface X {}
    // export enum X {}
    if (hasExportModifier(node)) {
      const isDefault = hasDefaultModifier(node);
      const declarations = getDeclarations(node);
      for (const decl of declarations) {
        let position: number;
        if (decl.name === null) {
          position = node.getStart();
        } else if (typeof decl.name === 'string') {
          position = node.getStart();
        } else {
          position = decl.node.getStart();
        }
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);

        exports.push({
          name: isDefault ? 'default' : (decl.name || 'default'),
          isDefault: isDefault,
          isReExport: false,
          line: line + 1, // Convert to 1-based
          column: character,
          kind: isDefault ? 'default' : getExportKind(node),
          isTypeOnly: isTypeOnlyExport(node),
        });
      }
    }

    // export default ...
    if (ts.isExportAssignment(node)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart()
      );

      exports.push({
        name: 'default',
        isDefault: true,
        isReExport: false,
        line: line + 1,
        column: character,
        kind: 'default',
        isTypeOnly: false,
      });
    }

    // export { x, y }
    // export { x as y }
    // export { x } from 'module'
    if (ts.isExportDeclaration(node)) {
      const exportDecl = node;
      const isTypeOnly = exportDecl.isTypeOnly || false;

      // Re-export: export { x } from 'module'
      if (exportDecl.moduleSpecifier && ts.isStringLiteral(exportDecl.moduleSpecifier)) {
        const reExportSource = exportDecl.moduleSpecifier.text;

        if (exportDecl.exportClause) {
          if (ts.isNamedExports(exportDecl.exportClause)) {
            // export { x, y } from 'module'
            for (const element of exportDecl.exportClause.elements) {
              const { line, character } =
                sourceFile.getLineAndCharacterOfPosition(element.getStart());

              exports.push({
                name: element.name.text,
                isDefault: false,
                isReExport: true,
                reExportSource,
                line: line + 1,
                column: character,
                kind: 'unknown',
                isTypeOnly,
              });
            }
          } else if (ts.isNamespaceExport(exportDecl.exportClause)) {
            // export * as X from 'module'
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
              exportDecl.exportClause.getStart()
            );

            exports.push({
              name: exportDecl.exportClause.name.text,
              isDefault: false,
              isReExport: true,
              reExportSource,
              line: line + 1,
              column: character,
              kind: 'unknown',
              isTypeOnly,
            });
          }
        } else {
          // export * from 'module'
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            exportDecl.getStart()
          );

          exports.push({
            name: '*',
            isDefault: false,
            isReExport: true,
            reExportSource,
            line: line + 1,
            column: character,
            kind: 'unknown',
            isTypeOnly,
          });
        }
      } else if (exportDecl.exportClause && ts.isNamedExports(exportDecl.exportClause)) {
        // export { x, y } - local re-export
        for (const element of exportDecl.exportClause.elements) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            element.getStart()
          );

          exports.push({
            name: element.name.text,
            isDefault: false,
            isReExport: false,
            line: line + 1,
            column: character,
            kind: 'unknown',
            isTypeOnly,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

/**
 * Checks if a node has the 'default' modifier (e.g. export default function X)
 */
function hasDefaultModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) {
    return false;
  }
  return modifiers.some(
    (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword
  );
}

/**
 * Checks if a node has an export modifier
 */
function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) {
    return false;
  }
  return modifiers.some(
    (mod) => mod.kind === ts.SyntaxKind.ExportKeyword
  );
}

/**
 * Gets declarations from an exported node
 */
function getDeclarations(
  node: ts.Node
): Array<{ name: string | null; node: ts.Node }> {
  // Function declaration: export function x() {}
  if (ts.isFunctionDeclaration(node) && node.name) {
    return [{ name: node.name.text, node }];
  }

  // Class declaration: export class X {}
  if (ts.isClassDeclaration(node) && node.name) {
    return [{ name: node.name.text, node }];
  }

  // Type alias: export type X = ...
  if (ts.isTypeAliasDeclaration(node)) {
    return [{ name: node.name.text, node }];
  }

  // Interface: export interface X {}
  if (ts.isInterfaceDeclaration(node)) {
    return [{ name: node.name.text, node }];
  }

  // Enum: export enum X {}
  if (ts.isEnumDeclaration(node)) {
    return [{ name: node.name.text, node }];
  }

  // Variable statement: export const x = ..., y = ...
  if (ts.isVariableStatement(node)) {
    const declarations: Array<{ name: string | null; node: ts.Node }> = [];
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        declarations.push({ name: decl.name.text, node: decl });
      }
    }
    return declarations;
  }

  return [];
}

/**
 * Determines the export kind based on the node type
 */
function getExportKind(node: ts.Node): ExportKind {
  if (ts.isFunctionDeclaration(node)) {
    return 'function';
  }
  if (ts.isClassDeclaration(node)) {
    return 'class';
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return 'type';
  }
  if (ts.isInterfaceDeclaration(node)) {
    return 'interface';
  }
  if (ts.isEnumDeclaration(node)) {
    return 'enum';
  }
  if (ts.isVariableStatement(node)) {
    return 'variable';
  }
  return 'unknown';
}

/**
 * Checks if an export is type-only
 */
function isTypeOnlyExport(node: ts.Node): boolean {
  // Type aliases, interfaces are always type-only
  if (
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node)
  ) {
    return true;
  }

  // Check for 'export type' modifier (TS 3.8+)
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (modifiers) {
    return modifiers.some(
      (mod: ts.Modifier) =>
        mod.kind === ts.SyntaxKind.ExportKeyword &&
        (mod as unknown as { isTypeOnly?: boolean }).isTypeOnly === true
    );
  }

  return false;
}
