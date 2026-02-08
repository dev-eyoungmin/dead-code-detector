import type { ExportInfo } from '../../../types';
import type { ExportKind } from '../../../types/analysis';

/**
 * Collects exported symbols from a Go source file.
 *
 * Go export rule: identifiers starting with an uppercase letter are exported.
 * This includes functions, types (struct, interface), constants, and variables.
 */
export function collectGoExports(
  content: string,
  _filePath: string
): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    // func FuncName(
    const funcMatch = trimmed.match(/^func\s+([A-Z]\w*)\s*\(/);
    if (funcMatch && !seen.has(funcMatch[1])) {
      seen.add(funcMatch[1]);
      exports.push({
        name: funcMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'function',
        isTypeOnly: false,
      });
      continue;
    }

    // Method with receiver: func (r Receiver) MethodName(
    const methodMatch = trimmed.match(/^func\s+\([^)]*\)\s+([A-Z]\w*)\s*\(/);
    if (methodMatch && !seen.has(methodMatch[1])) {
      seen.add(methodMatch[1]);
      exports.push({
        name: methodMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'method',
        isTypeOnly: false,
      });
      continue;
    }

    // type TypeName struct/interface/...
    const typeMatch = trimmed.match(/^type\s+([A-Z]\w*)\s+(\w+)/);
    if (typeMatch && !seen.has(typeMatch[1])) {
      seen.add(typeMatch[1]);
      const typeKind = typeMatch[2];
      let kind: ExportKind = 'type';
      if (typeKind === 'struct') {
        kind = 'struct';
      } else if (typeKind === 'interface') {
        kind = 'interface';
      }
      exports.push({
        name: typeMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind,
        isTypeOnly: false,
      });
      continue;
    }

    // var VarName type = value  or  var VarName = value
    const varMatch = trimmed.match(/^var\s+([A-Z]\w*)\s/);
    if (varMatch && !seen.has(varMatch[1])) {
      seen.add(varMatch[1]);
      exports.push({
        name: varMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'variable',
        isTypeOnly: false,
      });
      continue;
    }

    // const ConstName = value  or  const ConstName type = value
    const constMatch = trimmed.match(/^const\s+([A-Z]\w*)\s/);
    if (constMatch && !seen.has(constMatch[1])) {
      seen.add(constMatch[1]);
      exports.push({
        name: constMatch[1],
        isDefault: false,
        isReExport: false,
        line: i + 1,
        column: 0,
        kind: 'constant',
        isTypeOnly: false,
      });
      continue;
    }

    // Handle var/const blocks: var ( ... ) / const ( ... )
    if (trimmed === 'var (' || trimmed === 'const (') {
      const blockKind = trimmed.startsWith('var') ? 'variable' : 'constant';
      i++;
      while (i < lines.length) {
        const blockLine = lines[i].trim();
        if (blockLine === ')') {
          break;
        }
        const blockMatch = blockLine.match(/^([A-Z]\w*)\s/);
        if (blockMatch && !seen.has(blockMatch[1])) {
          seen.add(blockMatch[1]);
          exports.push({
            name: blockMatch[1],
            isDefault: false,
            isReExport: false,
            line: i + 1,
            column: 0,
            kind: blockKind === 'variable' ? 'variable' : 'constant',
            isTypeOnly: false,
          });
        }
        i++;
      }
      continue;
    }
  }

  return exports;
}
