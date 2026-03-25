import type { ExportInfo } from '../../../types';
import { resolveDartImport } from './dartModuleResolver';
import { isDartDIAnnotation } from '../../decoratorDetector';

/**
 * Collects public (exported) symbols from a Dart source file.
 * In Dart, all top-level symbols without a _ prefix are public.
 */
export function collectDartExports(
  content: string,
  filePath: string,
  rootDir?: string,
  packageName?: string
): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = content.split('\n');
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Track brace depth to only collect top-level declarations
    for (const ch of lines[i]) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    // Skip if inside a class/function body
    // Note: lines that OPEN a brace (class Foo {) will have braceDepth > 0
    // after processing, but the declaration is on the same line, so we check
    // the depth BEFORE the line's braces using a pre-count
    const openBraces = (lines[i].match(/\{/g) || []).length;
    const depthBeforeLine = braceDepth - openBraces + (lines[i].match(/\}/g) || []).length;
    if (depthBeforeLine > 0) continue;

    // Skip comments, imports, part directives
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') ||
        trimmed.startsWith('import ') || trimmed.startsWith('part ')) continue;

    let m: RegExpMatchArray | null;

    // Class (including abstract)
    m = trimmed.match(/^(?:abstract\s+)?class\s+([A-Za-z_]\w*)/);
    if (m && !m[1].startsWith('_')) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'class', isTypeOnly: false, isEntryPointDecorated: hasDartDIAnnotation(lines, i) || undefined });
      continue;
    }

    // Mixin
    m = trimmed.match(/^mixin\s+([A-Za-z_]\w*)/);
    if (m && !m[1].startsWith('_')) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'class', isTypeOnly: false });
      continue;
    }

    // Enum
    m = trimmed.match(/^enum\s+([A-Za-z_]\w*)/);
    if (m && !m[1].startsWith('_')) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'enum', isTypeOnly: false });
      continue;
    }

    // Extension
    m = trimmed.match(/^extension\s+([A-Za-z_]\w*)\s+on/);
    if (m && !m[1].startsWith('_')) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'class', isTypeOnly: false });
      continue;
    }

    // Typedef
    m = trimmed.match(/^typedef\s+([A-Za-z_]\w*)/);
    if (m && !m[1].startsWith('_')) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'type', isTypeOnly: true });
      continue;
    }

    // Top-level function (return type + name + open paren)
    m = trimmed.match(/^(?:Future(?:<[^>]*>)?|Stream(?:<[^>]*>)?|void|int|double|bool|String|dynamic|num|Object|List(?:<[^>]*>)?|Map(?:<[^>]*>)?|Set(?:<[^>]*>)?|[A-Z]\w*(?:<[^>]*>)?)\??\s+([a-zA-Z_]\w*)\s*\(/);
    if (m && !m[1].startsWith('_') && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'function', isTypeOnly: false });
      continue;
    }

    // Top-level variable with var/final/const keyword
    m = trimmed.match(/^(?:(?:late\s+)?(?:final|const|var)\s+)(?:(?:\w+(?:<[^>]*>)?(?:\?)?)\s+)?([A-Za-z_]\w*)\s*[=;]/);
    if (m && !m[1].startsWith('_')) {
      exports.push({ name: m[1], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'variable', isTypeOnly: false });
      continue;
    }

    // Top-level variable with type annotation (Type name =)
    m = trimmed.match(/^([A-Z]\w*(?:<[^>]*>)?(?:\?)?)\s+([a-z_]\w*)\s*[=;]/);
    if (m && !m[2].startsWith('_') && !['if', 'for', 'while', 'return'].includes(m[2])) {
      exports.push({ name: m[2], isDefault: false, isReExport: false, line: i + 1, column: 0, kind: 'variable', isTypeOnly: false });
      continue;
    }

    // Export directives -> re-exports
    m = trimmed.match(/^export\s+'([^']+)'(?:\s+show\s+([^;]+))?;/);
    if (m) {
      const source = m[1];
      const showNames = m[2];
      const resolvedSource = (rootDir && packageName)
        ? resolveDartImport(source, filePath, rootDir, packageName) || source
        : source;

      if (showNames) {
        const names = showNames.split(',').map(n => n.trim()).filter(Boolean);
        for (const name of names) {
          exports.push({
            name,
            isDefault: false,
            isReExport: true,
            reExportSource: resolvedSource,
            line: i + 1,
            column: 0,
            kind: 'unknown',
            isTypeOnly: false,
          });
        }
      } else {
        exports.push({
          name: '*',
          isDefault: false,
          isReExport: true,
          reExportSource: resolvedSource,
          line: i + 1,
          column: 0,
          kind: 'unknown',
          isTypeOnly: false,
        });
      }
    }
  }

  return exports;
}

/**
 * Checks if a Dart file contains a 'part of' directive
 */
export function isPartFile(content: string): boolean {
  return /^part\s+of\s+/m.test(content);
}

/**
 * Checks whether lines preceding a Dart class definition contain a known DI annotation
 * (e.g. @injectable, @lazySingleton, @singleton).
 */
function hasDartDIAnnotation(lines: string[], defLineIndex: number): boolean {
  for (let j = defLineIndex - 1; j >= 0; j--) {
    const prevLine = lines[j].trim();
    if (prevLine === '') continue;
    if (!prevLine.startsWith('@')) break;
    const match = prevLine.match(/^@([A-Za-z_]\w*)/);
    if (match && isDartDIAnnotation(match[1])) return true;
  }
  return false;
}
