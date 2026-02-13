import * as ts from 'typescript';
import type { LocalSymbolInfo } from '../types';
import type { LocalKind } from '../types/analysis';

/**
 * Collects local (non-exported) symbols and counts their references
 */
export function collectLocals(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): LocalSymbolInfo[] {
  const locals: LocalSymbolInfo[] = [];
  const exportedNames = new Set<string>();

  // First pass: collect all exported names
  function collectExportedNames(node: ts.Node): void {
    if (hasExportModifier(node)) {
      const names = getDeclarationNames(node);
      names.forEach((name) => exportedNames.add(name));
    }

    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          exportedNames.add(element.propertyName?.text || element.name.text);
        }
      }
    }

    ts.forEachChild(node, collectExportedNames);
  }

  collectExportedNames(sourceFile);

  // Second pass: collect local symbols and count references
  const processedSymbols = new Set<ts.Symbol>();

  function visit(node: ts.Node, scope: 'top-level' | 'function' = 'top-level'): void {
    // Only collect top-level and function-level declarations
    const declarations = getLocalDeclarations(node);

    for (const decl of declarations) {
      const { name, declNode } = decl;

      // Skip if exported
      if (exportedNames.has(name)) {
        continue;
      }

      // Skip if starts with underscore (intentionally unused)
      if (name.startsWith('_')) {
        continue;
      }

      const nameNode = (declNode as unknown as { name?: ts.Node }).name;
      if (!nameNode || !ts.isIdentifier(nameNode)) {
        continue;
      }

      const symbol = checker.getSymbolAtLocation(nameNode);
      if (!symbol || processedSymbols.has(symbol)) {
        continue;
      }

      processedSymbols.add(symbol);

      // Count references
      const references = countReferences(symbol, sourceFile, checker);

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        declNode.getStart()
      );

      locals.push({
        name,
        line: line + 1,
        column: character,
        kind: getLocalKind(declNode),
        references,
      });
    }

    // Recurse into function bodies to collect function-scoped locals
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      if (node.body) {
        ts.forEachChild(node.body, (child) => visit(child, 'function'));
      }
    } else if (scope === 'top-level') {
      // Only recurse at top level to avoid nested scopes
      ts.forEachChild(node, (child) => visit(child, scope));
    }
  }

  visit(sourceFile);
  return locals;
}

/**
 * Checks if a node has an export modifier
 */
function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) {
    return false;
  }
  return modifiers.some((mod: ts.Modifier) => mod.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Gets declaration names from a node
 */
function getDeclarationNames(node: ts.Node): string[] {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return [node.name.text];
  }

  if (ts.isVariableStatement(node)) {
    const names: string[] = [];
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        names.push(decl.name.text);
      }
    }
    return names;
  }

  return [];
}

/**
 * Gets local declarations from a node (non-exported, named declarations)
 */
function getLocalDeclarations(
  node: ts.Node
): Array<{ name: string; declNode: ts.Declaration }> {
  const declarations: Array<{ name: string; declNode: ts.Declaration }> = [];

  // Function declaration
  if (ts.isFunctionDeclaration(node) && node.name && !hasExportModifier(node)) {
    declarations.push({ name: node.name.text, declNode: node });
  }

  // Class declaration
  if (ts.isClassDeclaration(node) && node.name && !hasExportModifier(node)) {
    declarations.push({ name: node.name.text, declNode: node });
  }

  // Variable statement
  if (ts.isVariableStatement(node) && !hasExportModifier(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        declarations.push({ name: decl.name.text, declNode: decl });
      } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
        collectBindingElements(decl.name, declarations);
      }
    }
  }

  // Parameters (function-scoped)
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  ) {
    for (const param of node.parameters) {
      if (ts.isIdentifier(param.name)) {
        declarations.push({ name: param.name.text, declNode: param });
      } else if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) {
        collectBindingElements(param.name, declarations);
      }
    }
  }

  return declarations;
}

/**
 * Counts references to a symbol within a source file
 */
function countReferences(
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): number {
  let count = 0;
  const declarations = symbol.getDeclarations() || [];
  const declarationNodes = new Set(declarations);

  function visit(node: ts.Node): void {
    // Only count identifier references, not declarations
    if (ts.isIdentifier(node) && !declarationNodes.has(node.parent as ts.Declaration)) {
      const nodeSymbol = checker.getSymbolAtLocation(node);
      if (nodeSymbol === symbol) {
        count++;
      } else if (
        ts.isShorthandPropertyAssignment(node.parent) &&
        node.parent.name === node
      ) {
        // In ShorthandPropertyAssignment ({ x }), getSymbolAtLocation returns the
        // property symbol, not the local variable symbol. Use
        // getShorthandAssignmentValueSymbol to get the actual variable symbol.
        const valueSymbol = checker.getShorthandAssignmentValueSymbol(node.parent);
        if (valueSymbol === symbol) {
          count++;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Subtract 1 if we counted the declaration itself
  // (this can happen if the declaration is an initializer expression)
  return Math.max(0, count);
}

/**
 * Collects binding elements from object/array destructuring patterns.
 * Implements ignoreRestSiblings: when a rest element (...rest) is present in
 * an object destructuring, non-rest siblings are skipped (omit pattern).
 */
function collectBindingElements(
  pattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern,
  declarations: Array<{ name: string; declNode: ts.Declaration }>
): void {
  const isObjPattern = ts.isObjectBindingPattern(pattern);
  const hasRest = isObjPattern && pattern.elements.some(e => e.dotDotDotToken);

  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element)) continue;

    if (ts.isIdentifier(element.name)) {
      // ignoreRestSiblings: in object destructuring with rest element,
      // non-rest siblings are intentional omit patterns — skip them
      if (hasRest && !element.dotDotDotToken) {
        continue;
      }
      declarations.push({ name: element.name.text, declNode: element });
    } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
      // Nested destructuring — recurse
      collectBindingElements(element.name, declarations);
    }
  }
}

/**
 * Determines the local kind based on the node type
 */
function getLocalKind(node: ts.Node): LocalKind {
  if (ts.isFunctionDeclaration(node)) {
    return 'function';
  }
  if (ts.isClassDeclaration(node)) {
    return 'class';
  }
  if (ts.isVariableDeclaration(node)) {
    return 'variable';
  }
  if (ts.isParameter(node)) {
    return 'parameter';
  }
  return 'unknown';
}
