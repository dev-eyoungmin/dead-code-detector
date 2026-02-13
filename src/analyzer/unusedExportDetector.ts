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

  // --- Python patterns ---

  // Python test files: test_*.py, *_test.py, tests/ directory, conftest.py
  if (
    filePath.endsWith('.py') && (
      /\/test_[^/]+\.py$/.test(filePath) ||
      /_test\.py$/.test(filePath) ||
      /\/tests\//.test(filePath) ||
      /\/conftest\.py$/.test(filePath)
    )
  ) {
    return 'low';
  }

  // Python dunder methods/attrs (consumed by framework/runtime)
  if (filePath.endsWith('.py') && /^__\w+__$/.test(exportInfo.name)) {
    return 'low';
  }

  // --- Go patterns ---

  // Go test utility packages
  if (filePath.endsWith('.go') && /\/(testdata|testutil|testing)\//.test(filePath)) {
    return 'low';
  }

  // --- Java patterns ---

  // Java test files: *Test.java, *Tests.java, *Spec.java, src/test/
  if (
    filePath.endsWith('.java') && (
      /Test\.java$/.test(filePath) ||
      /Tests\.java$/.test(filePath) ||
      /Spec\.java$/.test(filePath) ||
      /\/src\/test\//.test(filePath)
    )
  ) {
    return 'low';
  }

  // Java: common overrides/lifecycle methods consumed by framework, and enums
  if (
    filePath.endsWith('.java') && (
      /^(?:toString|hashCode|equals|compareTo|clone)$/.test(exportInfo.name) ||
      exportInfo.kind === 'enum'
    )
  ) {
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

  // .tsx/.jsx PascalCase named variable exports (React.forwardRef, memo, styled-components)
  if (
    exportInfo.kind === 'variable' &&
    /^[A-Z]/.test(exportInfo.name) &&
    (filePath.endsWith('.tsx') || filePath.endsWith('.jsx'))
  ) {
    return 'low';
  }

  // Test/spec file exports — consumed by test runners, not import-tracked
  if (
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) ||
    /__tests__\//.test(filePath)
  ) {
    return 'low';
  }

  // Storybook CSF3 named story exports (Primary, Secondary, Large, etc.)
  if (
    /\.stories\.(ts|tsx|js|jsx)$/.test(filePath) &&
    /^[A-Z]/.test(exportInfo.name) &&
    !exportInfo.isDefault
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

  // Render prop functions: render* (renderItem, renderHeader, etc.)
  if (/^render[A-Z]/.test(exportInfo.name) && exportInfo.kind === 'function') {
    return 'low';
  }

  // Event handler functions: handle*, on* (handleSubmit, onPress, etc.)
  if (
    (/^handle[A-Z]/.test(exportInfo.name) || /^on[A-Z]/.test(exportInfo.name)) &&
    exportInfo.kind === 'function'
  ) {
    return 'low';
  }

  // Redux selector functions: select* (selectUser, selectItems, etc.)
  if (/^select[A-Z]/.test(exportInfo.name) && exportInfo.kind === 'function') {
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
