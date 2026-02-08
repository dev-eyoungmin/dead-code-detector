import type { DependencyGraph } from '../types';
import type { UnusedExportResult, ExportKind } from '../types/analysis';
import { makeExportKey } from './dependencyGraph';

/**
 * Detects unused exports in the dependency graph
 */
export function detectUnusedExports(
  graph: DependencyGraph,
  entryPoints: string[]
): UnusedExportResult[] {
  const entryPointSet = new Set(entryPoints);
  const unusedExports: UnusedExportResult[] = [];

  for (const [filePath, fileNode] of Array.from(graph.files.entries())) {
    // Skip entry points - their exports are considered public API
    if (entryPointSet.has(filePath)) {
      continue;
    }

    for (const exportInfo of fileNode.exports) {
      // Skip wildcard re-exports (export * from 'x')
      if (exportInfo.name === '*') {
        continue;
      }

      const exportKey = makeExportKey(filePath, exportInfo.name);
      const usages = graph.exportUsages.get(exportKey);
      const usageCount = usages?.size || 0;

      // Export is unused if no other file imports it
      if (usageCount === 0) {
        const confidence = determineConfidence(exportInfo);

        unusedExports.push({
          filePath,
          exportName: exportInfo.name,
          line: exportInfo.line,
          column: exportInfo.column,
          confidence,
          kind: mapToExportKind(exportInfo.kind),
        });
      }
    }
  }

  return unusedExports;
}

/**
 * Determines confidence level for unused export detection
 */
function determineConfidence(exportInfo: {
  isDefault: boolean;
  isReExport: boolean;
  isTypeOnly: boolean;
  kind: string;
}): 'high' | 'medium' | 'low' {
  // Re-exports might be part of a public API barrel
  if (exportInfo.isReExport) {
    return 'low';
  }

  // Type-only exports are safer to remove
  if (exportInfo.isTypeOnly) {
    return 'medium';
  }

  // Default exports are often entry points or intentional public API
  if (exportInfo.isDefault) {
    return 'low';
  }

  // Named exports from regular files
  return 'medium';
}

/**
 * Maps the internal kind string to ExportKind type
 */
function mapToExportKind(kind: string): ExportKind {
  switch (kind) {
    case 'function':
      return 'function';
    case 'class':
      return 'class';
    case 'variable':
      return 'variable';
    case 'type':
      return 'type';
    case 'interface':
      return 'interface';
    case 'enum':
      return 'enum';
    case 'default':
      return 'default';
    default:
      return 'unknown';
  }
}
