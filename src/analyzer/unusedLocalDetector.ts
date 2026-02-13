import * as fs from 'fs';
import type { DependencyGraph } from '../types';
import type { UnusedLocalResult, LocalKind } from '../types/analysis';
import { hasIgnoreComment, hasFileIgnoreComment } from '../utils/ignoreComment';

/**
 * Detects unused local symbols in the dependency graph
 */
export function detectUnusedLocals(
  graph: DependencyGraph
): UnusedLocalResult[] {
  const unusedLocals: UnusedLocalResult[] = [];

  for (const [filePath, fileNode] of Array.from(graph.files.entries())) {
    // Read source once per file for ignore comment checks
    let source: string | null = null;
    const getSource = (): string | null => {
      if (source !== null) return source;
      try {
        source = fs.readFileSync(filePath, 'utf-8');
      } catch {
        source = '';
      }
      return source;
    };

    // Skip file-level ignore
    const fileSource = getSource();
    if (fileSource && hasFileIgnoreComment(fileSource)) {
      continue;
    }

    for (const local of fileNode.locals) {
      // A local is unused if it has zero references
      if (local.references === 0) {
        // Skip symbols that start with underscore (intentionally unused)
        if (local.name.startsWith('_')) {
          continue;
        }

        // Check @dead-code-ignore comment
        const src = getSource();
        if (src && hasIgnoreComment(src, local.line)) {
          continue;
        }

        unusedLocals.push({
          filePath,
          symbolName: local.name,
          line: local.line,
          column: local.column,
          confidence: determineLocalConfidence(local, filePath),
          kind: mapToLocalKind(local.kind),
        });
      }
    }
  }

  return unusedLocals;
}

/**
 * Determines confidence level for unused local detection.
 * React hook results (set*, dispatch) in .tsx/.jsx are commonly intentionally unused.
 */
function determineLocalConfidence(
  local: { name: string; kind: string },
  filePath: string
): 'high' | 'medium' | 'low' {
  if (
    (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) &&
    local.kind === 'variable' &&
    (/^set[A-Z]/.test(local.name) || local.name === 'dispatch')
  ) {
    return 'medium';
  }

  // Java serialVersionUID — required by Serializable, looks unused
  if (filePath.endsWith('.java') && local.name === 'serialVersionUID') {
    return 'low';
  }

  // Java logger fields — often referenced in framework-injected way
  if (
    filePath.endsWith('.java') &&
    /^(?:logger|log|LOG|LOGGER)$/.test(local.name)
  ) {
    return 'medium';
  }

  return 'high';
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
