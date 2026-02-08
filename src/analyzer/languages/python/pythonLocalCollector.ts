import type { LocalSymbolInfo } from '../../../types';
import type { LocalKind } from '../../../types/analysis';

/**
 * Collects local (non-exported) symbols from a Python source file.
 *
 * A symbol is considered local/private if:
 * - It starts with `_` (Python convention for private)
 * - It's defined at top-level and not in __all__ (if __all__ exists)
 *
 * Reference counting: counts occurrences of the symbol name in the file
 * beyond its definition.
 */
export function collectPythonLocals(
  content: string,
  exportedNames: Set<string>
): LocalSymbolInfo[] {
  const locals: LocalSymbolInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Private function: def _func_name(
    const funcMatch = line.match(/^def\s+(_[a-zA-Z_]\w*)\s*\(/);
    if (funcMatch) {
      const name = funcMatch[1];
      if (!exportedNames.has(name)) {
        locals.push({
          name,
          line: i + 1,
          column: 0,
          kind: 'function',
          references: countReferences(name, content, i),
        });
      }
      continue;
    }

    // Private class: class _ClassName
    const classMatch = line.match(/^class\s+(_[a-zA-Z_]\w*)/);
    if (classMatch) {
      const name = classMatch[1];
      if (!exportedNames.has(name)) {
        locals.push({
          name,
          line: i + 1,
          column: 0,
          kind: 'class',
          references: countReferences(name, content, i),
        });
      }
      continue;
    }

    // Private variable: _name = value (top-level)
    const varMatch = line.match(/^(_[a-zA-Z_]\w*)\s*(?::\s*\w+\s*)?=/);
    if (varMatch) {
      const name = varMatch[1];
      if (name !== '__all__' && !name.startsWith('__') && !exportedNames.has(name)) {
        const kind: LocalKind = name === name.toUpperCase() ? 'constant' : 'variable';
        locals.push({
          name,
          line: i + 1,
          column: 0,
          kind,
          references: countReferences(name, content, i),
        });
      }
      continue;
    }
  }

  return locals;
}

/**
 * Count references to a name in the content, excluding the definition line.
 */
function countReferences(name: string, content: string, definitionLine: number): number {
  const lines = content.split('\n');
  let count = 0;
  const wordRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');

  for (let i = 0; i < lines.length; i++) {
    if (i === definitionLine) {
      continue;
    }
    const line = lines[i];
    // Skip comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      continue;
    }
    // Remove string literals and comments before counting
    const cleaned = removeStringsAndComments(line);
    const matches = cleaned.match(wordRegex);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

function removeStringsAndComments(line: string): string {
  // Remove comments
  let result = '';
  let inString: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inString) {
      if (ch === inString && line[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }

    if (ch === '#') {
      break;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }

    result += ch;
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
