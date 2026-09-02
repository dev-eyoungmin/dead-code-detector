import * as path from 'path';
import * as fs from 'fs';
import { readSource } from '../../sourceCache';
import { stripPhpCommentsAndStrings } from './phpSource';

/**
 * Returns the namespace declared at the top of a PHP file, or '' if none.
 */
export function parseNamespace(content: string): string {
  const stripped = stripPhpCommentsAndStrings(content);
  // Not anchored to the start of a line: a `namespace` declaration may
  // share a line with the opening `<?php` tag (e.g. `<?php namespace Foo;`).
  const match = /\bnamespace\s+([\w\\]+)\s*[;{]/.exec(stripped);
  return match ? match[1] : '';
}

/**
 * Alias -> FQCN (without a leading backslash) tables built from `use`
 * statements in a PHP file.
 */
export interface PhpUseTable {
  classes: Map<string, string>;
  functions: Map<string, string>;
  consts: Map<string, string>;
}

function lastSegment(fqcn: string): string {
  const parts = fqcn.split('\\');
  return parts[parts.length - 1];
}

function splitTopLevel(body: string): string[] {
  return body
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parses `use ...;` statements (including grouped `use Ns\{A, B as C};`,
 * `use function ...;` and `use const ...;` forms) into a `PhpUseTable`.
 */
export function parseUseStatements(content: string): PhpUseTable {
  const table: PhpUseTable = {
    classes: new Map<string, string>(),
    functions: new Map<string, string>(),
    consts: new Map<string, string>(),
  };
  const stripped = stripPhpCommentsAndStrings(content);
  // Not anchored to the start of a line (a `use` statement may share a line
  // with `<?php`); the body must start with an identifier/backslash so a
  // closure's `function () use ($x) {}` capture clause is never matched.
  const useRe = /\buse\s+(function\s+|const\s+)?([A-Za-z_\\][^;]*);/g;
  let match: RegExpExecArray | null;
  while ((match = useRe.exec(stripped)) !== null) {
    const kind = match[1] ? match[1].trim() : '';
    const body = match[2].trim();
    const target = kind === 'function' ? table.functions : kind === 'const' ? table.consts : table.classes;

    const groupMatch = /^([\w\\]+)\\\{(.*)\}$/.exec(body);
    if (groupMatch) {
      const prefix = groupMatch[1].replace(/^\\/, '');
      for (const item of splitTopLevel(groupMatch[2])) {
        const asMatch = /^(.+?)\s+as\s+(\w+)$/.exec(item);
        const namePart = asMatch ? asMatch[1].trim() : item;
        const alias = asMatch ? asMatch[2].trim() : lastSegment(namePart);
        target.set(alias, `${prefix}\\${namePart}`);
      }
      continue;
    }

    // Not a namespace `use` import: e.g. a trait-use adaptation block inside
    // a class body (`use TraitA, TraitB { TraitA::foo insteadof TraitB; }`)
    // truncates at the first `;` *inside* the block and would otherwise
    // leak a garbage alias containing `{`/`::`/keywords like `insteadof`.
    if (body.includes('{') || body.includes('::')) {
      continue;
    }

    for (const item of splitTopLevel(body)) {
      const asMatch = /^(.+?)\s+as\s+(\w+)$/.exec(item);
      const fqcnPart = (asMatch ? asMatch[1].trim() : item).replace(/^\\/, '');
      const alias = asMatch ? asMatch[2].trim() : lastSegment(fqcnPart);
      target.set(alias, fqcnPart);
    }
  }
  return table;
}

const DECLARATION_RE =
  /\b(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum|function)\s+([A-Za-z_]\w*)/g;

// PHP reserved words that can never legally be an identifier name. They can
// only show up in the captured-name position here when `class` is
// immediately followed by `extends`/`implements` with no name in between —
// i.e. an anonymous class expression (`new class extends Foo { ... }` /
// `new class implements Bar { ... }`), not a real top-level declaration.
const RESERVED_DECLARATION_NAMES = new Set(['extends', 'implements']);

/**
 * Counts the net brace depth reached after scanning `text` from the start.
 * Used to tell top-level declarations (depth 0) from ones nested inside a
 * class/function body (depth >= 1).
 */
function braceDepthAt(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    }
  }
  return depth;
}

/**
 * Builds a lower-cased FQCN -> file index for classes, interfaces, traits,
 * enums and top-level functions declared across the given files.
 *
 * Declarations are not required to start their own line (e.g.
 * `<?php namespace Foo; class Bar {}` on a single line is supported);
 * only their brace depth (0 == top level) determines inclusion.
 */
export function buildClassIndex(files: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    const raw = readSource(file);
    if (raw === null) {
      continue;
    }
    const stripped = stripPhpCommentsAndStrings(raw);
    const ns = parseNamespace(raw);
    DECLARATION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DECLARATION_RE.exec(stripped)) !== null) {
      const name = match[2];
      if (RESERVED_DECLARATION_NAMES.has(name.toLowerCase())) {
        continue;
      }
      if (braceDepthAt(stripped.slice(0, match.index)) === 0) {
        const fqcn = ns ? `${ns}\\${name}` : name;
        index.set(fqcn.toLowerCase(), file);
      }
    }
  }
  return index;
}

/**
 * Parsed composer.json autoload configuration (merging `autoload` and
 * `autoload-dev`), with directories resolved to absolute paths.
 */
export interface ComposerAutoload {
  psr4: Array<{ prefix: string; dirs: string[] }>;
  psr0: Array<{ prefix: string; dirs: string[] }>;
  classmapDirs: string[];
  files: string[];
}

interface ComposerAutoloadSection {
  'psr-4'?: Record<string, string | string[]>;
  'psr-0'?: Record<string, string | string[]>;
  classmap?: string[];
  files?: string[];
}

interface ComposerJson {
  autoload?: ComposerAutoloadSection;
  'autoload-dev'?: ComposerAutoloadSection;
}

function emptyAutoload(): ComposerAutoload {
  return { psr4: [], psr0: [], classmapDirs: [], files: [] };
}

function collectPrefixMap(
  rootDir: string,
  map: Record<string, string | string[]> | undefined
): Array<{ prefix: string; dirs: string[] }> {
  if (!map) {
    return [];
  }
  return Object.entries(map).map(([prefix, dirsRaw]) => {
    const dirs = Array.isArray(dirsRaw) ? dirsRaw : [dirsRaw];
    return { prefix, dirs: dirs.map((dir) => path.resolve(rootDir, dir)) };
  });
}

/**
 * Reads `composer.json` from `rootDir` and returns its merged autoload
 * configuration. Returns an empty configuration when the file is missing
 * or unparsable.
 */
export function loadComposerAutoload(rootDir: string): ComposerAutoload {
  const result = emptyAutoload();
  const composerPath = path.join(rootDir, 'composer.json');
  if (!fs.existsSync(composerPath)) {
    return result;
  }
  let json: ComposerJson;
  try {
    json = JSON.parse(fs.readFileSync(composerPath, 'utf-8')) as ComposerJson;
  } catch {
    return result;
  }

  for (const section of [json.autoload, json['autoload-dev']]) {
    if (!section) {
      continue;
    }
    result.psr4.push(...collectPrefixMap(rootDir, section['psr-4']));
    result.psr0.push(...collectPrefixMap(rootDir, section['psr-0']));
    for (const entry of section.classmap ?? []) {
      const resolved = path.resolve(rootDir, entry);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        result.classmapDirs.push(resolved);
      }
    }
    for (const entry of section.files ?? []) {
      result.files.push(path.resolve(rootDir, entry));
    }
  }

  return result;
}

/**
 * Context needed to resolve a fully-qualified class name to a file: the
 * class index built by `buildClassIndex` and the composer autoload config.
 */
export interface PhpResolverContext {
  index: Map<string, string>;
  autoload: ComposerAutoload;
}

function stripTrailingBackslash(prefix: string): string {
  return prefix.replace(/\\+$/, '');
}

/**
 * Resolves a fully-qualified class name (with or without a leading
 * backslash) to a file, first via the pre-built class index, then by
 * falling back to composer's PSR-4/PSR-0 autoload rules.
 */
export function resolveFqcn(fqcn: string, ctx: PhpResolverContext): string | undefined {
  const clean = fqcn.replace(/^\\/, '');
  const key = clean.toLowerCase();
  if (ctx.index.has(key)) {
    return ctx.index.get(key);
  }

  for (const { prefix, dirs } of ctx.autoload.psr4) {
    const normPrefix = stripTrailingBackslash(prefix);
    const lowerClean = clean.toLowerCase();
    const lowerPrefix = normPrefix.toLowerCase();
    if (lowerClean !== lowerPrefix && !lowerClean.startsWith(`${lowerPrefix}\\`)) {
      continue;
    }
    const rest = clean.slice(normPrefix.length).replace(/^\\/, '');
    const relPath = `${rest.replace(/\\/g, '/')}.php`;
    for (const dir of dirs) {
      const candidate = path.join(dir, relPath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  for (const { prefix, dirs } of ctx.autoload.psr0) {
    const normPrefix = stripTrailingBackslash(prefix);
    const lowerClean = clean.toLowerCase();
    const lowerPrefix = normPrefix.toLowerCase();
    if (lowerClean !== lowerPrefix && !lowerClean.startsWith(`${lowerPrefix}\\`)) {
      continue;
    }
    // PSR-0: namespace separators become directory separators, and
    // underscores in the class name (the final segment) become directory
    // separators as well.
    const segments = clean.split('\\');
    const className = segments.pop() ?? '';
    const relPath = [...segments, className.replace(/_/g, '/')].join('/') + '.php';
    for (const dir of dirs) {
      const candidate = path.join(dir, relPath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Resolves an `include`/`require` argument expression to an absolute file
 * path. Supports bare string literals and the common `__DIR__ . '...'`,
 * `dirname(__FILE__) . '...'` and `dirname(__DIR__) . '...'` forms.
 */
export function resolveInclude(spec: string, fromFile: string): string | undefined {
  const match = /^(__DIR__|dirname\(__FILE__\)|dirname\(__DIR__\))?\s*\.?\s*['"]([^'"]+)['"]$/.exec(spec.trim());
  if (!match) {
    return undefined;
  }
  const prefix = match[1];
  const literal = match[2];
  let base = path.dirname(fromFile);
  if (prefix === 'dirname(__DIR__)') {
    base = path.dirname(base);
  }
  const candidate = path.join(base, literal);
  return fs.existsSync(candidate) ? candidate : undefined;
}

const BUILTIN_TYPES = new Set([
  'string',
  'int',
  'float',
  'bool',
  'array',
  'void',
  'mixed',
  'null',
  'self',
  'static',
  'parent',
  'object',
  'callable',
  'iterable',
  'never',
  'true',
  'false',
  'this',
]);

/**
 * Resolves a class/interface/trait name referenced within a file to the
 * file that declares it, handling fully-qualified names, `use` aliases,
 * names relative to the current namespace, and the global namespace
 * fallback.
 */
export function resolveClassReference(
  name: string,
  currentNamespace: string,
  uses: PhpUseTable,
  ctx: PhpResolverContext
): string | undefined {
  const trimmed = name.trim();
  if (BUILTIN_TYPES.has(trimmed.toLowerCase())) {
    return undefined;
  }

  if (trimmed.startsWith('\\')) {
    return resolveFqcn(trimmed, ctx);
  }

  const segments = trimmed.split('\\');
  const head = segments[0];
  const rest = segments.slice(1).join('\\');

  if (uses.classes.has(head)) {
    const mapped = uses.classes.get(head)!;
    const fqcn = rest ? `${mapped}\\${rest}` : mapped;
    const resolved = resolveFqcn(fqcn, ctx);
    if (resolved) {
      return resolved;
    }
  }

  if (currentNamespace) {
    const resolved = resolveFqcn(`${currentNamespace}\\${trimmed}`, ctx);
    if (resolved) {
      return resolved;
    }
  }

  return resolveFqcn(trimmed, ctx);
}
