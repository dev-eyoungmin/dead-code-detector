import type { ExportInfo } from '../../../types';
import { stripPhpCommentsAndStrings, findMatchingBrace, lineOf } from './phpSource';
import { isPhpDIAttribute } from '../../decoratorDetector';
import { PHP_FRAMEWORK_ENTRY_ATTRIBUTES } from './phpFrameworkDetector';

/**
 * True when a PHP 8 attribute makes the declaration it decorates an entry point:
 * either a DI/container attribute (the container constructs or calls it) or a
 * framework routing/console/messenger attribute (the framework dispatches to it
 * by configuration). Either way there is no call site in the sources.
 */
function isPhpEntryPointAttribute(name: string): boolean {
  return isPhpDIAttribute(name) || PHP_FRAMEWORK_ENTRY_ATTRIBUTES.includes(name);
}

/**
 * Matches top-level declarations anywhere in the (stripped) source:
 * - class/interface/trait/enum (with optional abstract/final/readonly modifiers)
 * - named function declarations (not anonymous closures, which have no name)
 * - `const NAME = ...` at the start of a line
 * - `define('NAME', ...)`
 *
 * The actual "is this really top-level" decision is made by checking the
 * brace depth at the match position (see `computeDepthAtEachIndex`).
 */
// Note: the `define(` alternative deliberately stops right after the
// opening quote instead of also matching the identifier + closing quote:
// `stripPhpCommentsAndStrings` blanks string bodies (including a define()
// name argument), so the name itself must be read back from the original,
// unstripped source (see `readDefineName`).
const TOP_LEVEL_RE =
  /(?:abstract\s+|final\s+|readonly\s+)*(?<classKeyword>class|interface|trait|enum)\s+(?<className>[A-Za-z_]\w*)|(?<![\w>$])function\s+&?(?<funcName>[A-Za-z_]\w*)\s*\(|^\s*const\s+(?<constName>[A-Za-z_]\w*)\s*=|define\s*\(\s*['"]/gm;

// PHP reserved words that can never legally be an identifier name. They can
// only show up in the captured-name position here when `class` is
// immediately followed by `extends`/`implements` with no name in between —
// i.e. an anonymous class expression (`new class extends Foo { ... }` /
// `new class implements Bar { ... }`), not a real top-level declaration.
// Mirrors `RESERVED_DECLARATION_NAMES` in `phpModuleResolver.ts`.
const RESERVED_DECLARATION_NAMES = new Set(['extends', 'implements']);

/**
 * Reads the literal define() name argument from the original (unstripped)
 * source, given the index right after the opening quote that `TOP_LEVEL_RE`
 * matched on the stripped content. Positions align 1:1 between the two
 * strings, and only the *body* of string literals is blanked, so the
 * identifier immediately follows in the original source.
 */
function readDefineName(originalContent: string, indexAfterOpenQuote: number): string | undefined {
  const match = /^([A-Za-z_]\w*)['"]/.exec(originalContent.slice(indexAfterOpenQuote));
  return match?.[1];
}

/**
 * Matches a single class member declaration when applied (anchored) to the
 * start of a statement chunk extracted from a class-like body:
 * - `[modifiers] function name(`
 * - `[modifiers] const NAME =`
 * - `[modifiers] [Type] $name` followed by `=`, `;` or `,`
 */
const MEMBER_RE =
  /^\s*((?:public|private|protected|static|final|abstract|readonly|\s)*)\s*(?:(function)\s+&?([A-Za-z_]\w*)\s*\(|(const)\s+([A-Za-z_]\w*)\s*=|(?:[?\w\\|]+\s+)?\$([A-Za-z_]\w*)\s*[=;,])/;

/**
 * Precomputes, for every index in `content`, the `{`/`}` nesting depth
 * *before* that index is consumed. Index `content.length` holds the final
 * depth. Must be called on stripped content so that braces inside comments
 * or strings do not skew the count.
 */
function computeDepthAtEachIndex(content: string): number[] {
  const depths = new Array<number>(content.length + 1);
  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    depths[i] = depth;
    const c = content[i];
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    }
  }
  depths[content.length] = depth;
  return depths;
}

interface StatementChunk {
  text: string;
  offset: number;
}

/**
 * Splits a class-like body (the text strictly between its outer `{` and
 * `}`) into top-level statement chunks. A chunk ends either at a `;` seen
 * at local depth 0, or right after a `}` that brings the local depth back
 * to 0 (i.e. the end of a method body). This lets member detection work
 * even when several declarations share a single physical source line
 * (e.g. compact enum bodies).
 */
function splitTopLevelStatements(body: string): StatementChunk[] {
  const chunks: StatementChunk[] = [];
  let depth = 0;
  let chunkStart = 0;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        chunks.push({ text: body.slice(chunkStart, i + 1), offset: chunkStart });
        chunkStart = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      chunks.push({ text: body.slice(chunkStart, i + 1), offset: chunkStart });
      chunkStart = i + 1;
    }
  }
  if (chunkStart < body.length) {
    chunks.push({ text: body.slice(chunkStart), offset: chunkStart });
  }
  return chunks;
}

/**
 * Walks backwards from `index` over whitespace and balanced `#[...]` groups and
 * returns the offset where that run of attributes begins (or `index` when the
 * declaration carries none).
 *
 * Only the *boundary* is found here; the names are then parsed by
 * `stripLeadingAttributes`, so declarations and class members share a single
 * attribute parser. The previous line-based scanner missed same-line attributes
 * (`#[AsController] class D {}`), multi-line argument lists, and every name but
 * the first in a grouped attribute (`#[Foo, AsController]`).
 */
function findAttributeRegionStart(stripped: string, index: number): number {
  let start = index;

  for (;;) {
    let end = start - 1;
    while (end >= 0 && /\s/.test(stripped[end])) {
      end -= 1;
    }
    if (end < 0 || stripped[end] !== ']') {
      return start;
    }

    let depth = 0;
    let open = end;
    for (; open >= 0; open--) {
      if (stripped[open] === ']') {
        depth += 1;
      } else if (stripped[open] === '[') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    if (open <= 0 || stripped[open - 1] !== '#') {
      return start;
    }
    start = open - 1;
  }
}

/**
 * A member statement chunk with its leading `#[...]` attributes removed.
 * `offset` is where the declaration itself starts inside the original chunk, so
 * line numbers point at the declaration rather than at its attributes (or, worse,
 * at the closing brace of the preceding member, which is where a chunk begins).
 */
interface StrippedAttributes {
  names: string[];
  offset: number;
}

/**
 * Consumes leading whitespace and `#[...]` attribute groups from the start of a
 * class-member statement chunk.
 *
 * This is required for correctness, not just for metadata: `MEMBER_RE` is anchored
 * and only tolerates visibility modifiers before the declaration, so an attribute
 * line used to make the match fail and the member was silently dropped from the
 * export list altogether.
 *
 * Bracket depth is tracked so that array arguments (`#[Route(methods: ['GET'])]`)
 * do not terminate the group early. The chunk has already been through
 * `stripPhpCommentsAndStrings`, so brackets inside strings cannot interfere.
 */
function stripLeadingAttributes(text: string): StrippedAttributes {
  const names: string[] = [];
  let i = 0;

  for (;;) {
    while (i < text.length && /\s/.test(text[i])) {
      i += 1;
    }
    if (text[i] !== '#' || text[i + 1] !== '[') {
      break;
    }

    let depth = 0;
    let end = -1;
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '[') {
        depth += 1;
      } else if (text[j] === ']') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      // Unbalanced attribute: leave the chunk untouched rather than guess.
      return { names, offset: 0 };
    }

    for (const name of parseAttributeGroupNames(text.slice(i + 2, end))) {
      names.push(name);
    }
    i = end + 1;
  }

  return { names, offset: i };
}

/**
 * Extracts the short attribute names from the body of a single `#[...]` group,
 * which may declare several comma-separated attributes (`#[Foo, Bar(1)]`).
 * Commas inside an attribute's own argument list are ignored.
 */
function parseAttributeGroupNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;

  const push = (part: string): void => {
    const match = /^\s*\\?([\w\\]+)/.exec(part);
    if (match) {
      const segments = match[1].split('\\');
      names.push(segments[segments.length - 1]);
    }
  };

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(' || c === '[') {
      depth += 1;
    } else if (c === ')' || c === ']') {
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));

  return names;
}

const CLASS_LIKE_KIND: Record<string, string> = {
  class: 'class',
  trait: 'class',
  interface: 'interface',
  enum: 'enum',
};

/**
 * Collects exported (public) symbols from a PHP source file.
 *
 * In PHP, top-level declarations (classes, interfaces, traits, enums,
 * functions, constants) are always "exported" in the sense of being
 * usable from other files. Class members are only collected when they are
 * public (explicit `public` modifier, or no visibility modifier at all,
 * since methods and class constants default to public in PHP).
 */
export function collectPhpExports(content: string, _filePath: string): ExportInfo[] {
  const stripped = stripPhpCommentsAndStrings(content);
  const depths = computeDepthAtEachIndex(stripped);
  const exports: ExportInfo[] = [];

  for (const match of stripped.matchAll(TOP_LEVEL_RE)) {
    const index = match.index ?? 0;
    if (depths[index] !== 0) {
      continue;
    }

    const groups = match.groups ?? {};
    const { classKeyword, className, funcName, constName } = groups;

    if (classKeyword && className) {
      if (RESERVED_DECLARATION_NAMES.has(className.toLowerCase())) {
        continue;
      }
      const line = lineOf(content, index);
      const regionStart = findAttributeRegionStart(stripped, index);
      const attributeNames = stripLeadingAttributes(stripped.slice(regionStart, index)).names;
      // Class-level extraction stays strict — only a recognised framework/DI
      // attribute marks a class. Unlike members (see `collectClassMembers`), a
      // class is normally referenced by name somewhere (a type hint, a repository,
      // a container config), so it does not need the weak-signal fallback.
      const isEntryPointDecorated = attributeNames.some(isPhpEntryPointAttribute) || undefined;

      exports.push({
        name: className,
        isDefault: false,
        isReExport: false,
        line,
        column: 0,
        kind: CLASS_LIKE_KIND[classKeyword] ?? 'class',
        isTypeOnly: false,
        isEntryPointDecorated,
      });

      const openBraceIdx = stripped.indexOf('{', index + match[0].length);
      if (openBraceIdx !== -1) {
        const closeBraceIdx = findMatchingBrace(stripped, openBraceIdx);
        if (closeBraceIdx !== -1) {
          const body = stripped.slice(openBraceIdx + 1, closeBraceIdx);
          collectClassMembers(body, openBraceIdx + 1, content, exports);
        }
      }
      continue;
    }

    if (funcName) {
      exports.push({
        name: funcName,
        isDefault: false,
        isReExport: false,
        line: lineOf(content, index),
        column: 0,
        kind: 'function',
        isTypeOnly: false,
      });
      continue;
    }

    if (constName) {
      exports.push({
        name: constName,
        isDefault: false,
        isReExport: false,
        line: lineOf(content, index),
        column: 0,
        kind: 'constant',
        isTypeOnly: false,
      });
      continue;
    }

    // Only remaining alternative: `define(` reached the opening quote.
    const defineName = readDefineName(content, index + match[0].length);
    if (defineName) {
      exports.push({
        name: defineName,
        isDefault: false,
        isReExport: false,
        line: lineOf(content, index),
        column: 0,
        kind: 'constant',
        isTypeOnly: false,
      });
    }
  }

  return exports;
}

/**
 * Scans a class-like body (already sliced out of the stripped content) for
 * public members (methods, class constants, typed/untyped properties) and
 * pushes them onto `exports`. `bodyStartInStripped` is the offset of
 * `body[0]` within the stripped content, used to map back to a line number
 * in the original source via `lineOf`.
 */
function collectClassMembers(
  body: string,
  bodyStartInStripped: number,
  originalContent: string,
  exports: ExportInfo[]
): void {
  for (const chunk of splitTopLevelStatements(body)) {
    const attributes = stripLeadingAttributes(chunk.text);
    const declaration = chunk.text.slice(attributes.offset);
    const match = MEMBER_RE.exec(declaration);
    if (!match) {
      continue;
    }
    const [, modifiers, isFunction, funcName, isConst, constName, propName] = match;
    if (/\b(private|protected)\b/.test(modifiers)) {
      continue;
    }

    const index = bodyStartInStripped + chunk.offset + attributes.offset;
    const line = lineOf(originalContent, index);
    // Any attribute at all means something outside the call graph reaches this
    // member. A recognised routing/DI attribute is a hard entry-point signal; an
    // unrecognised one (Doctrine `#[ORM\Column]`, `#[Assert\NotBlank]`,
    // `#[Groups]`, `#[SerializedName]` on entity and DTO properties) is a weak
    // liveness signal — such a member is typically read reflectively, or by a
    // Twig template, which is not part of the analysed PHP file set. Both are
    // reported at 'low' instead of 'medium'.
    //
    // They share `isEntryPointDecorated` because that is the only channel
    // `ExportInfo` offers today. If the two ever need to diverge, `ExportInfo`
    // needs a separate `hasUnrecognisedAttribute` field.
    const isEntryPointDecorated = attributes.names.length > 0 || undefined;

    if (isFunction && funcName) {
      exports.push({
        name: funcName,
        isDefault: false,
        isReExport: false,
        line,
        column: 0,
        kind: 'method',
        isTypeOnly: false,
        isEntryPointDecorated,
      });
      continue;
    }

    if (isConst && constName) {
      exports.push({
        name: constName,
        isDefault: false,
        isReExport: false,
        line,
        column: 0,
        kind: 'constant',
        isTypeOnly: false,
        isEntryPointDecorated,
      });
      continue;
    }

    if (propName) {
      exports.push({
        name: propName,
        isDefault: false,
        isReExport: false,
        line,
        column: 0,
        kind: 'variable',
        isTypeOnly: false,
        isEntryPointDecorated,
      });
    }
  }
}
