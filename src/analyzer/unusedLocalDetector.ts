import type { DependencyGraph } from '../types';
import type { UnusedLocalResult, LocalKind } from '../types/analysis';

/**
 * Detects unused local symbols in the dependency graph
 */
export function detectUnusedLocals(
  graph: DependencyGraph
): UnusedLocalResult[] {
  const unusedLocals: UnusedLocalResult[] = [];

  for (const [filePath, fileNode] of Array.from(graph.files.entries())) {
    for (const local of fileNode.locals) {
      // A local is unused if it has zero references
      if (local.references === 0) {
        // Skip symbols that start with underscore (intentionally unused)
        if (local.name.startsWith('_')) {
          continue;
        }

        unusedLocals.push({
          filePath,
          symbolName: local.name,
          line: local.line,
          column: local.column,
          confidence: 'high', // Local symbol detection is very reliable
          kind: mapToLocalKind(local.kind),
        });
      }
    }
  }

  return unusedLocals;
}

/**
 * Maps the internal kind string to LocalKind type
 */
function mapToLocalKind(kind: string): LocalKind {
  switch (kind) {
    case 'variable':
      return 'variable';
    case 'function':
      return 'function';
    case 'class':
      return 'class';
    case 'parameter':
      return 'parameter';
    default:
      return 'unknown';
  }
}
