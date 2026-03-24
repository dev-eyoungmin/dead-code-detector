import type { LocalSymbolInfo } from '../../../types';

/**
 * Collects private (_-prefixed) top-level symbols from a Dart file.
 */
export function collectDartLocals(
  content: string,
  exportedNames: Set<string>
): LocalSymbolInfo[] {
  const locals: LocalSymbolInfo[] = [];
  const lines = content.split('\n');

  const patterns: Array<{ regex: RegExp; kind: string }> = [
    { regex: /^(?:abstract\s+)?class\s+(_\w+)/, kind: 'class' },
    { regex: /^mixin\s+(_\w+)/, kind: 'class' },
    { regex: /^enum\s+(_\w+)/, kind: 'enum' },
    { regex: /^extension\s+(_\w+)\s+on/, kind: 'class' },
    { regex: /^typedef\s+(_\w+)/, kind: 'type' },
    { regex: /^(?:\w+(?:<[^>]*>)?(?:\?)?)\s+(_\w+)\s*\(/, kind: 'function' },
    { regex: /^(?:(?:late\s+)?(?:final|const|var)\s+)(?:(?:\w+(?:<[^>]*>)?(?:\?)?)\s+)?(_\w+)\s*[=;]/, kind: 'variable' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') ||
        trimmed.startsWith('import ') || trimmed.startsWith('export ') ||
        trimmed.startsWith('part ')) continue;

    for (const { regex, kind } of patterns) {
      const m = trimmed.match(regex);
      if (m && m[1].startsWith('_') && !exportedNames.has(m[1])) {
        const escaped = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(`\\b${escaped}\\b`, 'g');
        const allMatches = content.match(nameRegex);
        const references = Math.max(0, (allMatches?.length || 0) - 1);

        locals.push({
          name: m[1],
          line: i + 1,
          column: 0,
          kind,
          references,
        });
        break;
      }
    }
  }

  return locals;
}
