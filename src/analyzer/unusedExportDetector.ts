import type { DependencyGraph } from '../types';
import type { UnusedExportResult, ExportKind } from '../types/analysis';
import { makeExportKey } from './exportKey';
import { hasIgnoreComment, hasFileIgnoreComment } from '../utils/ignoreComment';
import { readSource } from './sourceCache';
import { MEMBER_USAGE_SENTINEL } from './memberUsage';
import {
  PHP_MAGIC_METHODS,
  matchesPhpConventionalPattern,
} from './languages/php/phpFrameworkDetector';

/** Case-insensitive `.php` test, shared by the entry-point and confidence rules. */
function isPhpPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.php');
}

/**
 * Detects unused exports in the dependency graph.
 *
 * When `reachable` is provided, usages coming from files that are themselves
 * unreachable from any entry point are not counted; an export whose only users
 * are dead is reported at low confidence.
 */
export function detectUnusedExports(
  graph: DependencyGraph,
  entryPoints: string[],
  frameworkConventionalExports: string[] = [],
  alwaysUsedPatterns: string[] = [],
  reachable?: Set<string>
): UnusedExportResult[] {
  const entryPointSet = new Set(entryPoints);
  const conventionalSet = new Set(frameworkConventionalExports);
  const unusedExports: UnusedExportResult[] = [];

  // Pre-compile alwaysUsedPatterns as regexes for fast matching
  const alwaysUsedRegexes = alwaysUsedPatterns
    .map((p) => {
      try {
        // Support simple glob * wildcards
        const regexStr = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${regexStr}$`);
      } catch {
        return null;
      }
    })
    .filter((r): r is RegExp => r !== null);

  for (const [filePath, fileNode] of Array.from(graph.files.entries())) {
    // PHP entry points are convention-scanned directories (every controller,
    // provider, job, ...), not public-API modules: the framework loads the file
    // and calls a handful of conventional methods on it. Skipping such a file
    // wholesale would blind the detector to most of a Laravel/Symfony codebase,
    // so its exports are still analysed and only the framework-invoked
    // conventional names are exempted (see below).
    const isConventionScannedEntryPoint =
      entryPointSet.has(filePath) && isPhpPath(filePath);

    // Skip entry points - their exports are considered public API
    if (entryPointSet.has(filePath) && !isConventionScannedEntryPoint) {
      continue;
    }

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

    for (const exportInfo of fileNode.exports) {
      // Skip wildcard re-exports (export * from 'x')
      if (exportInfo.name === '*') {
        continue;
      }

      const exportKey = makeExportKey(filePath, exportInfo.name);
      const usages = graph.exportUsages.get(exportKey);
      const users = usages ? Array.from(usages) : [];
      // A usage only counts when it comes from a file that is itself reachable
      // (or from the declaring file, or from name-based member usage).
      const liveUsers = reachable
        ? users.filter(
            (u) => u === MEMBER_USAGE_SENTINEL || reachable.has(u) || u === filePath
          )
        : users;
      const usageCount = liveUsers.length;
      const onlyDeadUsers = users.length > 0 && usageCount === 0;

      // Export is unused if no other file imports it
      if (usageCount === 0) {
        // Check @dead-code-ignore comment
        const src = getSource();
        if (src && hasIgnoreComment(src, exportInfo.line)) {
          continue;
        }

        // A conventional name on a convention-scanned entry point (e.g.
        // ServiceProvider::boot, Middleware::handle) is called by the framework
        // itself, so it is never dead — report nothing rather than noise.
        //
        // Deliberate asymmetry, not a bug: the same name is skipped *entirely*
        // here but only downgraded to 'low' by determineConfidence on a
        // non-entry-point file, so `__toString` on a controller disappears while
        // `__toString` on a service still shows at 'low'. Entry-point files are
        // exactly where framework-invoked names are expected, and the direction of
        // the asymmetry is always suppression — it can hide a true positive at the
        // lowest threshold, never manufacture a false one.
        if (isConventionScannedEntryPoint && conventionalSet.has(exportInfo.name)) {
          continue;
        }

        // alwaysUsedPatterns — skip entirely (not reported at any confidence)
        if (
          alwaysUsedRegexes.length > 0 &&
          alwaysUsedRegexes.some((r) => r.test(exportInfo.name))
        ) {
          continue;
        }

        // Only unreachable files reference this export — the whole cluster is
        // dead, so report it at low confidence without further heuristics.
        if (onlyDeadUsers) {
          unusedExports.push({
            filePath,
            exportName: exportInfo.name,
            line: exportInfo.line,
            column: exportInfo.column,
            confidence: 'low',
            kind: mapToExportKind(exportInfo.kind),
          });
          continue;
        }

        // DI-decorated exports are treated as entry points — assign low confidence
        // so they don't appear with the default medium threshold
        if (exportInfo.isEntryPointDecorated) {
          unusedExports.push({
            filePath,
            exportName: exportInfo.name,
            line: exportInfo.line,
            column: exportInfo.column,
            confidence: 'low',
            kind: mapToExportKind(exportInfo.kind),
          });
          continue;
        }

        const confidence = determineConfidence(
          exportInfo,
          conventionalSet,
          filePath,
          fileNode,
          graph.exportUsages
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
  filePath: string = '',
  fileNode?: { exports: Array<{ name: string; isDefault: boolean }> },
  exportUsages?: Map<string, Set<string>>
): 'high' | 'medium' | 'low' {
  // Framework conventional exports (e.g. getServerSideProps, loader)
  if (conventionalExports.has(exportInfo.name)) {
    return 'low';
  }

  // --- Property access pattern (R-4) ---
  // If default export is used and this named export is a shorthand property
  // in the default export object, it's likely accessed via defaultImport.prop
  if (
    fileNode && exportUsages &&
    !exportInfo.isDefault && !exportInfo.isReExport
  ) {
    const defaultKey = `${filePath}::default`;
    const defaultUsages = exportUsages.get(defaultKey);
    if (defaultUsages && defaultUsages.size > 0) {
      if (isNamedExportInDefaultObject(filePath, exportInfo.name)) {
        return 'low';
      }
    }
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

  // --- Dart patterns ---

  // Dart test files
  if (filePath.endsWith('.dart') && (
    /_test\.dart$/.test(filePath) ||
    /\/test\//.test(filePath) ||
    /\/integration_test\//.test(filePath)
  )) {
    return 'low';
  }

  // Dart generated files (safety net if not already ignored)
  if (/\.(g|freezed|gr|config|mocks)\.dart$/.test(filePath)) {
    return 'low';
  }

  // --- PHP patterns ---

  if (isPhpPath(filePath)) {
    // Test sources and Blade templates are executed by the framework/runner,
    // never imported, so their symbols cannot be import-tracked.
    if (
      /\/tests\//.test(filePath) ||
      /Test\.php$/.test(filePath) ||
      /\.spec\.php$/.test(filePath) ||
      /\.blade\.php$/.test(filePath)
    ) {
      return 'low';
    }
    // Magic methods and framework naming conventions (Laravel local scopes,
    // accessors/mutators, Livewire hooks) are invoked by the runtime.
    if (
      PHP_MAGIC_METHODS.includes(exportInfo.name) ||
      matchesPhpConventionalPattern(exportInfo.name)
    ) {
      return 'low';
    }
  }

  // --- Svelte patterns ---

  // `export let prop` in a .svelte file declares a component prop consumed by
  // the parent's markup, not a module export, so it is never import-tracked.
  if (filePath.endsWith('.svelte') && exportInfo.kind === 'variable') {
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
 * Checks if a named export appears as a shorthand property in the file's
 * default export object literal (e.g., export default { mediumRegular, largeBold })
 */
function isNamedExportInDefaultObject(filePath: string, exportName: string): boolean {
  const content = readSource(filePath);
  if (content === null) return false;

  const defaultExportMatch = content.match(/export\s+default\s+\{([^}]+)\}/);
  if (!defaultExportMatch) return false;

  const objectBody = defaultExportMatch[1];
  const props = objectBody.split(',').map((p) => p.trim());
  return props.some((p) => {
    const trimmed = p.trim();
    if (trimmed === exportName) return true;
    if (trimmed.startsWith(exportName + ':')) return true;
    return false;
  });
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
