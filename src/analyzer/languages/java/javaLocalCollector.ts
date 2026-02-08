import type { LocalSymbolInfo } from '../../../types';
import type { LocalKind } from '../../../types/analysis';

/**
 * Collects local (private/package-private) symbols from a Java source file.
 *
 * Private or package-private members that are not referenced elsewhere in the file
 * are candidates for dead code.
 */
export function collectJavaLocals(
  content: string,
  exportedNames: Set<string>
): LocalSymbolInfo[] {
  const locals: LocalSymbolInfo[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Handle block comments
    if (inBlockComment) {
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }
    if (trimmed.startsWith('//')) {
      continue;
    }

    // Private method: private [static] [final] ReturnType methodName(
    const privateMethodMatch = trimmed.match(
      /^private\s+(?:(?:static|final|abstract|synchronized)\s+)*(?:\w+(?:<[^>]*>)?(?:\[\])*)\s+(\w+)\s*\(/
    );
    if (privateMethodMatch && !seen.has(privateMethodMatch[1]) && !exportedNames.has(privateMethodMatch[1])) {
      const name = privateMethodMatch[1];
      seen.add(name);
      locals.push({
        name,
        line: i + 1,
        column: 0,
        kind: 'method',
        references: countReferences(name, content, i),
      });
      continue;
    }

    // Private field: private [static] [final] Type fieldName [= value];
    const privateFieldMatch = trimmed.match(
      /^private\s+(?:(?:static|final|volatile|transient)\s+)*(?:\w+(?:<[^>]*>)?(?:\[\])*)\s+(\w+)\s*[=;]/
    );
    if (privateFieldMatch && !seen.has(privateFieldMatch[1]) && !exportedNames.has(privateFieldMatch[1])) {
      const name = privateFieldMatch[1];
      seen.add(name);
      const isConstant = trimmed.includes('static') && trimmed.includes('final');
      locals.push({
        name,
        line: i + 1,
        column: 0,
        kind: isConstant ? 'constant' : 'field',
        references: countReferences(name, content, i),
      });
      continue;
    }

    // Private class: private [static] class ClassName
    const privateClassMatch = trimmed.match(
      /^private\s+(?:(?:static|final|abstract)\s+)*class\s+(\w+)/
    );
    if (privateClassMatch && !seen.has(privateClassMatch[1]) && !exportedNames.has(privateClassMatch[1])) {
      const name = privateClassMatch[1];
      seen.add(name);
      locals.push({
        name,
        line: i + 1,
        column: 0,
        kind: 'class',
        references: countReferences(name, content, i),
      });
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
