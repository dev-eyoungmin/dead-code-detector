import type { LocalSymbolInfo } from '../../../types';
import { stripPhpCommentsAndStrings, findMatchingBrace, lineOf } from './phpSource';

const SUPERGLOBALS = new Set([
  'GLOBALS',
  '_SERVER',
  '_GET',
  '_POST',
  '_FILES',
  '_COOKIE',
  '_SESSION',
  '_REQUEST',
  '_ENV',
]);

const PRIVATE_MEMBER_RE =
  /^\s*private\s+(?:static\s+|readonly\s+)*(?:(function)\s+&?([A-Za-z_]\w*)|(const)\s+([A-Za-z_]\w*)|(?:[?\w\\|]+\s+)?\$([A-Za-z_]\w*))/gm;

const ASSIGNMENT_RE = /\$([A-Za-z_]\w*)\s*(?:=[^=]|\+=|-=|\.=|\?\?=)/g;
const FOREACH_RE = /foreach\s*\([^)]*\bas\s+(?:&?\$(\w+)\s*=>\s*)?&?\$(\w+)/g;
const FOR_INIT_RE = /for\s*\(\s*\$(\w+)\s*=/g;
const FUNCTION_RE = /function\s*&?\s*([A-Za-z_]\w*)?\s*\(/g;

/**
 * Collects local (file-scoped) PHP symbols: private class members and
 * unused local variables inside function/method bodies.
 *
 * Operates purely on strings (no AST), sharing the comment/string
 * stripping and brace-matching helpers from `phpSource.ts`.
 */
export function collectPhpLocals(content: string, exportedNames: Set<string>): LocalSymbolInfo[] {
  const stripped = stripPhpCommentsAndStrings(content);
  const locals: LocalSymbolInfo[] = [];

  collectPrivateMembers(content, stripped, exportedNames, locals);
  collectFunctionLocals(content, stripped, locals);

  return locals;
}

function collectPrivateMembers(
  content: string,
  stripped: string,
  exportedNames: Set<string>,
  locals: LocalSymbolInfo[]
): void {
  const seen = new Set<string>();
  PRIVATE_MEMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRIVATE_MEMBER_RE.exec(stripped))) {
    let name: string;
    let kind: 'method' | 'field' | 'constant';
    if (match[1]) {
      kind = 'method';
      name = match[2];
    } else if (match[3]) {
      kind = 'constant';
      name = match[4];
    } else {
      kind = 'field';
      name = match[5];
    }
    if (!isEligibleMemberName(name) || seen.has(name) || exportedNames.has(name)) {
      continue;
    }
    seen.add(name);
    locals.push({
      name,
      line: lineOf(content, match.index),
      column: 0,
      kind,
      references: countMemberReferences(name, stripped, lineOf(content, match.index)),
    });

    // Comma-separated property lists (`private $a, $b;`) declare more than
    // one member per statement; PHP property defaults must be constant
    // expressions (no variables allowed), so every `$name` found between
    // the first captured name and the terminating `;` is another declared
    // property, never part of a default-value expression. `findPropertyListEnd`
    // only returns a valid end when the scan reaches `;` without first
    // crossing a `(`, `)`, `{` or `}` — this both bounds the scan to a single
    // statement and rejects PHP 8 constructor-promoted properties (which have
    // no statement-terminating `;` of their own; the nearest `;` belongs to
    // the constructor body and must never be treated as this declaration's end).
    if (kind === 'field') {
      const afterFirst = match.index + match[0].length;
      const listEnd = findPropertyListEnd(stripped, afterFirst);
      if (listEnd !== -1) {
        const remainder = stripped.slice(afterFirst, listEnd);
        const extraRe = /\$([A-Za-z_]\w*)/g;
        let extraMatch: RegExpExecArray | null;
        while ((extraMatch = extraRe.exec(remainder))) {
          const extraName = extraMatch[1];
          if (!isEligibleMemberName(extraName) || seen.has(extraName) || exportedNames.has(extraName)) {
            continue;
          }
          seen.add(extraName);
          const extraIndex = afterFirst + extraMatch.index;
          locals.push({
            name: extraName,
            line: lineOf(content, extraIndex),
            column: 0,
            kind: 'field',
            references: countMemberReferences(extraName, stripped, lineOf(content, extraIndex)),
          });
        }
      }
    }
  }
}

/**
 * Returns the index of the `;` that ends a private property declaration
 * starting right after `start`, or `-1` if the scan hits a `(`, `)`, `{` or
 * `}` first. Crossing any of those means `start` is not inside a simple
 * `private $a, $b;` statement — most notably, a PHP 8 constructor-promoted
 * property parameter (`private readonly string $name,`), whose own
 * declaration has no `;` and whose nearest one lives inside the function
 * body. Bounding the scan this way keeps a comma-separated property list
 * from ever spilling into a parameter list or a statement body.
 */
function findPropertyListEnd(stripped: string, start: number): number {
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === ';') {
      return i;
    }
    if (c === '(' || c === ')' || c === '{' || c === '}') {
      return -1;
    }
  }
  return -1;
}

/**
 * Excludes names that are never legitimate private-member declarations:
 * `$this` cannot be redeclared, and PHP superglobals are not class members.
 * Defense in depth alongside `findPropertyListEnd`'s statement bounding, so
 * a `this`/superglobal false positive can't slip through even if the scan
 * boundary logic is ever wrong.
 */
function isEligibleMemberName(name: string | undefined): name is string {
  if (!name || name === 'this') {
    return false;
  }
  return !SUPERGLOBALS.has(name);
}

function countMemberReferences(name: string, stripped: string, definitionLine: number): number {
  const lines = stripped.split('\n');
  const re = new RegExp(`(?:->|::\\$?)${escapeRegex(name)}\\b`, 'g');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 === definitionLine) {
      continue;
    }
    const matches = lines[i].match(re);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function collectFunctionLocals(content: string, stripped: string, locals: LocalSymbolInfo[]): void {
  FUNCTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FUNCTION_RE.exec(stripped))) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = findMatchingParen(stripped, openParen);
    if (closeParen === -1) {
      continue;
    }

    let cursor = closeParen + 1;
    const closureCaptures = new Set<string>();
    const useMatch = /^\s*use\s*\(/.exec(stripped.slice(cursor, cursor + 500));
    if (useMatch) {
      const useOpenParen = cursor + useMatch[0].length - 1;
      const useCloseParen = findMatchingParen(stripped, useOpenParen);
      if (useCloseParen !== -1) {
        const useBody = content.slice(useOpenParen + 1, useCloseParen);
        const captureRe = /\$([A-Za-z_]\w*)/g;
        let captureMatch: RegExpExecArray | null;
        while ((captureMatch = captureRe.exec(useBody))) {
          closureCaptures.add(captureMatch[1]);
        }
        cursor = useCloseParen + 1;
      }
    }

    const semiIndex = stripped.indexOf(';', cursor);
    const braceIndex = stripped.indexOf('{', cursor);
    if (braceIndex === -1 || (semiIndex !== -1 && semiIndex < braceIndex)) {
      // Abstract/interface method signature with no body.
      FUNCTION_RE.lastIndex = closeParen + 1;
      continue;
    }
    const braceClose = findMatchingBrace(stripped, braceIndex);
    if (braceClose === -1) {
      FUNCTION_RE.lastIndex = closeParen + 1;
      continue;
    }

    collectVariablesInBody(content, stripped, braceIndex + 1, braceClose, closureCaptures, locals);

    // Skip past the whole body so nested closures aren't re-processed as
    // independent top-level functions (their variables are already picked
    // up as part of the enclosing function's body scan).
    FUNCTION_RE.lastIndex = braceClose + 1;
  }
}

interface DeclCandidate {
  name: string;
  firstOffset: number;
  offsets: Set<number>;
}

function collectVariablesInBody(
  content: string,
  stripped: string,
  bodyStart: number,
  bodyEnd: number,
  closureCaptures: Set<string>,
  locals: LocalSymbolInfo[]
): void {
  const strippedBody = stripped.slice(bodyStart, bodyEnd);
  const originalBody = content.slice(bodyStart, bodyEnd);
  const candidates = new Map<string, DeclCandidate>();

  const record = (name: string, localOffset: number): void => {
    if (!isEligibleLocalName(name, closureCaptures)) {
      return;
    }
    const absoluteOffset = bodyStart + localOffset;
    let candidate = candidates.get(name);
    if (!candidate) {
      candidate = { name, firstOffset: absoluteOffset, offsets: new Set() };
      candidates.set(name, candidate);
    }
    candidate.offsets.add(absoluteOffset);
    if (absoluteOffset < candidate.firstOffset) {
      candidate.firstOffset = absoluteOffset;
    }
  };

  ASSIGNMENT_RE.lastIndex = 0;
  let assignMatch: RegExpExecArray | null;
  while ((assignMatch = ASSIGNMENT_RE.exec(strippedBody))) {
    record(assignMatch[1], assignMatch.index);
  }

  FOREACH_RE.lastIndex = 0;
  let foreachMatch: RegExpExecArray | null;
  while ((foreachMatch = FOREACH_RE.exec(strippedBody))) {
    const valueName = foreachMatch[2];
    const valueOffset = foreachMatch.index + foreachMatch[0].length - (1 + valueName.length);
    record(valueName, valueOffset);

    const keyName = foreachMatch[1];
    if (keyName) {
      const keyOffset = foreachMatch[0].lastIndexOf(`$${keyName}`, valueOffset - foreachMatch.index - 1);
      if (keyOffset !== -1) {
        record(keyName, foreachMatch.index + keyOffset);
      }
    }
  }

  FOR_INIT_RE.lastIndex = 0;
  let forMatch: RegExpExecArray | null;
  while ((forMatch = FOR_INIT_RE.exec(strippedBody))) {
    const varName = forMatch[1];
    const varOffset = forMatch[0].indexOf(`$${varName}`);
    if (varOffset !== -1) {
      record(varName, forMatch.index + varOffset);
    }
  }

  for (const candidate of candidates.values()) {
    const references = countVariableReads(candidate.name, originalBody, bodyStart, candidate.offsets);
    locals.push({
      name: candidate.name,
      line: lineOf(content, candidate.firstOffset),
      column: 0,
      kind: 'variable',
      references,
    });
  }
}

function isEligibleLocalName(name: string, closureCaptures: Set<string>): boolean {
  if (!name || name === 'this') {
    return false;
  }
  if (name.startsWith('_')) {
    return false;
  }
  if (SUPERGLOBALS.has(name)) {
    return false;
  }
  if (closureCaptures.has(name)) {
    return false;
  }
  return true;
}

function countVariableReads(
  name: string,
  originalBody: string,
  bodyStart: number,
  declOffsets: Set<number>
): number {
  const occurrenceRe = new RegExp(`\\$${escapeRegex(name)}\\b`, 'g');
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = occurrenceRe.exec(originalBody))) {
    const absoluteOffset = bodyStart + match.index;
    if (!declOffsets.has(absoluteOffset)) {
      count++;
    }
  }

  const compactRe = new RegExp(`compact\\([^)]*['"]${escapeRegex(name)}['"]`, 'g');
  const compactMatches = originalBody.match(compactRe);
  if (compactMatches) {
    count += compactMatches.length;
  }

  return count;
}

function findMatchingParen(content: string, openIndex: number): number {
  if (content[openIndex] !== '(') {
    return -1;
  }
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const c = content[i];
    if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
