import * as ts from 'typescript';
import type { LocalSymbolInfo } from '../types';
import type { LocalKind } from '../types/analysis';

/** Function-like nodes whose parameters may be collected */
type FunctionLikeWithBody =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

/** Class members that can be private */
type ClassMemberLike =
  | ts.MethodDeclaration
  | ts.PropertyDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

interface LocalCandidate {
  name: string;
  declNode: ts.Declaration;
  kind: LocalKind;
  symbol: ts.Symbol;
  isParameterProperty?: boolean;
}

/**
 * Adds a candidate local symbol.
 * `nameNode` is the node used to resolve the symbol (identifier / private identifier).
 */
type AddCandidate = (
  name: string,
  declNode: ts.Declaration,
  nameNode: ts.Node,
  kind: LocalKind,
  isParameterProperty?: boolean
) => void;

/**
 * Collects local (non-exported) symbols and counts their references.
 *
 * The collector performs two linear walks over the source file:
 *  1. candidate collection (declarations of locals, private members, parameters)
 *  2. reference counting for all candidate symbols at once
 *
 * Parameter usage checks are performed per function body, so the total amount of
 * work stays proportional to the size of the file.
 */
export function collectLocals(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): LocalSymbolInfo[] {
  const exportedNames = collectExportedNames(sourceFile);
  const candidates: LocalCandidate[] = [];
  const seen = new Set<ts.Symbol>();

  const add: AddCandidate = (name, declNode, nameNode, kind, isParameterProperty) => {
    // Class members keep their own visibility rules — an exported name in the
    // same file must not hide a private member with the same name.
    if (kind !== 'method' && kind !== 'field' && exportedNames.has(name)) {
      return;
    }
    // Underscore prefix marks an intentionally unused symbol (also `#_x`)
    if (name.startsWith('_') || name.startsWith('#_')) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(nameNode);
    if (!symbol || seen.has(symbol)) {
      return;
    }
    seen.add(symbol);
    candidates.push({ name, declNode, kind, symbol, isParameterProperty });
  };

  function visit(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      !hasExportModifier(node)
    ) {
      add(
        node.name.text,
        node,
        node.name,
        ts.isFunctionDeclaration(node) ? 'function' : 'class'
      );
    }

    if (ts.isVariableStatement(node) && !hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        collectDeclarationName(decl.name, decl, add);
      }
    }

    // `for` / `for-of` / `for-in` bindings are real locals: an unused loop
    // binding is dead code. Catch-clause variables are deliberately NOT
    // collected — an unused `catch (e)` binding is idiomatic and TS 4.0+ allows
    // omitting it entirely, so reporting it would be a false positive.
    if (
      (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const decl of node.initializer.declarations) {
        collectDeclarationName(decl.name, decl, add);
      }
    }

    if (isFunctionLike(node) && node.body) {
      collectParameters(node, checker, add);
    }

    if (ts.isClassLike(node)) {
      collectPrivateMembers(node, add);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Private members can also be reached through element access (`this['x']`),
  // which cannot be resolved by name through the checker.
  const memberSymbolsByName = new Map<string, ts.Symbol[]>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'method' && candidate.kind !== 'field') {
      continue;
    }
    const existing = memberSymbolsByName.get(candidate.name);
    if (existing) {
      existing.push(candidate.symbol);
    } else {
      memberSymbolsByName.set(candidate.name, [candidate.symbol]);
    }
  }

  const counts = countReferences(
    sourceFile,
    checker,
    new Set(candidates.map((c) => c.symbol)),
    new Set(candidates.map((c) => c.name)),
    memberSymbolsByName
  );

  return candidates.map((candidate) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      candidate.declNode.getStart()
    );
    const local: LocalSymbolInfo = {
      name: candidate.name,
      line: line + 1,
      column: character,
      kind: candidate.kind,
      references: counts.get(candidate.symbol) ?? 0,
    };
    if (candidate.isParameterProperty) {
      local.isParameterProperty = true;
    }
    return local;
  });
}

/**
 * Collects every name that is exported from the file
 */
function collectExportedNames(sourceFile: ts.SourceFile): Set<string> {
  const exportedNames = new Set<string>();

  function visit(node: ts.Node): void {
    if (hasExportModifier(node)) {
      for (const name of getDeclarationNames(node)) {
        exportedNames.add(name);
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        exportedNames.add(element.propertyName?.text || element.name.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exportedNames;
}

/**
 * Checks if a node has an export modifier
 */
function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

/**
 * Checks whether a node carries the given modifier keyword
 */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) {
    return false;
  }
  return modifiers.some((mod: ts.Modifier) => mod.kind === kind);
}

/**
 * Checks whether a node carries any decorator
 */
function hasDecorators(node: ts.Node): boolean {
  if (!ts.canHaveDecorators(node)) {
    return false;
  }
  const decorators = ts.getDecorators(node);
  return decorators !== undefined && decorators.length > 0;
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
 * Checks whether a node is a function-like declaration that can own parameters
 */
function isFunctionLike(node: ts.Node): node is FunctionLikeWithBody {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

/**
 * Collects the name(s) declared by a variable declaration
 */
function collectDeclarationName(
  name: ts.BindingName,
  decl: ts.VariableDeclaration,
  add: AddCandidate
): void {
  if (ts.isIdentifier(name)) {
    add(name.text, decl, name, 'variable');
    return;
  }
  collectBindingElements(name, add, 'variable');
}

/**
 * Collects binding elements from object/array destructuring patterns.
 * Implements ignoreRestSiblings: when a rest element (...rest) is present in
 * an object destructuring, non-rest siblings are skipped (omit pattern).
 */
function collectBindingElements(
  pattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern,
  add: AddCandidate,
  kind: LocalKind
): void {
  const isObjPattern = ts.isObjectBindingPattern(pattern);
  const hasRest = isObjPattern && pattern.elements.some((e) => e.dotDotDotToken);

  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element)) {
      continue;
    }

    if (ts.isIdentifier(element.name)) {
      // ignoreRestSiblings: in object destructuring with rest element,
      // non-rest siblings are intentional omit patterns — skip them
      if (hasRest && !element.dotDotDotToken) {
        continue;
      }
      add(element.name.text, element, element.name, kind);
    } else if (
      ts.isObjectBindingPattern(element.name) ||
      ts.isArrayBindingPattern(element.name)
    ) {
      // Nested destructuring — recurse
      collectBindingElements(element.name, add, kind);
    }
  }
}

/**
 * Collects unused-candidate parameters of a function-like node.
 *
 * Rules (mirroring eslint's `no-unused-vars` with `args: 'after-used'`):
 *  - parameters before (and including) the last used parameter are never reported
 *  - `this` parameters and rest parameters are skipped
 *  - decorated functions/members, abstract members and overload implementations
 *    are skipped because their signature is imposed from the outside
 *  - members of classes with `extends`/`implements` or class decorators are skipped
 *  - constructor parameter properties are collected as fields (private only)
 *  - destructured parameters are collected element-wise regardless of position
 */
function collectParameters(
  fn: FunctionLikeWithBody,
  checker: ts.TypeChecker,
  add: AddCandidate
): void {
  const parameters = fn.parameters;
  if (parameters.length === 0) {
    return;
  }

  // A setter must syntactically declare exactly one parameter — the developer
  // cannot remove it, so reporting it is never actionable.
  if (ts.isSetAccessor(fn)) {
    return;
  }

  if (hasDecorators(fn) || hasModifier(fn, ts.SyntaxKind.AbstractKeyword)) {
    return;
  }

  // Members of classes with a base type / decorator must keep their signature
  if (isConstrainedByClassContext(fn)) {
    return;
  }

  // Overload implementations must keep every parameter of their signatures
  if (isOverloadImplementation(fn, checker)) {
    return;
  }

  const entries = buildParameterEntries(fn, add);
  if (entries.length === 0) {
    return;
  }

  markParameterUsage(fn, checker, entries);

  let lastUsedPosition = -1;
  entries.forEach((entry, position) => {
    if (entry.used) {
      lastUsedPosition = position;
    }
  });

  // `after-used`: a name with no reference is only reported when no parameter
  // declared after it is used. Used names are still collected — they carry a
  // non-zero reference count and are therefore never reported as unused.
  entries.forEach((entry, position) => {
    if (!entry.collectible) {
      return;
    }
    if (!entry.used && position <= lastUsedPosition) {
      return;
    }
    add(entry.nameNode.text, entry.declNode, entry.nameNode, 'parameter');
  });
}

/**
 * A parameter name in declaration order, mirroring eslint's
 * `getDeclaredVariables(node)` ordering used by `args: 'after-used'`.
 */
interface ParameterEntry {
  nameNode: ts.Identifier;
  declNode: ts.Declaration;
  /** false for names that must never be reported but still affect ordering */
  collectible: boolean;
  used: boolean;
}

/**
 * Flattens the parameter list into declared-name order.
 * Constructor parameter properties are added directly as fields (private only)
 * because they are class state, not positional parameters.
 */
function buildParameterEntries(
  fn: FunctionLikeWithBody,
  add: AddCandidate
): ParameterEntry[] {
  const entries: ParameterEntry[] = [];

  for (const param of fn.parameters) {
    // `this` parameters are type-only and never occupy an argument position
    if (ts.isIdentifier(param.name) && param.name.text === 'this') {
      continue;
    }

    // Decorated parameters are injected by a framework (@Inject, @Body, ...)
    const decorated = hasDecorators(param);

    if (ts.isConstructorDeclaration(fn) && isParameterProperty(param)) {
      if (
        !decorated &&
        hasModifier(param, ts.SyntaxKind.PrivateKeyword) &&
        ts.isIdentifier(param.name)
      ) {
        // `public` / `protected` parameter properties are part of the public API
        add(param.name.text, param, param.name, 'field', true);
      }
      continue;
    }

    // Rest parameters cannot be removed without changing the call contract
    const collectible = !decorated && !param.dotDotDotToken;

    if (ts.isIdentifier(param.name)) {
      entries.push({
        nameNode: param.name,
        declNode: param,
        collectible,
        used: false,
      });
      continue;
    }

    collectPatternEntries(param.name, collectible, entries);
  }

  return entries;
}

/**
 * Flattens a destructuring pattern into ordered parameter entries.
 * ignoreRestSiblings is applied: siblings of a rest element keep their position
 * but are never reported (they are intentional omit patterns).
 */
function collectPatternEntries(
  pattern: ts.ObjectBindingPattern | ts.ArrayBindingPattern,
  collectible: boolean,
  entries: ParameterEntry[]
): void {
  const hasRest =
    ts.isObjectBindingPattern(pattern) &&
    pattern.elements.some((e) => e.dotDotDotToken);

  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element)) {
      continue;
    }
    if (ts.isIdentifier(element.name)) {
      entries.push({
        nameNode: element.name,
        declNode: element,
        collectible: collectible && !(hasRest && !element.dotDotDotToken),
        used: false,
      });
    } else {
      collectPatternEntries(element.name, collectible, entries);
    }
  }
}

/**
 * Checks whether a function-like node belongs to a class whose members must keep
 * their signature (base type contract or framework decorator). Also covers class
 * property arrow functions (`private onClick = (e) => ...`).
 */
function isConstrainedByClassContext(fn: FunctionLikeWithBody): boolean {
  const parent = fn.parent;

  if (
    (ts.isMethodDeclaration(fn) ||
      ts.isConstructorDeclaration(fn) ||
      ts.isGetAccessor(fn) ||
      ts.isSetAccessor(fn)) &&
    ts.isClassLike(parent)
  ) {
    return isConstrainedClass(parent);
  }

  if (ts.isPropertyDeclaration(parent) && ts.isClassLike(parent.parent)) {
    return hasDecorators(parent) || isConstrainedClass(parent.parent);
  }

  return false;
}

/**
 * A class with a base type or a decorator imposes signatures on its members
 */
function isConstrainedClass(cls: ts.ClassLikeDeclaration): boolean {
  if (cls.heritageClauses && cls.heritageClauses.length > 0) {
    return true;
  }
  return hasDecorators(cls);
}

/**
 * Checks whether a parameter is a constructor parameter property
 */
function isParameterProperty(param: ts.ParameterDeclaration): boolean {
  return (
    hasModifier(param, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(param, ts.SyntaxKind.ProtectedKeyword) ||
    hasModifier(param, ts.SyntaxKind.PublicKeyword) ||
    hasModifier(param, ts.SyntaxKind.ReadonlyKeyword) ||
    hasModifier(param, ts.SyntaxKind.OverrideKeyword)
  );
}

/**
 * Checks whether a function/method is the implementation of an overload set
 */
function isOverloadImplementation(
  fn: FunctionLikeWithBody,
  checker: ts.TypeChecker
): boolean {
  // Constructors have no name — look for body-less sibling constructors instead
  if (ts.isConstructorDeclaration(fn) && ts.isClassLike(fn.parent)) {
    return fn.parent.members.some(
      (member) => ts.isConstructorDeclaration(member) && !member.body
    );
  }

  const name = (fn as ts.NamedDeclaration).name;
  if (!name || (!ts.isIdentifier(name) && !ts.isPrivateIdentifier(name))) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(name);
  const declarations = symbol?.declarations;
  return declarations !== undefined && declarations.length > 1;
}

/**
 * Marks every parameter entry that is referenced inside the function body.
 * Identifier resolution is only attempted for identifiers whose text matches a
 * parameter name, which keeps the walk cheap.
 */
function markParameterUsage(
  fn: FunctionLikeWithBody,
  checker: ts.TypeChecker,
  entries: ParameterEntry[]
): void {
  if (!fn.body) {
    return;
  }

  const symbolToEntry = new Map<ts.Symbol, ParameterEntry>();
  const parameterNames = new Set<string>();

  for (const entry of entries) {
    parameterNames.add(entry.nameNode.text);
    const symbol = checker.getSymbolAtLocation(entry.nameNode);
    if (symbol && !symbolToEntry.has(symbol)) {
      symbolToEntry.set(symbol, entry);
    }
  }

  if (parameterNames.size === 0) {
    return;
  }

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && parameterNames.has(node.text)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (
        (!symbol || !symbolToEntry.has(symbol)) &&
        ts.isShorthandPropertyAssignment(node.parent) &&
        node.parent.name === node
      ) {
        symbol = checker.getShorthandAssignmentValueSymbol(node.parent) ?? symbol;
      }
      const entry = symbol ? symbolToEntry.get(symbol) : undefined;
      if (entry) {
        entry.used = true;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(fn.body);
}

/**
 * Collects private members (private modifier or `#name`) of a class
 */
function collectPrivateMembers(cls: ts.ClassLikeDeclaration, add: AddCandidate): void {
  for (const member of cls.members) {
    if (!isClassMemberLike(member)) {
      continue;
    }
    // Decorated members are wired up by frameworks (DI, validation, ORM)
    if (hasDecorators(member) || hasModifier(member, ts.SyntaxKind.AbstractKeyword)) {
      continue;
    }

    const nameNode = member.name;
    const isPrivateName = ts.isPrivateIdentifier(nameNode);
    if (!isPrivateName && !hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
      continue;
    }

    const isMethodLike =
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessor(member) ||
      ts.isSetAccessor(member);

    // Overload signatures have no body — only the implementation is collected
    if (isMethodLike && !member.body) {
      continue;
    }

    let nameText: string | undefined;
    if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode)) {
      nameText = nameNode.text;
    } else if (ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
      nameText = nameNode.text;
    }
    if (!nameText) {
      continue;
    }

    add(nameText, member, nameNode, isMethodLike ? 'method' : 'field');
  }
}

/**
 * Checks whether a class element can carry a private modifier
 */
function isClassMemberLike(member: ts.ClassElement): member is ClassMemberLike {
  return (
    ts.isMethodDeclaration(member) ||
    ts.isPropertyDeclaration(member) ||
    ts.isGetAccessor(member) ||
    ts.isSetAccessor(member)
  );
}

/**
 * Counts references to every candidate symbol in a single walk of the file.
 * The declaration site of a symbol never counts as a reference.
 */
function countReferences(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  symbols: Set<ts.Symbol>,
  names: Set<string>,
  memberSymbolsByName: Map<string, ts.Symbol[]>
): Map<ts.Symbol, number> {
  const counts = new Map<ts.Symbol, number>();
  if (symbols.size === 0) {
    return counts;
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) &&
      names.has(node.text)
    ) {
      let symbol = checker.getSymbolAtLocation(node);

      if (
        (!symbol || !symbols.has(symbol)) &&
        ts.isShorthandPropertyAssignment(node.parent) &&
        node.parent.name === node
      ) {
        // In a ShorthandPropertyAssignment ({ x }), getSymbolAtLocation returns
        // the property symbol, not the local variable symbol.
        symbol = checker.getShorthandAssignmentValueSymbol(node.parent) ?? symbol;
      }

      if (symbol && symbols.has(symbol) && !isOwnDeclarationName(node, symbol)) {
        counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
      }
    }

    // `this['name']` / `obj['name']` — matched by name against class members
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      if (
        ts.isStringLiteralLike(argument) &&
        memberSymbolsByName.has(argument.text)
      ) {
        for (const symbol of memberSymbolsByName.get(argument.text)!) {
          counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return counts;
}

/**
 * Checks whether an identifier is the name of one of the symbol's declarations
 */
function isOwnDeclarationName(node: ts.Node, symbol: ts.Symbol): boolean {
  const parent = node.parent as ts.NamedDeclaration | undefined;
  if (!parent || parent.name !== node) {
    return false;
  }
  const declarations = symbol.declarations;
  return declarations !== undefined && declarations.includes(parent as ts.Declaration);
}
