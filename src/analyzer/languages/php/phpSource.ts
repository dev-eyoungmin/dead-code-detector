/**
 * PHP source scanning utilities.
 *
 * These helpers operate purely on strings (no AST) and are shared by the
 * PHP export/import/local collectors and the module resolver.
 */

type ScanState = 'code' | 'lineComment' | 'blockComment' | 'single' | 'double' | 'heredoc';

/**
 * Replaces the bodies of comments and string literals with spaces while
 * keeping the overall string length and newline positions unchanged.
 *
 * - `//` and `#` (but not `#[` attribute syntax) start a line comment that
 *   ends at the next newline.
 * - `/* ... *\/` block comments are blanked in full (delimiters included).
 * - `'...'` and `"..."` string bodies are blanked, quotes are kept.
 * - `<<<ID` / `<<<'ID'` heredoc/nowdoc bodies are blanked until a line that
 *   is exactly the closing identifier (optionally followed by `;` and
 *   surrounding whitespace, per PHP 7.3+ flexible heredoc syntax).
 * - `#[Attribute(...)]` is left untouched aside from string bodies inside it
 *   being blanked like any other string.
 */
export function stripPhpCommentsAndStrings(content: string): string {
  const chars = content.split('');
  const out = chars.slice();
  const len = content.length;
  let state: ScanState = 'code';
  let i = 0;
  let heredocId = '';
  let heredocBlankQuotes = false;
  let stringStart = -1;

  const blank = (idx: number): void => {
    if (out[idx] !== '\n') {
      out[idx] = ' ';
    }
  };

  // Collapses a quoted string body into an adjacent pair of quote
  // characters (placed at the first non-newline slot after the opening
  // quote) and blanks the remainder of the span, preserving any embedded
  // newlines and the overall length of the file.
  const finalizeString = (start: number, closeIdx: number, quoteChar: string): void => {
    let quotePos = -1;
    for (let k = start + 1; k <= closeIdx; k++) {
      if (content[k] !== '\n') {
        quotePos = k;
        break;
      }
    }
    if (quotePos === -1) {
      quotePos = start + 1;
    }
    for (let k = start + 1; k <= closeIdx; k++) {
      if (content[k] === '\n') {
        continue;
      }
      out[k] = k === quotePos ? quoteChar : ' ';
    }
  };

  while (i < len) {
    const c = content[i];

    if (state === 'code') {
      if (c === '/' && content[i + 1] === '/') {
        state = 'lineComment';
        i += 2;
        continue;
      }
      if (c === '#' && content[i + 1] !== '[') {
        state = 'lineComment';
        i += 1;
        continue;
      }
      if (c === '/' && content[i + 1] === '*') {
        state = 'blockComment';
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'single';
        stringStart = i;
        i += 1;
        continue;
      }
      if (c === '"') {
        state = 'double';
        stringStart = i;
        i += 1;
        continue;
      }
      const heredocMatch = /^<<<\s*(['"]?)([A-Za-z_]\w*)\1/.exec(content.slice(i));
      if (heredocMatch) {
        heredocId = heredocMatch[2];
        heredocBlankQuotes = heredocMatch[1] === "'";
        i += heredocMatch[0].length;
        state = 'heredoc';
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'lineComment') {
      if (c === '\n') {
        state = 'code';
        i += 1;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (c === '*' && content[i + 1] === '/') {
        blank(i);
        blank(i + 1);
        i += 2;
        state = 'code';
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }

    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (c === '\\' && i + 1 < len) {
        i += 2;
        continue;
      }
      if (c === quote) {
        finalizeString(stringStart, i, quote);
        i += 1;
        state = 'code';
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'heredoc') {
      // Look for a line that is exactly the closing identifier (allowing
      // leading whitespace and a trailing `;`/`,` and whitespace, per
      // PHP 7.3+ flexible heredoc closing marker indentation).
      const lineEnd = content.indexOf('\n', i);
      const line = lineEnd === -1 ? content.slice(i) : content.slice(i, lineEnd);
      const closeMatch = new RegExp(`^([ \\t]*)${heredocId}(\\b.*)?$`).exec(line);
      if (closeMatch) {
        const rest = closeMatch[2] ?? '';
        // The remainder after the identifier must only contain punctuation
        // that can legally follow a heredoc closing marker.
        if (/^[;,)\s]*$/.test(rest)) {
          // Blank the indentation before the marker, keep the marker itself.
          for (let k = i; k < i + closeMatch[1].length; k++) {
            blank(k);
          }
          i += closeMatch[1].length + heredocId.length;
          state = 'code';
          void heredocBlankQuotes;
          continue;
        }
      }
      blank(i);
      i += 1;
      continue;
    }
  }

  return out.join('');
}

/**
 * Finds the index of the `}` that closes the `{` at `openIndex`.
 * Must be called on content that has already been passed through
 * `stripPhpCommentsAndStrings` so that braces inside comments/strings do
 * not affect the count.
 */
export function findMatchingBrace(content: string, openIndex: number): number {
  if (content[openIndex] !== '{') {
    return -1;
  }
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const c = content[i];
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Returns the 1-based line number of `index` within `content`.
 */
export function lineOf(content: string, index: number): number {
  let line = 1;
  const end = Math.min(index, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === '\n') {
      line += 1;
    }
  }
  return line;
}
