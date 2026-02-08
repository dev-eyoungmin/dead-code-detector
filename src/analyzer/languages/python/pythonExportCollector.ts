import type { ExportInfo } from '../../../types';
import type { ExportKind } from '../../../types/analysis';

/**
 * Collects exports from a Python source file.
 *
 * Rules:
 * - If `__all__` is defined, only those names are exports
 * - Otherwise, all top-level names that don't start with `_` are exports
 */
export function collectPythonExports(
  content: string,
  filePath: string
): ExportInfo[] {
  const lines = content.split('\n');

  // Check for __all__ definition
  const allNames = parseAllList(content);
  if (allNames !== null) {
    return allNames.map((name) => {
      const line = findDefinitionLine(name, lines);
      return {
        name,
        isDefault: false,
        isReExport: false,
        line,
        column: 0,
        kind: getKindForName(name, lines),
        isTypeOnly: false,
      };
    });
  }

  // No __all__ — extract all top-level public names
  const exports: ExportInfo[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines, comments, and indented code (non-top-level)
    if (line.match(/^\s/) && !line.match(/^(def |class |[A-Za-z_])/)) {
      continue;
    }

    // Function definition: def func_name(
    const funcMatch = line.match(/^def\s+([a-zA-Z_]\w*)\s*\(/);
    if (funcMatch) {
      const name = funcMatch[1];
      if (!name.startsWith('_') && !seen.has(name)) {
        seen.add(name);
        exports.push({
          name,
          isDefault: false,
          isReExport: false,
          line: i + 1,
          column: 0,
          kind: 'function',
          isTypeOnly: false,
        });
      }
      continue;
    }

    // Class definition: class ClassName
    const classMatch = line.match(/^class\s+([a-zA-Z_]\w*)/);
    if (classMatch) {
      const name = classMatch[1];
      if (!name.startsWith('_') && !seen.has(name)) {
        seen.add(name);
        exports.push({
          name,
          isDefault: false,
          isReExport: false,
          line: i + 1,
          column: 0,
          kind: 'class',
          isTypeOnly: false,
        });
      }
      continue;
    }

    // Variable assignment: NAME = value (top-level, no indentation)
    const varMatch = line.match(/^([a-zA-Z_]\w*)\s*(?::\s*\w+\s*)?=/);
    if (varMatch) {
      const name = varMatch[1];
      if (!name.startsWith('_') && name !== '__all__' && !seen.has(name)) {
        seen.add(name);
        const kind: ExportKind = name === name.toUpperCase() ? 'constant' : 'variable';
        exports.push({
          name,
          isDefault: false,
          isReExport: false,
          line: i + 1,
          column: 0,
          kind,
          isTypeOnly: false,
        });
      }
      continue;
    }
  }

  return exports;
}

/**
 * Parses `__all__` list from Python source.
 * Returns null if __all__ is not defined.
 */
function parseAllList(content: string): string[] | null {
  // Handle multi-line __all__ = [...]
  const allRegex = /__all__\s*=\s*\[([^\]]*)\]/s;
  const match = allRegex.exec(content);
  if (!match) {
    return null;
  }

  const inner = match[1];
  const names: string[] = [];
  const strRegex = /['"]([^'"]+)['"]/g;
  let strMatch: RegExpExecArray | null;
  while ((strMatch = strRegex.exec(inner)) !== null) {
    names.push(strMatch[1]);
  }

  return names;
}

function findDefinitionLine(name: string, lines: string[]): number {
  const escapedName = escapeRegex(name);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      new RegExp(`^def\\s+${escapedName}\\s*\\(`).test(line) ||
      new RegExp(`^class\\s+${escapedName}[\\s:(]`).test(line) ||
      new RegExp(`^${escapedName}\\s*(?::\\s*\\w+\\s*)?=`).test(line)
    ) {
      return i + 1;
    }
  }
  return 1;
}

function getKindForName(name: string, lines: string[]): ExportKind {
  const escapedName = escapeRegex(name);
  for (const line of lines) {
    if (new RegExp(`^def\\s+${escapedName}\\s*\\(`).test(line)) {
      return 'function';
    }
    if (new RegExp(`^class\\s+${escapedName}[\\s:(]`).test(line)) {
      return 'class';
    }
    if (new RegExp(`^${escapedName}\\s*(?::\\s*\\w+\\s*)?=`).test(line)) {
      return name === name.toUpperCase() ? 'constant' : 'variable';
    }
  }
  return 'unknown';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
