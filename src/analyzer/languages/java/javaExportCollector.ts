import type { ExportInfo } from '../../../types';

/**
 * Collects exported (public) symbols from a Java source file.
 *
 * In Java, `public` modifier = exported.
 * Each .java file can have at most one public class (matching filename).
 */
export function collectJavaExports(
  content: string,
  _filePath: string
): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

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

    // Public class: public class ClassName
    const classMatch = trimmed.match(
      /^public\s+(?:(?:abstract|final|strictfp)\s+)*class\s+(\w+)/
    );
    if (classMatch && !seen.has(classMatch[1])) {
      seen.add(classMatch[1]);
      exports.push({
        name: classMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'class',
        isTypeOnly: false,
      });
      continue;
    }

    // Public interface: public interface InterfaceName
    const ifaceMatch = trimmed.match(
      /^public\s+(?:(?:abstract|strictfp)\s+)*interface\s+(\w+)/
    );
    if (ifaceMatch && !seen.has(ifaceMatch[1])) {
      seen.add(ifaceMatch[1]);
      exports.push({
        name: ifaceMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'interface',
        isTypeOnly: false,
      });
      continue;
    }

    // Public enum: public enum EnumName
    const enumMatch = trimmed.match(
      /^public\s+enum\s+(\w+)/
    );
    if (enumMatch && !seen.has(enumMatch[1])) {
      seen.add(enumMatch[1]);
      exports.push({
        name: enumMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'enum',
        isTypeOnly: false,
      });
      continue;
    }

    // Public method: public [static] [final] ReturnType methodName(
    const methodMatch = trimmed.match(
      /^public\s+(?:(?:static|final|abstract|synchronized|native)\s+)*(?:\w+(?:<[^>]*>)?(?:\[\])*)\s+(\w+)\s*\(/
    );
    if (methodMatch && !seen.has(methodMatch[1])) {
      const name = methodMatch[1];
      // Skip constructors (name matches class name — detected by uppercase start typical for Java classes)
      // We'll just add all public methods
      seen.add(name);
      exports.push({
        name,
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'method',
        isTypeOnly: false,
      });
      continue;
    }

    // Public field: public [static] [final] Type fieldName [= value];
    const fieldMatch = trimmed.match(
      /^public\s+(?:(?:static|final|volatile|transient)\s+)*(?:\w+(?:<[^>]*>)?(?:\[\])*)\s+(\w+)\s*[=;]/
    );
    if (fieldMatch && !seen.has(fieldMatch[1])) {
      const name = fieldMatch[1];
      seen.add(name);
      const isConstant = trimmed.includes('static') && trimmed.includes('final');
      exports.push({
        name,
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: isConstant ? 'constant' : 'variable',
        isTypeOnly: false,
      });
      continue;
    }
  }

  return exports;
}
