import type { ImportInfo, ImportSpecifier } from '../../../types';
import { stripPhpCommentsAndStrings } from './phpSource';
import {
  parseNamespace,
  parseUseStatements,
  resolveClassReference,
  resolveInclude,
  type PhpResolverContext,
  type PhpUseTable,
} from './phpModuleResolver';

/** A possibly-qualified PHP name, e.g. `Foo`, `Foo\Bar` or `\Foo\Bar`. */
const NAME = String.raw`\\?[A-Za-z_]\w*(?:\\[A-Za-z_]\w*)*`;
/** A union/intersection type expression built from `NAME` parts. */
const TYPE_UNION = `${NAME}(?:\\s*[|&]\\s*\\??${NAME})*`;

/**
 * Keywords that the candidate regexes can capture in place of a real type
 * name (e.g. `public function f($x)` yields `function`). They can never be
 * class names, so they are dropped before resolution.
 */
const RESERVED = new Set([
  'abstract',
  'and',
  'array',
  'as',
  'break',
  'case',
  'catch',
  'class',
  'clone',
  'const',
  'continue',
  'declare',
  'default',
  'do',
  'echo',
  'else',
  'elseif',
  'empty',
  'enddeclare',
  'endfor',
  'endforeach',
  'endif',
  'endswitch',
  'endwhile',
  'enum',
  'extends',
  'final',
  'finally',
  'fn',
  'for',
  'foreach',
  'function',
  'global',
  'goto',
  'if',
  'implements',
  'include',
  'include_once',
  'instanceof',
  'insteadof',
  'interface',
  'isset',
  'list',
  'match',
  'namespace',
  'new',
  'or',
  'print',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'require_once',
  'return',
  'switch',
  'throw',
  'trait',
  'try',
  'unset',
  'use',
  'var',
  'while',
  'xor',
  'yield',
]);

/**
 * Regexes producing class-name candidates. Each one captures a single
 * name in group 1 unless it is listed in `LIST_PATTERNS`, in which case
 * the capture is a separator-delimited list of names.
 */
const NAME_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\bnew\s+(${NAME})`, 'g'),
  new RegExp(String.raw`(${NAME})\s*::`, 'g'),
  new RegExp(String.raw`\binstanceof\s+(${NAME})`, 'g'),
  new RegExp(String.raw`#\[\s*(${NAME})`, 'g'),
  // Typed parameters: `(Foo $x`, `, ?Foo $x`, `, Foo|Bar $x`.
  new RegExp(String.raw`[(,]\s*\??(${TYPE_UNION})\s+&?\.{0,3}\$`, 'g'),
  // Return types: `): Foo` / `): ?Foo|Bar`.
  new RegExp(String.raw`\)\s*:\s*\??(${TYPE_UNION})`, 'g'),
  // Typed properties: `public Foo $x`, `protected static ?Foo $x`.
  new RegExp(
    String.raw`\b(?:public|private|protected|readonly|static)\s+\??(${TYPE_UNION})\s+\$`,
    'g'
  ),
];

/** Patterns whose capture is a list of names rather than a single name. */
const LIST_PATTERNS: Array<{ re: RegExp; separator: RegExp }> = [
  // `implements A, B {`
  { re: new RegExp(String.raw`\bimplements\s+([^{;]+)`, 'g'), separator: /,/ },
  // `class A extends B {` and `interface A extends B, C {`. Unlike
  // `implements`, the list is matched as an explicit sequence of names rather
  // than "everything up to `{`" so that the `implements` clause of
  // `class A extends B implements C {` is not swallowed into the capture.
  {
    re: new RegExp(String.raw`\bextends\s+(${NAME}(?:\s*,\s*${NAME})*)`, 'g'),
    separator: /,/,
  },
  // `catch (A | B $e)`
  { re: new RegExp(String.raw`\bcatch\s*\(\s*([^)$]+)`, 'g'), separator: /\|/ },
  // Union / intersection types captured as a whole by NAME_PATTERNS.
  ...NAME_PATTERNS.filter((re) => re.source.includes('[|&]')).map((re) => ({
    re,
    separator: /[|&]/,
  })),
];

/** `require`/`include` statements, capturing the path expression. */
const INCLUDE_RE = /\b(?:require|include)(?:_once)?\s*\(?\s*([^;]+?)\s*\)?\s*;/g;

/** Member accesses (`->name`, `::name`) used anywhere in the file. */
const MEMBER_RE = /(?:->|::)\s*([A-Za-z_]\w*)/g;

/**
 * Rewrites a referenced name into its best-known fully qualified form so a
 * stable short name can be derived from it. Aliases introduced by `use`
 * statements are expanded (`M` -> `App\Services\Mailer`); other names are
 * returned as written, minus any leading backslash.
 */
function qualify(name: string, uses: PhpUseTable): string {
  const trimmed = name.trim().replace(/^\\/, '');
  const segments = trimmed.split('\\');
  const head = segments[0];
  const mapped = uses.classes.get(head);
  if (mapped) {
    return [mapped, ...segments.slice(1)].join('\\');
  }
  return trimmed;
}

function shortNameOf(fqcn: string): string {
  const parts = fqcn.split('\\');
  return parts[parts.length - 1];
}

/**
 * Extracts every candidate class-name reference from already-stripped
 * source content.
 */
function collectCandidateNames(stripped: string): string[] {
  const names: string[] = [];
  const listSources = new Set(LIST_PATTERNS.map((p) => p.re.source));

  for (const re of NAME_PATTERNS) {
    if (listSources.has(re.source)) {
      continue;
    }
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(stripped)) !== null) {
      names.push(match[1]);
    }
  }

  for (const { re, separator } of LIST_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(stripped)) !== null) {
      for (const part of match[1].split(separator)) {
        names.push(part.replace(/^\s*\??/, ''));
      }
    }
  }

  return names;
}

/**
 * Collects the member names (`->foo`, `::BAR`) used anywhere in the file.
 *
 * This is deliberately name-based rather than receiver-aware: PHP's dynamic
 * typing makes it impractical to attribute a member access to a specific
 * class without a full type inference pass. The resulting set is attached to
 * every class import of the file, which over-approximates usage (it can mark
 * a same-named member of an unrelated class as used) but never produces a
 * false "unused export" report.
 */
function collectMemberNames(stripped: string): string[] {
  const members: string[] = [];
  MEMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MEMBER_RE.exec(stripped)) !== null) {
    members.push(match[1]);
  }
  return members;
}

/**
 * Extracts `require`/`include` path expressions from `content`.
 *
 * The statements are located on the stripped content (so occurrences inside
 * comments and strings are ignored), but the expression itself is re-read
 * from the original content at the same offsets because stripping blanks
 * out the string literal that holds the path.
 */
function collectIncludeExpressions(content: string, stripped: string): string[] {
  const expressions: string[] = [];
  INCLUDE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INCLUDE_RE.exec(stripped)) !== null) {
    const original = content.slice(match.index, match.index + match[0].length);
    const reread = new RegExp(INCLUDE_RE.source).exec(original);
    expressions.push(reread ? reread[1] : match[1]);
  }
  return expressions;
}

/**
 * Collects the imports of a PHP file: every other file it references through
 * `use` statements, inline fully-qualified names, type declarations,
 * attributes, `instanceof`/`catch` clauses and trait usage, plus every file
 * pulled in by `require`/`include`.
 *
 * Class references produce one `ImportInfo` per resolved target file whose
 * specifiers are the referenced class short names plus every member name
 * used in the file; `require`/`include` produce namespace imports.
 */
export function collectPhpImports(
  content: string,
  filePath: string,
  ctx: PhpResolverContext
): ImportInfo[] {
  const stripped = stripPhpCommentsAndStrings(content);
  const namespace = parseNamespace(content);
  const uses = parseUseStatements(content);

  // Every `use` statement is itself a reference, including trait `use`
  // clauses inside class bodies (which `parseUseStatements` also collects).
  const candidates = [...uses.classes.values(), ...collectCandidateNames(stripped)];
  const memberNames = collectMemberNames(stripped);

  // resolvedPath -> import being built.
  const byPath = new Map<string, { source: string; names: Set<string> }>();

  for (const candidate of candidates) {
    const raw = candidate.trim();
    if (raw.length === 0 || RESERVED.has(raw.toLowerCase())) {
      continue;
    }
    const resolved = resolveClassReference(raw, namespace, uses, ctx);
    if (!resolved || resolved === filePath) {
      continue;
    }
    const fqcn = qualify(raw, uses);
    const entry = byPath.get(resolved);
    if (entry) {
      entry.names.add(shortNameOf(fqcn));
    } else {
      byPath.set(resolved, { source: fqcn, names: new Set([shortNameOf(fqcn)]) });
    }
  }

  const imports: ImportInfo[] = [];

  for (const [resolvedPath, { source, names }] of byPath) {
    for (const member of memberNames) {
      names.add(member);
    }
    const specifiers: ImportSpecifier[] = [...names].map((name) => ({
      name,
      isDefault: false,
      isNamespace: false,
    }));
    imports.push({
      source,
      resolvedPath,
      specifiers,
      isNamespaceImport: false,
      isDynamicImport: false,
      isTypeOnly: false,
    });
  }

  const seenIncludes = new Set<string>();
  for (const expression of collectIncludeExpressions(content, stripped)) {
    const resolved = resolveInclude(expression, filePath);
    if (!resolved || resolved === filePath || seenIncludes.has(resolved)) {
      continue;
    }
    seenIncludes.add(resolved);
    imports.push({
      source: expression,
      resolvedPath: resolved,
      specifiers: [{ name: '*', isDefault: false, isNamespace: true }],
      isNamespaceImport: true,
      isDynamicImport: false,
      isTypeOnly: false,
    });
  }

  return imports;
}
