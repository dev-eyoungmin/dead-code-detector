import * as fs from 'fs';
import type { DependencyGraph } from '../types';
import type { UnusedExportResult, ExportKind } from '../types/analysis';
import { makeExportKey } from './dependencyGraph';
import { hasIgnoreComment, hasFileIgnoreComment } from '../utils/ignoreComment';

/**
 * Detects unused exports in the dependency graph
 */
export function detectUnusedExports(
  graph: DependencyGraph,
  entryPoints: string[],
  frameworkConventionalExports: string[] = []
): UnusedExportResult[] {
  const entryPointSet = new Set(entryPoints);
  const conventionalSet = new Set(frameworkConventionalExports);
  const unusedExports: UnusedExportResult[] = [];
  const sourceCache = new Map<string, string>();

  for (const [filePath, fileNode] of Array.from(graph.files.entries())) {
    // Skip entry points - their exports are considered public API
    if (entryPointSet.has(filePath)) {
      continue;
    }

    // Read source once per file for ignore comment checks
    let source: string | null = null;
    const getSource = (): string | null => {
      if (source !== null) return source;
      if (sourceCache.has(filePath)) {
        source = sourceCache.get(filePath)!;
        return source;
      }
      try {
        source = fs.readFileSync(filePath, 'utf-8');
        sourceCache.set(filePath, source);
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
        // Check @dead-code-ignore comment
        const src = getSource();
        if (src && hasIgnoreComment(src, exportInfo.line)) {
          continue;
        }

        const confidence = determineConfidence(
          exportInfo,
          conventionalSet,
          filePath
        );

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
function determineConfidence(
  exportInfo: {
    name: string;
    isDefault: boolean;
    isReExport: boolean;
    isTypeOnly: boolean;
    kind: string;
  },
  conventionalExports: Set<string> = new Set(),
  filePath: string = ''
): 'high' | 'medium' | 'low' {
  // Framework conventional exports (e.g. getServerSideProps, loader)
  if (conventionalExports.has(exportInfo.name)) {
    return 'low';
  }

  // .tsx/.jsx PascalCase default exports are likely React components used by framework
  if (
    exportInfo.isDefault &&
    (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) &&
    /^[A-Z]/.test(exportInfo.name)
  ) {
    return 'low';
  }

  // React hooks: use* pattern (useAuth, useTheme, etc.)
  if (/^use[A-Z]/.test(exportInfo.name)) {
    return 'low';
  }

  // HOC pattern: with* (withAuth, withRouter, etc.)
  if (/^with[A-Z]/.test(exportInfo.name) && exportInfo.kind === 'function') {
    return 'low';
  }

  // Context/Provider/Consumer pattern
  if (/(?:Context|Provider|Consumer)$/.test(exportInfo.name)) {
    return 'low';
  }

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
