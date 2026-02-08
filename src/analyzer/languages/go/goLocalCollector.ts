import type { LocalSymbolInfo } from '../../../types';
import type { LocalKind } from '../../../types/analysis';

/**
 * Collects local (unexported) symbols from a Go source file.
 *
 * Go export rule: identifiers starting with lowercase are unexported (local to package).
 */
export function collectGoLocals(
  content: string,
  exportedNames: Set<string>
): LocalSymbolInfo[] {
  const locals: LocalSymbolInfo[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    // func funcName( — unexported function (lowercase start)
    const funcMatch = trimmed.match(/^func\s+([a-z_]\w*)\s*\(/);
    if (funcMatch) {
      const name = funcMatch[1];
      if (name !== 'main' && name !== 'init' && !seen.has(name) && !exportedNames.has(name)) {
        seen.add(name);
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

    // type typeName struct/interface/...
    const typeMatch = trimmed.match(/^type\s+([a-z_]\w*)\s+\w+/);
    if (typeMatch && !seen.has(typeMatch[1]) && !exportedNames.has(typeMatch[1])) {
      seen.add(typeMatch[1]);
      locals.push({
        name: typeMatch[1],
        line: i + 1,
        column: 0,
        kind: 'variable',
        references: countReferences(typeMatch[1], content, i),
      });
      continue;
    }

    // var varName ...
    const varMatch = trimmed.match(/^var\s+([a-z_]\w*)\s/);
    if (varMatch && !seen.has(varMatch[1]) && !exportedNames.has(varMatch[1])) {
      seen.add(varMatch[1]);
      locals.push({
        name: varMatch[1],
        line: i + 1,
        column: 0,
        kind: 'variable',
        references: countReferences(varMatch[1], content, i),
      });
      continue;
    }

    // const constName ...
    const constMatch = trimmed.match(/^const\s+([a-z_]\w*)\s/);
    if (constMatch && !seen.has(constMatch[1]) && !exportedNames.has(constMatch[1])) {
      seen.add(constMatch[1]);
      locals.push({
        name: constMatch[1],
        line: i + 1,
        column: 0,
        kind: 'constant',
        references: countReferences(constMatch[1], content, i),
      });
      continue;
    }

    // Handle var/const blocks with lowercase names
    if (trimmed === 'var (' || trimmed === 'const (') {
      const blockKind: LocalKind = trimmed.startsWith('var') ? 'variable' : 'constant';
      i++;
      while (i < lines.length) {
        const blockLine = lines[i].trim();
        if (blockLine === ')') {
          break;
        }
        const blockMatch = blockLine.match(/^([a-z_]\w*)\s/);
        if (blockMatch && !seen.has(blockMatch[1]) && !exportedNames.has(blockMatch[1])) {
          seen.add(blockMatch[1]);
          locals.push({
            name: blockMatch[1],
            line: i + 1,
            column: 0,
            kind: blockKind,
            references: countReferences(blockMatch[1], content, i),
          });
        }
        i++;
      }
      continue;
    }
  }

  return locals;
}

function countReferences(name: string, content: string, definitionLine: number): number {
  const lines = content.split('\n');
  let count = 0;
  const wordRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');

  for (let i = 0; i < lines.length; i++) {
    if (i === definitionLine) {
      continue;
    }
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      continue;
    }
    // Remove string literals
    const cleaned = line.replace(/"[^"]*"/g, '""');
    const matches = cleaned.match(wordRegex);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
