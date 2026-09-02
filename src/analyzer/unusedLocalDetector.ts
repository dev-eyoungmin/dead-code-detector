import type { DependencyGraph } from '../types';
import type { UnusedLocalResult, LocalKind } from '../types/analysis';
import { hasIgnoreComment, hasFileIgnoreComment } from '../utils/ignoreComment';
import { readSource } from './sourceCache';
import { isTypeScriptFamily } from './languages';

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
      source = readSource(filePath) ?? '';
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
  local: { name: string; kind: string; isParameterProperty?: boolean },
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

  // Unused parameters are often required by a signature contract
  if (local.kind === 'parameter') {
    return 'medium';
  }

  // Private fields may be written through frameworks or reflection
  if (local.kind === 'field') {
    return 'medium';
  }

  // Outside the TypeScript family, member references are counted with regexes
  // over source whose string literals have been blanked out. That cannot see a
  // method reached through a string callable — `call_user_func([$this, 'x'])`,
  // `array_map([$this, 'x'], ...)`, `$this->{$handler}()` — so a zero-reference
  // method there is not evidence strong enough for the top tier.
  if (local.kind === 'method' && !isTypeScriptFamily(filePath)) {
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
    case 'method':
      return 'method';
    case 'field':
      return 'field';
    case 'constant':
      return 'constant';
    default:
      return 'unknown';
  }
}
