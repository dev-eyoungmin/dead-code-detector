# PHP Support & Cross-Project Detection Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the detector produce meaningful results on real frontend/backend projects (entry points, barrels, reachability, SFCs, monorepos, CommonJS, performance) and add PHP as a first-class language.

**Architecture:** Keep the existing pipeline (scan → per-language `FileNode`s → one merged `DependencyGraph` → detectors) and fix it at the seams: one shared edge/usage builder with correct `export *` semantics, an entry-point reachability pass, a name-based member-usage pass for class-based languages, single-pass reference counting, multi-tsconfig program groups with an SFC-aware compiler host, and a regex-based PHP analyzer that mirrors the Java analyzer layout.

**Tech Stack:** TypeScript 5, TypeScript Compiler API (`ts.createProgram`, `CompilerHost`, `TypeChecker`), vitest 4, fast-glob, minimatch. Regex/line parsing for PHP.

**Spec:** `docs/superpowers/specs/2026-08-28-php-and-cross-project-accuracy-design.md`

## Global Constraints

- No git commits are made by the autonomous run (commit steps are replaced by "run the file's tests"); all work lands in the working tree on branch `feature/php-and-detection-accuracy`.
- `AnalysisResult`, reporters and UI shapes do not change.
- New risky detections ship at `low`/`medium` confidence: dead-cluster files/exports `low`, unused parameters `medium`, private properties / parameter properties `medium`, private methods `high`.
- Every `fs.readFileSync` of an analysed source file in `src/analyzer/**` goes through `readSource()` from `src/analyzer/sourceCache.ts`.
- Every extension test of the form `/\.(ts|tsx|js|jsx)$/` is replaced by `isTypeScriptFamily()` from `src/analyzer/languages/index.ts`.
- Code, comments, tests and docs in English. Tests use vitest with the existing style (`describe`/`it`, temp dirs via `fs.mkdtempSync`).
- Run a task's tests with `pnpm vitest run <file>`; the whole suite with `pnpm test`; `pnpm type-check` and `pnpm lint` must pass at the end of every task.

---

## File Map

| File | Responsibility | Task |
|---|---|---|
| `src/types/graph.ts` | `ImportInfo.isStarReExport`, `ImportInfo.globPattern`, `LocalSymbolInfo.isParameterProperty` | 1 |
| `src/types/language.ts` | `SupportedLanguage` += `'php'` | 1 |
| `src/analyzer/languages/index.ts` | extension map (`.mts .cts .mjs .cjs .vue .svelte .php`), `isTypeScriptFamily()`, `TS_FAMILY_EXTENSIONS` | 1, 15 |
| `src/analyzer/sourceCache.ts` (new) | memoised `readSource()` / `clearSourceCache()` | 1 |
| `src/analyzer/graphBuilder.ts` | the only edge/usage builder; star re-export, namespace-transitive, glob, container semantics | 2 |
| `src/analyzer/dependencyGraph.ts` | TS `FileNode` collection → `buildGraphFromFileNodes`; keys | 2, 8 |
| `src/analyzer/reachability.ts` (new) | BFS from entry points | 3 |
| `src/analyzer/memberUsage.ts` (new) | name-based member usage for Java/Go/PHP | 3 |
| `src/analyzer/unusedFileDetector.ts`, `unusedExportDetector.ts`, `unusedLocalDetector.ts` | reachability params, source cache, new confidence rules | 3, 6, 15 |
| `src/analyzer/index.ts` | orchestrator: cache clear, entry re-exports, reachability, member usage, single-pass internal refs, multi-program | 3, 8, 15 |
| `src/analyzer/importCollector.ts` | query strip, require destructuring, glob/template/worker/URL, `isStarReExport`, workspace realpath | 4 |
| `src/analyzer/exportCollector.ts` | CommonJS exports | 5 |
| `src/analyzer/localSymbolCollector.ts` | single-pass counting, nested scopes, private members, after-used params | 6 |
| `src/analyzer/entryPointResolver.ts` (new) | build→source mapping, package.json/scripts/workspaces/html/serverless entries | 7 |
| `src/analyzer/languages/typescriptAnalyzer.ts`, `frameworkDetector.ts` | use resolver; nuxt/sveltekit/angular.json configs | 7 |
| `src/analyzer/sfc.ts` (new) | `.vue`/`.svelte` script extraction, template reference counting | 8 |
| `src/analyzer/programFactory.ts` | `createPrograms()` groups by nearest tsconfig, SFC compiler host | 8 |
| `src/commands/runAnalysis.ts` (new), `analyzeProject.ts`, `analyzeCurrentFile.ts` | shared full-project run with all config | 9 |
| `src/config/configManager.ts`, `src/constants.ts`, `src/extension.ts`, `package.json`, `README.md`, `CHANGELOG.md` | wiring for php/dart/vue/svelte/new extensions | 9 |
| `src/analyzer/languages/php/phpSource.ts` (new) | comment/string stripping, brace matching | 10 |
| `src/analyzer/languages/php/phpModuleResolver.ts` (new) | namespace/use parsing, class index, composer autoload, include resolution | 10 |
| `src/analyzer/languages/php/phpExportCollector.ts` (new) | classes/functions/constants/public members | 11 |
| `src/analyzer/languages/php/phpImportCollector.ts` (new) | class references → resolved files + member specifiers | 12 |
| `src/analyzer/languages/php/phpLocalCollector.ts` (new) | private members, unused local variables | 13 |
| `src/analyzer/languages/php/phpFrameworkDetector.ts` (new) | Laravel/Symfony/WordPress entries + conventional exports | 14 |
| `src/analyzer/languages/php/phpAnalyzer.ts` (new), `decoratorDetector.ts` | `PhpAnalyzer`, PHP DI attributes, registration | 15 |
| `test/fixtures/{php-laravel-project,sfc-project,monorepo-project,cjs-project,barrel-project}` | integration fixtures | 15, 16 |
| `test/integration/accuracy.test.ts` (new) | end-to-end assertions per fixture | 16 |

## Execution order

```
Wave 1 (parallel):  T1 (foundation, do first, tiny) → T2 · T4 · T5 · T6 · T7 · T10
Wave 2 (parallel):  T3 (needs T2,T4) · T11+T12+T13+T14 (need T10)
Wave 3 (parallel):  T8 (needs T3,T6) · T9 (needs T7)
Wave 4:             T15 (needs T8, T11-14) → T16 (needs everything)
```

Files touched by more than one task (`analyzer/index.ts`: T3, T8, T15; `unusedExportDetector.ts`: T3, T15; `dependencyGraph.ts`: T2, T8) are only edited by one task per wave.

---

### Task 1: Foundation types, extension map, source cache

**Files:**
- Modify: `src/types/graph.ts`, `src/types/language.ts`, `src/analyzer/languages/index.ts`, `src/constants.ts`
- Create: `src/analyzer/sourceCache.ts`
- Test: `test/unit/analyzer/sourceCache.test.ts`, `test/unit/analyzer/languages/languageRegistry.test.ts`

**Interfaces:**
- Produces: `ImportInfo.isStarReExport?: boolean`, `ImportInfo.globPattern?: string`, `LocalSymbolInfo.isParameterProperty?: boolean`; `SupportedLanguage` includes `'php'`; `TS_FAMILY_EXTENSIONS`, `isTypeScriptFamily(filePath: string): boolean`, `detectLanguage()` maps `.mts .cts .mjs .cjs .vue .svelte → 'typescript'`, `.php → 'php'`; `readSource(filePath: string): string | null`, `clearSourceCache(): void`.

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/analyzer/sourceCache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { readSource, clearSourceCache } from '../../../src/analyzer/sourceCache';

describe('sourceCache', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')); clearSourceCache(); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads a file and memoises it until cleared', () => {
    const f = path.join(dir, 'a.ts'); fs.writeFileSync(f, 'one');
    expect(readSource(f)).toBe('one');
    fs.writeFileSync(f, 'two');
    expect(readSource(f)).toBe('one');
    clearSourceCache();
    expect(readSource(f)).toBe('two');
  });
  it('returns null for missing files', () => {
    expect(readSource(path.join(dir, 'missing.ts'))).toBeNull();
  });
});
```

```ts
// test/unit/analyzer/languages/languageRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { detectLanguage, isTypeScriptFamily } from '../../../../src/analyzer/languages';

describe('language registry', () => {
  it.each(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.vue', '.svelte'])('maps %s to typescript', (ext) => {
    expect(detectLanguage(`/p/file${ext}`)).toBe('typescript');
    expect(isTypeScriptFamily(`/p/file${ext}`)).toBe(true);
  });
  it('maps .php to php', () => { expect(detectLanguage('/p/a.php')).toBe('php'); expect(isTypeScriptFamily('/p/a.php')).toBe(false); });
});
```

- [ ] **Step 2: Run them, expect failures** — `pnpm vitest run test/unit/analyzer/sourceCache.test.ts test/unit/analyzer/languages/languageRegistry.test.ts`

- [ ] **Step 3: Implement**

`src/analyzer/sourceCache.ts`:
```ts
import * as fs from 'fs';
const cache = new Map<string, string | null>();
/** Reads a source file once per analysis run. Returns null when unreadable. */
export function readSource(filePath: string): string | null {
  if (cache.has(filePath)) return cache.get(filePath)!;
  let content: string | null;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { content = null; }
  cache.set(filePath, content);
  return content;
}
export function clearSourceCache(): void { cache.clear(); }
```

`src/types/graph.ts` — add to `ImportInfo`:
```ts
  /** True for `export * from` / `export * as X from` (edge only; marks no export used) */
  isStarReExport?: boolean;
  /** Absolute minimatch pattern for glob-like imports (template-literal import(), import.meta.glob, require.context) */
  globPattern?: string;
```
and to `LocalSymbolInfo`: `isParameterProperty?: boolean;`

`src/types/language.ts`: `export type SupportedLanguage = 'typescript' | 'python' | 'go' | 'java' | 'dart' | 'php';`

`src/analyzer/languages/index.ts`: replace the map with
```ts
export const TS_FAMILY_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.vue', '.svelte'];
const extensionToLanguage = new Map<string, SupportedLanguage>([
  ...TS_FAMILY_EXTENSIONS.map((e) => [e, 'typescript'] as [string, SupportedLanguage]),
  ['.py', 'python'], ['.go', 'go'], ['.java', 'java'], ['.dart', 'dart'], ['.php', 'php'],
]);
export function isTypeScriptFamily(filePath: string): boolean {
  return TS_FAMILY_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}
```
(`PhpAnalyzer` registration happens in Task 15; leave `ensureInitialized` as is.)

`src/constants.ts` `DEFAULT_INCLUDE_PATTERNS`: add `'**/*.mts', '**/*.cts', '**/*.mjs', '**/*.cjs', '**/*.vue', '**/*.svelte', '**/*.dart', '**/*.php'`. `DEFAULT_EXCLUDE_PATTERNS`: add `'**/*Test.php', '**/*.spec.php', '**/tests/**', '**/.claude/**', '**/coverage/**', '**/.next/**', '**/.nuxt/**', '**/.output/**', '**/.svelte-kit/**'`.

`src/analyzer/languages/typescriptAnalyzer.ts`: `readonly extensions = TS_FAMILY_EXTENSIONS;`

- [ ] **Step 4: Run the two tests + `pnpm type-check`** — expect PASS.

---

### Task 2: Unified graph builder with correct `export *` semantics

**Files:**
- Modify: `src/analyzer/graphBuilder.ts`, `src/analyzer/dependencyGraph.ts`
- Test: `test/unit/analyzer/graphBuilder.test.ts` (new), `test/unit/analyzer/dependencyGraph.test.ts` (keep passing)

**Interfaces:**
- Consumes: `ImportInfo.isStarReExport`, `ImportInfo.globPattern` (Task 1). Task 4 will set `isStarReExport` on `export *` imports; until then this task's own tests build `FileNode`s by hand.
- Produces: `buildGraphFromFileNodes(fileMap: Map<string, FileNode>, options?: GraphBuildOptions): DependencyGraph`, `interface GraphBuildOptions { containerFilePaths?: Set<string> }`, `markAllExportsUsed(graph: DependencyGraph, targetPath: string, byFile: string): void` (exported; follows star chains), `resolveStarReExport(...)` moved here and exported. `buildDependencyGraph(files, program, userDecorators = [], containerFilePaths = new Set(), rootDir?: string)` keeps its signature (adds optional `rootDir`, forwarded to `collectImports` — Task 4 adds the parameter; until then pass it and ignore).

- [ ] **Step 1: Write failing tests** (`test/unit/analyzer/graphBuilder.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import type { FileNode, ImportInfo, ExportInfo } from '../../../src/types';
import { buildGraphFromFileNodes, markAllExportsUsed } from '../../../src/analyzer/graphBuilder';
import { makeExportKey } from '../../../src/analyzer/dependencyGraph';

const exp = (name: string, extra: Partial<ExportInfo> = {}): ExportInfo =>
  ({ name, isDefault: false, isReExport: false, line: 1, column: 0, kind: 'variable', isTypeOnly: false, ...extra });
const imp = (resolvedPath: string, names: string[], extra: Partial<ImportInfo> = {}): ImportInfo => ({
  source: resolvedPath, resolvedPath, isNamespaceImport: false, isDynamicImport: false, isTypeOnly: false,
  specifiers: names.map((n) => ({ name: n, isDefault: n === 'default', isNamespace: n === '*' })), ...extra,
});
const node = (filePath: string, imports: ImportInfo[], exports: ExportInfo[]): FileNode => ({ filePath, imports, exports, locals: [] });
const usages = (g: ReturnType<typeof buildGraphFromFileNodes>, f: string, n: string) => g.exportUsages.get(makeExportKey(f, n))?.size ?? 0;

describe('buildGraphFromFileNodes', () => {
  const A = '/p/a.ts', B = '/p/barrel.ts', X = '/p/x.ts', Y = '/p/y.ts';

  it('export * creates an edge but marks no export used', () => {
    const fm = new Map([
      [B, node(B, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('*', { isReExport: true, reExportSource: X })])],
      [X, node(X, [], [exp('deadA'), exp('deadB')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(g.inboundEdges.get(X)?.has(B)).toBe(true);
    expect(usages(g, X, 'deadA')).toBe(0);
    expect(usages(g, X, 'deadB')).toBe(0);
  });

  it('named import through a star chain marks only that export used', () => {
    const fm = new Map([
      [A, node(A, [imp(B, ['used'])], [])],
      [B, node(B, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('*', { isReExport: true, reExportSource: X })])],
      [X, node(X, [], [exp('used'), exp('dead')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(usages(g, X, 'used')).toBe(1);
    expect(usages(g, X, 'dead')).toBe(0);
  });

  it('namespace import of a barrel propagates through star re-exports', () => {
    const fm = new Map([
      [A, node(A, [imp(B, ['*'], { isNamespaceImport: true })], [])],
      [B, node(B, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('*', { isReExport: true, reExportSource: X })])],
      [X, node(X, [imp(Y, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('a'), exp('*', { isReExport: true, reExportSource: Y })])],
      [Y, node(Y, [], [exp('deep')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(usages(g, X, 'a')).toBe(1);
    expect(usages(g, Y, 'deep')).toBe(1);
  });

  it('glob imports add edges and namespace usage to every matching file', () => {
    const fm = new Map([
      [A, node(A, [{ ...imp('/p/locales', []), globPattern: '/p/locales/**' }], [])],
      ['/p/locales/en.ts', node('/p/locales/en.ts', [], [exp('default', { isDefault: true })])],
      ['/p/other.ts', node('/p/other.ts', [], [exp('o')])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    expect(g.inboundEdges.get('/p/locales/en.ts')?.has(A)).toBe(true);
    expect(usages(g, '/p/locales/en.ts', 'default')).toBe(1);
    expect(usages(g, '/p/other.ts', 'o')).toBe(0);
  });

  it('container files mark all exports of everything they import as used', () => {
    const fm = new Map([
      [A, node(A, [imp(X, ['deadA'])], [])],
      [X, node(X, [], [exp('deadA'), exp('deadB')])],
    ]);
    const g = buildGraphFromFileNodes(fm, { containerFilePaths: new Set([A]) });
    expect(usages(g, X, 'deadB')).toBe(1);
  });

  it('markAllExportsUsed is idempotent on cycles', () => {
    const fm = new Map([
      [X, node(X, [imp(Y, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('x'), exp('*', { isReExport: true, reExportSource: Y })])],
      [Y, node(Y, [imp(X, ['*'], { isNamespaceImport: true, isStarReExport: true })], [exp('y'), exp('*', { isReExport: true, reExportSource: X })])],
    ]);
    const g = buildGraphFromFileNodes(fm);
    markAllExportsUsed(g, X, A);
    expect(usages(g, X, 'x')).toBe(1);
    expect(usages(g, Y, 'y')).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm vitest run test/unit/analyzer/graphBuilder.test.ts`

- [ ] **Step 3: Implement `graphBuilder.ts`**

```ts
import { minimatch } from 'minimatch';
import type { DependencyGraph, FileNode } from '../types';
import { makeExportKey } from './dependencyGraph';

export interface GraphBuildOptions {
  /** Absolute paths of DI container files: every import in them counts as a namespace import */
  containerFilePaths?: Set<string>;
}

export function buildGraphFromFileNodes(fileMap: Map<string, FileNode>, options: GraphBuildOptions = {}): DependencyGraph {
  const containerFiles = options.containerFilePaths ?? new Set<string>();
  const graph: DependencyGraph = { files: fileMap, inboundEdges: new Map(), outboundEdges: new Map(), exportUsages: new Map() };
  for (const [filePath, fileNode] of fileMap) {
    graph.inboundEdges.set(filePath, new Set());
    graph.outboundEdges.set(filePath, new Set());
    for (const exp of fileNode.exports) graph.exportUsages.set(makeExportKey(filePath, exp.name), new Set());
  }
  const allPaths = Array.from(fileMap.keys());

  for (const [filePath, fileNode] of fileMap) {
    const isContainer = containerFiles.has(filePath);
    for (const importInfo of fileNode.imports) {
      const targets = importInfo.globPattern
        ? allPaths.filter((p) => minimatch(p, importInfo.globPattern!, { dot: true }))
        : fileMap.has(importInfo.resolvedPath) ? [importInfo.resolvedPath] : [];
      for (const target of targets) {
        graph.outboundEdges.get(filePath)!.add(target);
        graph.inboundEdges.get(target)!.add(filePath);
        if (importInfo.isStarReExport && !isContainer) continue; // edge only
        if (importInfo.globPattern || importInfo.isNamespaceImport || isContainer) {
          markAllExportsUsed(graph, target, filePath);
          continue;
        }
        for (const spec of importInfo.specifiers) {
          const direct = graph.exportUsages.get(makeExportKey(target, spec.name));
          if (direct) { direct.add(filePath); continue; }
          const viaStar = resolveStarReExport(target, spec.name, fileMap, graph.exportUsages);
          if (viaStar) viaStar.add(filePath);
        }
      }
    }
  }
  return graph;
}

/** Marks every export of `targetPath` used by `byFile`, following `export *` chains transitively. */
export function markAllExportsUsed(graph: DependencyGraph, targetPath: string, byFile: string, visited = new Set<string>()): void {
  if (visited.has(targetPath)) return;
  visited.add(targetPath);
  const node = graph.files.get(targetPath);
  if (!node) return;
  for (const exp of node.exports) {
    const usages = graph.exportUsages.get(makeExportKey(targetPath, exp.name));
    if (usages) usages.add(byFile);
    if (exp.name === '*' && exp.isReExport && exp.reExportSource) {
      const next = resolveReExportTarget(node, exp.reExportSource, graph.files);
      if (next) markAllExportsUsed(graph, next, byFile, visited);
    }
  }
}

function resolveReExportTarget(node: FileNode, reExportSource: string, fileMap: Map<string, FileNode>): string | undefined {
  if (fileMap.has(reExportSource)) return reExportSource;
  const imp = node.imports.find((i) => (i.source === reExportSource || i.resolvedPath === reExportSource) && fileMap.has(i.resolvedPath));
  return imp?.resolvedPath;
}

/** Resolves a named import through `export *` chains to the owning export's usage set. */
export function resolveStarReExport(filePath: string, exportName: string, fileMap: Map<string, FileNode>,
  exportUsages: Map<string, Set<string>>, visited: Set<string> = new Set()): Set<string> | undefined {
  if (visited.has(filePath)) return undefined;
  visited.add(filePath);
  const file = fileMap.get(filePath);
  if (!file) return undefined;
  for (const exp of file.exports) {
    if (exp.name !== '*' || !exp.isReExport || !exp.reExportSource) continue;
    const next = resolveReExportTarget(file, exp.reExportSource, fileMap);
    if (!next) continue;
    const direct = exportUsages.get(makeExportKey(next, exportName));
    if (direct) return direct;
    const deeper = resolveStarReExport(next, exportName, fileMap, exportUsages, visited);
    if (deeper) return deeper;
  }
  return undefined;
}
```
Keep `createEmptyGraph` and `mergeGraphInto` unchanged.

`dependencyGraph.ts`: delete its second pass and `resolveStarReExport`; `buildDependencyGraph` now collects `FileNode`s (imports/exports/locals as today, passing `rootDir` to `collectImports(sourceFile, program, rootDir)` — Task 4 adds that parameter; add it to the call now and to `collectImports`' signature as an unused optional param if Task 4 hasn't landed) and returns `buildGraphFromFileNodes(fileMap, { containerFilePaths })`. Keep `makeExportKey`/`parseExportKey`.

- [ ] **Step 4: Run** `pnpm vitest run test/unit/analyzer/graphBuilder.test.ts test/unit/analyzer/dependencyGraph.test.ts test/unit/analyzer/reExportPropagation.test.ts test/integration` — all PASS (the `export * from` tests in `dependencyGraph.test.ts` still pass because `collectImports` marks `export *` as a namespace import until Task 4 flips it; after Task 4 the tests still pass via `resolveStarReExport`).

---

### Task 3: Reachability, entry re-exports, member-name usage, single-pass internal refs

**Files:**
- Create: `src/analyzer/reachability.ts`, `src/analyzer/memberUsage.ts`
- Modify: `src/analyzer/index.ts`, `src/analyzer/unusedFileDetector.ts`, `src/analyzer/unusedExportDetector.ts`, `src/analyzer/unusedLocalDetector.ts`, `src/analyzer/frameworkDetector.ts` (`findDIContainerFiles` → `readSource`)
- Test: `test/unit/analyzer/reachability.test.ts`, `test/unit/analyzer/memberUsage.test.ts`, `test/unit/analyzer/deadCluster.test.ts`

**Interfaces:**
- Consumes: Task 2 `markAllExportsUsed`; Task 1 `readSource`, `isTypeScriptFamily`.
- Produces: `computeReachable(graph: DependencyGraph, entryPoints: string[]): Set<string>`; `applyMemberNameUsage(graph: DependencyGraph): void` and `MEMBER_USAGE_SENTINEL = '<member-usage>'`; `detectUnusedFiles(graph, entryPoints, reachable?: Set<string>)`; `detectUnusedExports(graph, entryPoints, frameworkExports = [], alwaysUsedPatterns = [], reachable?: Set<string>)`; in `index.ts`: `markEntryPointReExports(graph, entryPoints)` (module-private), `analyzeInternalReferences(graph, programs: ts.Program[])`.

- [ ] **Step 1: Failing tests**

```ts
// test/unit/analyzer/reachability.test.ts
import { describe, it, expect } from 'vitest';
import { computeReachable } from '../../../src/analyzer/reachability';
import { createEmptyGraph } from '../../../src/analyzer/graphBuilder';

function graphWithEdges(edges: Array<[string, string]>) {
  const g = createEmptyGraph();
  for (const [from, to] of edges) {
    for (const f of [from, to]) { if (!g.files.has(f)) g.files.set(f, { filePath: f, imports: [], exports: [], locals: [] }); g.inboundEdges.set(f, g.inboundEdges.get(f) ?? new Set()); g.outboundEdges.set(f, g.outboundEdges.get(f) ?? new Set()); }
    g.outboundEdges.get(from)!.add(to); g.inboundEdges.get(to)!.add(from);
  }
  return g;
}
describe('computeReachable', () => {
  it('returns the transitive closure from entry points', () => {
    const g = graphWithEdges([['/e.ts', '/a.ts'], ['/a.ts', '/b.ts'], ['/c.ts', '/d.ts'], ['/d.ts', '/c.ts']]);
    const r = computeReachable(g, ['/e.ts']);
    expect([...r].sort()).toEqual(['/a.ts', '/b.ts', '/e.ts']);
  });
  it('returns an empty set when there are no entry points', () => {
    expect(computeReachable(graphWithEdges([['/a.ts', '/b.ts']]), []).size).toBe(0);
  });
});
```

```ts
// test/unit/analyzer/memberUsage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { applyMemberNameUsage, MEMBER_USAGE_SENTINEL } from '../../../src/analyzer/memberUsage';
import { buildGraphFromFileNodes } from '../../../src/analyzer/graphBuilder';
import { makeExportKey } from '../../../src/analyzer/dependencyGraph';
import { clearSourceCache } from '../../../src/analyzer/sourceCache';
import type { FileNode } from '../../../src/types';

describe('applyMemberNameUsage', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-')); clearSourceCache(); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const node = (filePath: string, exports: Array<{ name: string; kind: string }>): FileNode =>
    ({ filePath, imports: [], locals: [], exports: exports.map((e) => ({ ...e, isDefault: false, isReExport: false, line: 1, column: 0, isTypeOnly: false })) });

  it('marks a Java public method used when another file calls it by name', () => {
    const helper = path.join(dir, 'StringHelper.java'); const main = path.join(dir, 'Main.java');
    fs.writeFileSync(helper, 'public class StringHelper { public String capitalize(String s) {} public String unused() {} public static final String APP_NAME = "x"; }');
    fs.writeFileSync(main, 'public class Main { void run() { new StringHelper().capitalize("a"); System.out.println(StringHelper.APP_NAME); } }');
    const g = buildGraphFromFileNodes(new Map([[helper, node(helper, [{ name: 'StringHelper', kind: 'class' }, { name: 'capitalize', kind: 'method' }, { name: 'unused', kind: 'method' }, { name: 'APP_NAME', kind: 'constant' }])], [main, node(main, [])]]));
    applyMemberNameUsage(g);
    expect(g.exportUsages.get(makeExportKey(helper, 'capitalize'))?.has(MEMBER_USAGE_SENTINEL)).toBe(true);
    expect(g.exportUsages.get(makeExportKey(helper, 'APP_NAME'))?.has(MEMBER_USAGE_SENTINEL)).toBe(true);
    expect(g.exportUsages.get(makeExportKey(helper, 'unused'))?.size).toBe(0);
    expect(g.exportUsages.get(makeExportKey(helper, 'StringHelper'))?.size).toBe(0); // classes are not members
  });

  it('does not count same-file references and ignores TypeScript files', () => {
    const svc = path.join(dir, 'Svc.php'); const ts = path.join(dir, 'a.ts');
    fs.writeFileSync(svc, '<?php class Svc { public function a() { $this->b(); } public function b() {} }');
    fs.writeFileSync(ts, 'export const b = 1; obj.b();');
    const g = buildGraphFromFileNodes(new Map([[svc, node(svc, [{ name: 'a', kind: 'method' }, { name: 'b', kind: 'method' }])], [ts, node(ts, [{ name: 'b', kind: 'variable' }])]]));
    applyMemberNameUsage(g);
    expect(g.exportUsages.get(makeExportKey(svc, 'b'))?.size).toBe(0);
    expect(g.exportUsages.get(makeExportKey(ts, 'b'))?.size).toBe(0);
  });

  it('counts PHP callable strings ([Foo::class, "index"], "Foo@index", add_action)', () => {
    const ctl = path.join(dir, 'Ctl.php'); const routes = path.join(dir, 'routes.php');
    fs.writeFileSync(ctl, '<?php class Ctl { public function index() {} public function show() {} public function hook() {} }');
    fs.writeFileSync(routes, "<?php Route::get('/', [Ctl::class, 'index']); Route::get('/s', 'Ctl@show'); add_action('init', 'hook');");
    const g = buildGraphFromFileNodes(new Map([[ctl, node(ctl, [{ name: 'index', kind: 'method' }, { name: 'show', kind: 'method' }, { name: 'hook', kind: 'method' }])], [routes, node(routes, [])]]));
    applyMemberNameUsage(g);
    for (const n of ['index', 'show', 'hook']) expect(g.exportUsages.get(makeExportKey(ctl, n))?.size).toBe(1);
  });
});
```

```ts
// test/unit/analyzer/deadCluster.test.ts  (end-to-end through analyze())
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { analyze } from '../../../src/analyzer';

describe('dead cluster detection', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = (n: string, c: string) => { const p = path.join(dir, n); fs.writeFileSync(p, c); return p; };

  it('reports mutually-importing files unreachable from the entry point at low confidence', async () => {
    const entry = w('index.ts', "import { used } from './used'; console.log(used);");
    const used = w('used.ts', 'export const used = 1;');
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; export const useA = () => a;");
    const r = await analyze({ files: [entry, used, a, b], rootDir: dir, entryPoints: [entry] });
    const files = r.unusedFiles.map((f) => [path.basename(f.filePath), f.confidence]);
    expect(files).toContainEqual(['a.ts', 'low']);
    expect(files).toContainEqual(['b.ts', 'low']);
    expect(files.map((f) => f[0])).not.toContain('used.ts');
    const exps = r.unusedExports.map((e) => [e.exportName, e.confidence]);
    expect(exps).toContainEqual(['a', 'low']);
    expect(exps).toContainEqual(['b', 'low']);
  });

  it('keeps today\'s behaviour when there are no entry points', async () => {
    const a = w('a.ts', "import { b } from './b'; export const a = b;");
    const b = w('b.ts', "import { a } from './a'; export const b = 1; console.log(a);");
    const r = await analyze({ files: [a, b], rootDir: dir, entryPoints: [] });
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('treats star re-exports from an entry point as public API', async () => {
    const entry = w('index.ts', "export * from './api';");
    const api = w('api.ts', 'export const publicFn = 1;');
    const r = await analyze({ files: [entry, api], rootDir: dir, entryPoints: [entry] });
    expect(r.unusedExports.map((e) => e.exportName)).not.toContain('publicFn');
    expect(r.unusedFiles).toHaveLength(0);
  });

  it('does not mark star re-export targets used without a consumer', async () => {
    const entry = w('index.ts', "import { used } from './barrel'; console.log(used);");
    const barrel = w('barrel.ts', "export * from './star'; export { used } from './named';");
    const star = w('star.ts', 'export const starDead = 1;');
    const named = w('named.ts', 'export const used = 1; export const alsoDead = 2;');
    const r = await analyze({ files: [entry, barrel, star, named], rootDir: dir, entryPoints: [entry] });
    const names = r.unusedExports.map((e) => e.exportName);
    expect(names).toContain('starDead');
    expect(names).toContain('alsoDead');
    expect(names).not.toContain('used');
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

`reachability.ts`:
```ts
import type { DependencyGraph } from '../types';
export function computeReachable(graph: DependencyGraph, entryPoints: string[]): Set<string> {
  const reachable = new Set<string>();
  const stack = entryPoints.filter((e) => graph.files.has(e));
  while (stack.length) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const next of graph.outboundEdges.get(cur) ?? []) if (!reachable.has(next)) stack.push(next);
  }
  return reachable;
}
```

`memberUsage.ts`:
```ts
import * as path from 'path';
import type { DependencyGraph } from '../types';
import { makeExportKey } from './dependencyGraph';
import { readSource } from './sourceCache';
import { detectLanguage } from './languages';

export const MEMBER_USAGE_SENTINEL = '<member-usage>';
const MEMBER_KINDS = new Set(['method', 'constant', 'variable']);
const MEMBER_TOKEN = /(?:->|::|\.)\s*([A-Za-z_]\w*)/g;
const PHP_CALLABLE_ARRAY = /\[\s*(?:[\w\\]+::class|\$this|self::class|static::class)\s*,\s*['"]([A-Za-z_]\w*)['"]\s*\]/g;
const PHP_AT_STRING = /['"][A-Za-z_\\]\w*@([A-Za-z_]\w*)['"]/g;
const PHP_HOOK_CALL = /\b(?:add_action|add_filter|register_activation_hook|register_deactivation_hook|call_user_func|call_user_func_array|array_map|usort|uasort|array_filter|array_walk)\s*\([^)]*?['"]([A-Za-z_]\w*)['"]/g;

/** Marks member-like exports (methods/constants/fields) of non-TS files used when another file of the same language references the name. */
export function applyMemberNameUsage(graph: DependencyGraph): void {
  const tokensByFile = new Map<string, Set<string>>();
  const filesByLang = new Map<string, string[]>();
  for (const filePath of graph.files.keys()) {
    const lang = detectLanguage(filePath);
    if (!lang || lang === 'typescript') continue;
    (filesByLang.get(lang) ?? filesByLang.set(lang, []).get(lang)!).push(filePath);
    const src = readSource(filePath); if (src === null) continue;
    const set = new Set<string>();
    for (const re of [MEMBER_TOKEN, ...(path.extname(filePath) === '.php' ? [PHP_CALLABLE_ARRAY, PHP_AT_STRING, PHP_HOOK_CALL] : [])]) {
      re.lastIndex = 0; let m: RegExpExecArray | null;
      while ((m = re.exec(src))) set.add(m[1]);
    }
    tokensByFile.set(filePath, set);
  }
  for (const [, files] of filesByLang) {
    const union = new Map<string, number>(); // token -> number of files containing it
    for (const f of files) for (const t of tokensByFile.get(f) ?? []) union.set(t, (union.get(t) ?? 0) + 1);
    for (const f of files) {
      const own = tokensByFile.get(f) ?? new Set();
      for (const exp of graph.files.get(f)!.exports) {
        if (!MEMBER_KINDS.has(exp.kind)) continue;
        const key = makeExportKey(f, exp.name);
        const usages = graph.exportUsages.get(key);
        if (!usages || usages.size > 0) continue;
        const total = union.get(exp.name) ?? 0;
        const elsewhere = total - (own.has(exp.name) ? 1 : 0);
        if (elsewhere > 0) usages.add(MEMBER_USAGE_SENTINEL);
      }
    }
  }
}
```

`unusedFileDetector.ts`: signature `detectUnusedFiles(graph, entryPoints, reachable?: Set<string>)`. Use `readSource`. After the existing zero-inbound branch add:
```ts
    } else if (reachable && !reachable.has(filePath)) {
      const source = readSource(filePath);
      if (source && hasFileIgnoreComment(source)) continue;
      unusedFiles.push({ filePath, confidence: 'low', reason: 'Not reachable from any entry point (imported only by unreachable files)' });
    }
```

`unusedExportDetector.ts`: signature adds trailing `reachable?: Set<string>`. Replace `const usageCount = usages?.size || 0;` with
```ts
      const users = usages ? Array.from(usages) : [];
      const liveUsers = reachable ? users.filter((u) => u === MEMBER_USAGE_SENTINEL || reachable.has(u) || u === filePath) : users;
      const usageCount = liveUsers.length;
      const onlyDeadUsers = users.length > 0 && usageCount === 0;
```
and when `onlyDeadUsers` is true push the result with `confidence: 'low'` (skip the decorator/alwaysUsed/determineConfidence branches). Replace `fs.readFileSync` with `readSource` (drop the local `sourceCache` map). Same in `unusedLocalDetector.ts`, `isNamedExportInDefaultObject`, and `frameworkDetector.findDIContainerFiles`.

`index.ts` changes:
1. First line of `analyze()`: `clearSourceCache();`
2. Track programs: `const tsPrograms: ts.Program[] = [];` push each created program (Task 8 replaces `createProgram` with `createPrograms`; for now push the single program).
3. After `applyContainerFileRules` and before `propagateReExportUsage`: `markEntryPointReExports(mergedGraph, allEntryPoints)` — move the `toolingEntries`/`allEntryPoints` computation above the graph passes. Then `propagateReExportUsage`, `analyzeInternalReferences(mergedGraph, tsPrograms)`, `markInternalReferencesRegex`, `applyMemberNameUsage(mergedGraph)`.
4. `const reachable = allEntryPoints.length > 0 ? computeReachable(mergedGraph, allEntryPoints) : undefined;` and pass it to both detectors.
5. `markEntryPointReExports`:
```ts
function markEntryPointReExports(graph: DependencyGraph, entryPoints: string[]): void {
  for (const entry of entryPoints) {
    const node = graph.files.get(entry); if (!node) continue;
    for (const exp of node.exports) {
      if (!exp.isReExport || !exp.reExportSource) continue;
      const target = graph.files.has(exp.reExportSource) ? exp.reExportSource
        : node.imports.find((i) => (i.source === exp.reExportSource || i.resolvedPath === exp.reExportSource) && graph.files.has(i.resolvedPath))?.resolvedPath;
      if (!target) continue;
      if (exp.name === '*') { markAllExportsUsed(graph, target, entry); continue; }
      const key = makeExportKey(target, exp.originalName || exp.name);
      const usages = graph.exportUsages.get(key) ?? resolveStarReExport(target, exp.originalName || exp.name, graph.files, graph.exportUsages);
      if (usages) usages.add(entry);
    }
  }
}
```
6. `analyzeInternalReferences(graph, programs)`: for each TS-family file (`isTypeScriptFamily`), find the program containing it (`programs.find(p => p.getSourceFile(filePath))`), compute `exportedSymbols: Map<ts.Symbol, string>` from `findSymbolByName` for exports without usages, then a **single** walk of the source file counting identifiers whose symbol is in the map and whose parent is not the declaration name site (reuse the existing `isDecl` check). Delete `countNonDeclarationReferences`.
7. `markInternalReferencesRegex`: skip `isTypeScriptFamily` files; `stripCommentsAndStrings` additionally removes `#` line comments **not followed by `[`** for `.py`/`.php` (`content.replace(/#(?!\[).*$/gm, '')`).

- [ ] **Step 4: Run** the three new test files, `test/integration`, `test/unit/analyzer/analyzer.test.ts`, then `pnpm type-check && pnpm lint`.

---

### Task 4: TypeScript import collector

**Files:**
- Modify: `src/analyzer/importCollector.ts`
- Test: `test/unit/analyzer/importCollector.test.ts` (extend)

**Interfaces:**
- Produces: `collectImports(sourceFile: ts.SourceFile, program: ts.Program, rootDir?: string): ImportInfo[]`; `export * from` imports carry `isStarReExport: true` (still `isNamespaceImport: true` for backward compatibility); glob-style imports carry `globPattern`; specifiers with `?query`/`#hash` are resolved without the suffix.

- [ ] **Step 1: Failing tests** — append to the existing describe block (temp dir + `ts.createProgram` helper as in the existing file):

```ts
describe('collectImports - modern patterns', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (rel: string, c: string) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
  const collect = (entry: string, files: string[]) => {
    const program = ts.createProgram(files, { allowJs: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, moduleResolution: ts.ModuleResolutionKind.NodeJs });
    return collectImports(program.getSourceFile(entry)!, program, dir);
  };

  it('flags export * from as a star re-export', () => {
    const x = write('x.ts', 'export const a = 1;'); const b = write('barrel.ts', "export * from './x'; export * as ns from './x';");
    const imps = collect(b, [b, x]);
    expect(imps).toHaveLength(2);
    expect(imps.every((i) => i.isStarReExport && i.resolvedPath === x)).toBe(true);
  });
  it('strips ?query and #hash from specifiers (Vite ?worker, ?raw)', () => {
    const w = write('w.ts', 'export {}'); const a = write('a.ts', "import W from './w?worker'; import raw from './w?raw'; import h from './w#frag';");
    expect(collect(a, [a, w]).map((i) => i.resolvedPath)).toEqual([w, w, w]);
  });
  it('collects destructured require as named specifiers', () => {
    const x = write('x.js', 'module.exports = { a: 1, b: 2 };'); const a = write('a.js', "const { a, b: renamed } = require('./x'); const whole = require('./x');");
    const imps = collect(a, [a, x]);
    expect(imps[0].specifiers.map((s) => s.name)).toEqual(['a', 'b']);
    expect(imps[0].isNamespaceImport).toBe(false);
    expect(imps[1].isNamespaceImport).toBe(true);
  });
  it('turns template-literal and concatenated dynamic imports into directory globs', () => {
    write('locales/en.ts', 'export default 1');
    const a = write('a.ts', 'export const l = (x: string) => import(`./locales/${x}`); export const m = (x: string) => import("./locales/" + x + ".ts");');
    const imps = collect(a, [a]);
    expect(imps).toHaveLength(2);
    expect(imps[0].globPattern).toBe(path.join(dir, 'locales') + '/**');
    expect(imps[1].globPattern).toBe(path.join(dir, 'locales') + '/**');
  });
  it('turns import.meta.glob and require.context into globs', () => {
    write('mods/a.ts', 'export default 1');
    const a = write('a.ts', "const m = import.meta.glob('./mods/*.ts'); const c = require.context('./mods', true, /\\.ts$/);");
    const imps = collect(a, [a]);
    expect(imps[0].globPattern).toBe(path.join(dir, 'mods', '*.ts'));
    expect(imps[1].globPattern).toBe(path.join(dir, 'mods') + '/**');
  });
  it('collects Worker / new URL(import.meta.url) targets as namespace imports', () => {
    const w = write('w.ts', 'self.onmessage = () => {};');
    const a = write('a.ts', "new Worker(new URL('./w.ts', import.meta.url)); new SharedWorker('./w.ts'); const u = new URL('./w.ts', import.meta.url);");
    const imps = collect(a, [a, w]);
    expect(imps).toHaveLength(3);
    expect(imps.every((i) => i.resolvedPath === w && i.isNamespaceImport)).toBe(true);
  });
  it('resolves symlinked workspace packages inside rootDir as internal', () => {
    const pkg = write('packages/lib/index.ts', 'export const lib = 1;');
    fs.writeFileSync(path.join(dir, 'packages/lib/package.json'), '{"name":"@ws/lib","main":"index.ts"}');
    fs.mkdirSync(path.join(dir, 'node_modules/@ws'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'packages/lib'), path.join(dir, 'node_modules/@ws/lib'), 'dir');
    const a = write('app/a.ts', "import { lib } from '@ws/lib';");
    expect(collect(a, [a, pkg])[0].resolvedPath).toBe(pkg);
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** in `importCollector.ts`:
- `collectImports(sourceFile, program, rootDir?)`; pass `rootDir` to `resolveImportPath(importPath, fileDir, program, rootDir)`.
- `resolveImportPath`: first `const clean = importPath.replace(/[?#].*$/, '')` and use `clean` everywhere below. When `resolved.resolvedModule.isExternalLibraryImport`: `const real = safeRealpath(resolvedFileName); if (rootDir && real.startsWith(rootDir + path.sep) && !real.split(path.sep).includes('node_modules')) return path.normalize(real);` else return `importPath`.
- In the `ExportDeclaration` branch: when there is no named export clause (`export *` / `export * as`), set `isStarReExport: true` (keep `isNamespaceImport: true`).
- `require` branch: inspect `node.parent`: if it is a `VariableDeclaration` whose `name` is an `ObjectBindingPattern`, specifiers = each element's `propertyName?.text ?? name.text`, `isNamespaceImport: false`; otherwise unchanged.
- Dynamic import branch: if the argument is a `TemplateExpression` or a `BinaryExpression` with `+`, compute the static prefix: for template, `arg.head.text`; for binary, walk the left-most operand chain while it is a string literal / template head. Then `globFromPrefix(prefix, fileDir)`: `const abs = path.resolve(fileDir, prefix)`; if prefix ends with `/` or `abs` is an existing directory → `globPattern = abs + '/**'`; else `globPattern = abs + '*'`. Push `{ source: prefix, resolvedPath: abs, specifiers: [{ name: '*', isDefault: false, isNamespace: true }], isNamespaceImport: true, isDynamicImport: true, isTypeOnly: false, globPattern }`.
- `import.meta.glob(...)`/`globEager`: `CallExpression` whose expression is `PropertyAccessExpression` on `MetaProperty` (`import.meta`) with name `glob`/`globEager`; first argument string literal (or array of string literals → one ImportInfo each): `globPattern = path.resolve(fileDir, literal)`.
- `require.context(dir, ...)`: `globPattern = path.resolve(fileDir, dir) + '/**'`.
- `new Worker(x)` / `new SharedWorker(x)` / `new URL(x, import.meta.url)`: `NewExpression` with identifier `Worker|SharedWorker|URL`; take first argument: string literal → resolve; `new URL(lit, import.meta.url)` nested inside `new Worker(...)` → resolve the literal once (handle the nesting by checking `Worker`'s first arg being a `NewExpression` of `URL`, and skip standalone `URL` handling when its parent is that `Worker` call so each file is collected once). Emit namespace import when the resolved path exists.
- `RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.vue', '.svelte']`.

- [ ] **Step 4: Run** `pnpm vitest run test/unit/analyzer/importCollector.test.ts test/unit/analyzer/dependencyGraph.test.ts test/unit/analyzer/pathAliasResolution.test.ts` → PASS; `pnpm type-check`.

---

### Task 5: CommonJS exports

**Files:**
- Modify: `src/analyzer/exportCollector.ts`
- Test: `test/unit/analyzer/exportCollector.test.ts` (extend)

- [ ] **Step 1: Failing tests** (use the existing helper that creates a `SourceFile` from text; `.js` file name):

```ts
describe('collectExports - CommonJS', () => {
  const sf = (code: string) => ts.createSourceFile('/p/a.js', code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  it('collects module.exports object literal keys', () => {
    const names = collectExports(sf('const a = 1; module.exports = { a, b: () => 2, ...rest };')).map((e) => e.name);
    expect(names).toEqual(['a', 'b']);
  });
  it('collects module.exports = expr as default', () => {
    const e = collectExports(sf('module.exports = function main() {};'));
    expect(e).toEqual([expect.objectContaining({ name: 'default', isDefault: true, kind: 'default' })]);
  });
  it('collects exports.x and module.exports.x', () => {
    const names = collectExports(sf('exports.x = 1; module.exports.y = 2;')).map((e) => e.name);
    expect(names).toEqual(['x', 'y']);
  });
  it('does not duplicate names', () => {
    expect(collectExports(sf('exports.x = 1; exports.x = 2;'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement**: in `visit`, handle `BinaryExpression` with `EqualsToken`: left is `module.exports` (PropertyAccess on identifier `module`, name `exports`) → if right is `ObjectLiteralExpression`, push each `PropertyAssignment`/`ShorthandPropertyAssignment`/`MethodDeclaration` name (kind `'variable'`, or `'function'` for methods/function-valued assignments); otherwise push `default` (`isDefault: true`, kind `'default'`). Left is `exports.<x>` or `module.exports.<x>` → push `x` (`kind: 'variable'`, or `'function'` when right is a function/arrow). Keep a `seen` set to dedupe names.
- [ ] **Step 4: Run** the file + `pnpm type-check`.

---

### Task 6: Local symbol collector rewrite

**Files:**
- Modify: `src/analyzer/localSymbolCollector.ts`, `src/analyzer/unusedLocalDetector.ts`
- Test: `test/unit/analyzer/localSymbolCollector.test.ts` (extend), `test/unit/analyzer/unusedLocalDetector.test.ts` (extend), `test/unit/analyzer/localsPerformance.test.ts` (new)

**Interfaces:**
- Produces: `collectLocals(sourceFile, checker): LocalSymbolInfo[]` (same signature). Emits `kind: 'parameter' | 'variable' | 'function' | 'class' | 'method' | 'field'`, sets `isParameterProperty` on constructor parameter properties. `unusedLocalDetector.determineLocalConfidence`: `parameter → 'medium'`, `field → 'medium'`, `method → 'high'`; existing tsx/java rules retained.

- [ ] **Step 1: Failing tests** (reuse the file's existing `collectFromSource(code)` helper that builds a program + checker):

```ts
describe('collectLocals - scopes, members, parameters', () => {
  it('collects locals inside nested arrow functions and callbacks', () => {
    const locals = collectFromSource(`export function f() { const h = () => { const nested = 1; return 2; }; [1].forEach((n) => { const inCb = n; }); return h(); }`);
    const byName = Object.fromEntries(locals.map((l) => [l.name, l.references]));
    expect(byName.nested).toBe(0); expect(byName.inCb).toBe(0); expect(byName.h).toBe(1);
  });
  it('collects private members and counts this.x / this.#x references', () => {
    const locals = collectFromSource(`export class S { private used = 1; private unusedField = 2; #priv() {} private unusedMethod() {} private usedMethod() { return this.used + this.#priv(); } public run() { return this.usedMethod(); } }`);
    const byName = Object.fromEntries(locals.map((l) => [l.name, { r: l.references, k: l.kind }]));
    expect(byName.used).toEqual({ r: 1, k: 'field' });
    expect(byName.unusedField).toEqual({ r: 0, k: 'field' });
    expect(byName.unusedMethod).toEqual({ r: 0, k: 'method' });
    expect(byName.usedMethod.r).toBe(1);
    expect(byName['#priv']).toEqual({ r: 1, k: 'method' });
    expect(locals.find((l) => l.name === 'run')).toBeUndefined();
  });
  it('marks constructor parameter properties', () => {
    const locals = collectFromSource(`export class S { constructor(private readonly svc: number, public pub: number) {} }`);
    const svc = locals.find((l) => l.name === 'svc')!;
    expect(svc.isParameterProperty).toBe(true); expect(svc.kind).toBe('field');
    expect(locals.find((l) => l.name === 'pub')).toBeUndefined();
  });
  it('applies the after-used rule to parameters', () => {
    const locals = collectFromSource(`export function cb(err: Error, data: string) { return data; } export function g(a: number, b: number) { return a; }`);
    const names = locals.filter((l) => l.kind === 'parameter').map((l) => l.name);
    expect(names).not.toContain('err'); // before a used param
    expect(names).toContain('b');       // after the last used param
  });
  it('skips parameters of methods in classes that extend/implement', () => {
    const locals = collectFromSource(`interface H { handle(req: string, res: string): string } export class C implements H { handle(req: string, res: string) { return res; } } export class D extends C { other(x: number) { return 1; } }`);
    expect(locals.filter((l) => l.kind === 'parameter')).toHaveLength(0);
  });
  it('skips decorated members and abstract/overload signatures', () => {
    const locals = collectFromSource(`declare const dec: any; export abstract class A { @dec private decorated = 1; abstract m(x: number): void; over(a: number): void; over(a: number) {} }`);
    expect(locals.map((l) => l.name)).not.toContain('decorated');
    expect(locals.filter((l) => l.kind === 'parameter').map((l) => l.name)).toEqual([]);
  });
});
```
`unusedLocalDetector.test.ts` additions: a `parameter` local with 0 refs → `'medium'`; `field` → `'medium'`; `method` → `'high'`.

`localsPerformance.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { analyze, clearProgramCache } from '../../../src/analyzer';
describe('local reference counting scales linearly', () => {
  it('analyses a 2000-function file in under 3 seconds', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) lines.push(`export function f${i}(p${i}: number) { const a${i} = p${i} + 1; const b${i} = a${i} * 2; return b${i}; }`);
    const big = path.join(dir, 'big.ts'); fs.writeFileSync(big, lines.join('\n'));
    clearProgramCache();
    const t0 = Date.now();
    const r = await analyze({ files: [big], rootDir: dir, entryPoints: [big] });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.totalLocalCount).toBe(6000);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, expect failure** (perf test fails on time).

- [ ] **Step 3: Implement** `collectLocals`:

```ts
export function collectLocals(sourceFile: ts.SourceFile, checker: ts.TypeChecker): LocalSymbolInfo[] {
  const exportedNames = collectExportedNames(sourceFile);           // existing first pass, extracted to a function
  const candidates: Array<{ name: string; declNode: ts.Declaration; kind: LocalKind; symbol: ts.Symbol; isParameterProperty?: boolean }> = [];
  const seen = new Set<ts.Symbol>();

  function add(name: string, declNode: ts.Declaration, nameNode: ts.Node, kind: LocalKind, isParameterProperty?: boolean) {
    if (kind !== 'method' && kind !== 'field' && exportedNames.has(name)) return;
    if (name.startsWith('_') || name.startsWith('#_')) return;
    const symbol = checker.getSymbolAtLocation(nameNode);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    candidates.push({ name, declNode, kind, symbol, isParameterProperty });
  }

  function visit(node: ts.Node): void {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && !hasExportModifier(node) && !hasDefaultExportModifier(node))
      add(node.name.text, node, node.name, ts.isFunctionDeclaration(node) ? 'function' : 'class');
    if (ts.isVariableStatement(node) && !hasExportModifier(node))
      for (const decl of node.declarationList.declarations) collectDeclarationName(decl.name, decl, add);
    if (isFunctionLike(node) && node.body) collectParameters(node, add);
    if (ts.isClassLike(node)) collectPrivateMembers(node, add);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const counts = countReferences(sourceFile, checker, new Set(candidates.map((c) => c.symbol)));
  return candidates.map((c) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(c.declNode.getStart());
    return { name: c.name, line: line + 1, column: character, kind: c.kind, references: counts.get(c.symbol) ?? 0, isParameterProperty: c.isParameterProperty };
  });
}
```
Helpers:
- `isFunctionLike(node)`: `ts.isFunctionDeclaration || isFunctionExpression || isArrowFunction || isMethodDeclaration || isConstructorDeclaration || isGetAccessor || isSetAccessor`.
- `collectDeclarationName(name, decl, add)`: identifier → `add(text, decl, name, 'variable')`; binding patterns → existing `collectBindingElements` logic (keep the rest-sibling rule) calling `add(..., 'variable')`.
- `collectParameters(fn, add)`: skip when `fn` is a method/constructor/accessor whose parent class has `heritageClauses` or decorators (`ts.getDecorators(parent)`), when `fn` has decorators, or when it is abstract / has no body. Determine `lastUsedIndex`: for each parameter (by index) check whether its symbol has any reference in `fn.body` (use a cheap per-function walk: `checker.getSymbolAtLocation` on identifiers inside the body, comparing to the parameter symbols — bounded by the function size, so total work stays linear). Parameters with index `> lastUsedIndex` and an identifier name (or binding pattern → its elements) are added with kind `'parameter'`; parameters with `this` name or `dotDotDotToken` are skipped. Constructor parameters with accessibility modifiers (`private`/`protected`/`readonly`) are **parameter properties**: add with kind `'field'`, `isParameterProperty: true`, and only when the modifier is `private` (public/protected are API).
- `collectPrivateMembers(cls, add)`: for each member that is a `MethodDeclaration`/`PropertyDeclaration`/`GetAccessor`/`SetAccessor` with a `private` modifier or a `PrivateIdentifier` name, no decorators, and (for methods) a body: `add(nameText, member, member.name, isMethodOrAccessor ? 'method' : 'field')`. `nameText` for private identifiers includes the `#`.
- `countReferences(sourceFile, checker, symbols)`: one walk over all `ts.Identifier`/`ts.PrivateIdentifier` nodes: `let sym = checker.getSymbolAtLocation(node)`; if `!symbols.has(sym)` and parent is `ShorthandPropertyAssignment` with `name === node`, use `checker.getShorthandAssignmentValueSymbol(parent)`; skip when the node is the declaration's own name (`(parent as ts.NamedDeclaration).name === node` and `parent` is in `sym.declarations`); increment `Map<ts.Symbol, number>`.

`unusedLocalDetector.ts`: pass `local` (with `isParameterProperty`) to `determineLocalConfidence`; add before the `return 'high'`:
```ts
  if (local.kind === 'parameter') return 'medium';
  if (local.kind === 'field') return 'medium';
```

- [ ] **Step 4: Run** `pnpm vitest run test/unit/analyzer/localSymbolCollector.test.ts test/unit/analyzer/unusedLocalDetector.test.ts test/unit/analyzer/localsPerformance.test.ts test/integration/pipeline.test.ts` → PASS. Note: `test/fixtures/simple-project` expectations in `pipeline.test.ts`/`analyzer.test.ts` may list exact local counts — update those numbers only if the new counts are correct by inspection (nested locals are now reported).

---

### Task 7: Entry-point resolver and framework entries

**Files:**
- Create: `src/analyzer/entryPointResolver.ts`
- Modify: `src/analyzer/languages/typescriptAnalyzer.ts`, `src/analyzer/frameworkDetector.ts`
- Test: `test/unit/analyzer/entryPointResolver.test.ts` (new), `test/unit/analyzer/frameworkDetector.test.ts` (extend), `test/unit/analyzer/entryPoints.test.ts` (extend)

**Interfaces:**
- Produces: `mapBuildPathToSource(rootDir: string, filePath: string): string | undefined`; `resolvePackageJsonEntries(pkgDir: string): string[]`; `findWorkspacePackageDirs(rootDir: string): Promise<string[]>`; `findConventionalEntries(pkgDir: string): Promise<string[]>`; `findHtmlScriptEntries(rootDir: string): Promise<string[]>`; `findServerlessEntries(rootDir: string): Promise<string[]>`; `FRAMEWORK_CONFIGS.nuxt`, `.sveltekit`; `findAngularJsonEntries(rootDir): string[]` (in frameworkDetector, called from `findFrameworkEntryPoints` when angular is detected). `TypeScriptAnalyzer.findEntryPoints` = union of `resolvePackageJsonEntries` + `findConventionalEntries` over root and every workspace package dir, plus `findFrameworkEntryPoints(root)`, `findHtmlScriptEntries`, `findServerlessEntries`.

- [ ] **Step 1: Failing tests** (`entryPointResolver.test.ts`, temp dir per test, `w(rel, content)` helper that creates parent dirs):

```ts
describe('mapBuildPathToSource', () => {
  it('maps dist/x.js to src/x.ts using tsconfig rootDir/outDir', () => {
    w('tsconfig.json', '{"compilerOptions":{"rootDir":"src","outDir":"dist"}}'); const src = w('src/extension.ts', '');
    expect(mapBuildPathToSource(dir, path.join(dir, 'dist/extension.js'))).toBe(src);
  });
  it('falls back to src/ and tries tsx/mts/js', () => {
    const src = w('src/index.tsx', '');
    expect(mapBuildPathToSource(dir, path.join(dir, 'build/index.js'))).toBe(src);
  });
  it('maps .d.ts to .ts and returns existing paths unchanged', () => {
    const src = w('src/a.ts', '');
    expect(mapBuildPathToSource(dir, path.join(dir, 'lib/a.d.ts'))).toBe(src);
    expect(mapBuildPathToSource(dir, src)).toBe(src);
  });
  it('returns undefined when nothing matches', () => { expect(mapBuildPathToSource(dir, path.join(dir, 'dist/nope.js'))).toBeUndefined(); });
});
describe('resolvePackageJsonEntries', () => {
  it('reads main/module/types/bin/exports/scripts and maps build output to source', () => {
    w('src/extension.ts', ''); w('src/cli.ts', ''); w('src/lib.ts', ''); w('src/types.ts', ''); w('scripts/migrate.ts', '');
    w('package.json', JSON.stringify({ main: 'dist/extension.js', types: 'dist/types.d.ts', bin: { tool: 'dist/cli.js' }, exports: { '.': { import: './dist/lib.js', require: './dist/lib.cjs' } }, scripts: { migrate: 'tsx scripts/migrate.ts --force' } }));
    const out = resolvePackageJsonEntries(dir).map((p) => path.relative(dir, p)).sort();
    expect(out).toEqual(['scripts/migrate.ts', 'src/cli.ts', 'src/extension.ts', 'src/lib.ts', 'src/types.ts']);
  });
});
describe('findWorkspacePackageDirs', () => {
  it('expands package.json workspaces and pnpm-workspace.yaml', async () => {
    w('packages/a/package.json', '{}'); w('packages/b/package.json', '{}'); w('apps/web/package.json', '{}');
    w('package.json', '{"workspaces":["packages/*"]}'); w('pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n');
    const dirs = (await findWorkspacePackageDirs(dir)).map((p) => path.relative(dir, p)).sort();
    expect(dirs).toEqual(['apps/web', 'packages/a', 'packages/b']);
  });
});
describe('findHtmlScriptEntries / findServerlessEntries', () => {
  it('reads <script src> from index.html', async () => {
    const m = w('src/main.ts', ''); w('index.html', '<html><script type="module" src="/src/main.ts"></script></html>');
    expect(await findHtmlScriptEntries(dir)).toEqual([m]);
  });
  it('finds vercel api routes only with vercel.json, netlify and firebase functions, serverless.yml handlers', async () => {
    const api = w('api/hello.ts', ''); w('vercel.json', '{}'); const nf = w('netlify/functions/x.ts', ''); const fb = w('functions/src/index.ts', ''); const sls = w('src/handlers/user.ts', '');
    w('serverless.yml', 'functions:\n  user:\n    handler: src/handlers/user.main\n');
    const out = (await findServerlessEntries(dir)).sort();
    expect(out).toEqual([api, fb, nf, sls].sort());
  });
});
```
`frameworkDetector.test.ts` additions: `nuxt` dep → entry patterns include `pages/**`, `components/**`; `@sveltejs/kit` → `src/routes/**`; angular with `angular.json` (`projects.app.architect.build.options.main: "src/main.ts"`) → `findFrameworkEntryPoints` contains `src/main.ts` and `polyfills`.
`entryPoints.test.ts` addition: package.json `main: dist/extension.js` with `src/extension.ts` present → `TypeScriptAnalyzer.findEntryPoints` contains `src/extension.ts` and not `dist/extension.js`; workspace packages' `src/index.ts` included.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** `entryPointResolver.ts`:
- `BUILD_DIRS = ['dist', 'build', 'out', 'lib', '.next', '.output', 'esm', 'cjs']`, `SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']`.
- `mapBuildPathToSource(rootDir, filePath)`: `const abs = path.resolve(rootDir, filePath)`; if it exists and is a file → return it. `const rel = path.relative(rootDir, abs)`; `const [first, ...rest] = rel.split(path.sep)`; if `first` not in `BUILD_DIRS` and file doesn't exist → return undefined. Candidate roots: `[tsconfig rootDir (read `tsconfig.json` compilerOptions.rootDir if present), 'src', '']` (dedupe). For each root, base = `path.join(rootDir, root, ...rest)` with extension stripped (`.d.ts` first, then `.js/.mjs/.cjs`), try `base + ext` for each `SOURCE_EXTS`; return the first existing.
- `resolvePackageJsonEntries(pkgDir)`: read `package.json`; collect strings from `main`, `module`, `types`, `typings`, `browser` (string), `bin` (string or object values), `exports` (walk recursively; every string leaf), `scripts` (regex `/(?:^|[\s"'=])((?:\.{1,2}\/)?[\w@./-]+\.(?:[mc]?[jt]sx?))\b/g` over each script string); map each via `mapBuildPathToSource(pkgDir, value)`; dedupe.
- `findWorkspacePackageDirs(rootDir)`: patterns from `package.json#workspaces` (array or `{packages}`), `pnpm-workspace.yaml` (lines matching `^\s*-\s*['"]?([^'"#\s]+)`), `lerna.json#packages`; `fg(patterns, { cwd: rootDir, onlyDirectories: true, absolute: true, ignore: ['**/node_modules/**'] })` filtered to dirs containing `package.json`.
- `findConventionalEntries(pkgDir)`: `fg(['{src/,}{index,main,cli,server,app}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', 'bin/*.{ts,js,mjs,cjs}', 'scripts/*.{ts,js,mjs,cjs}'], { cwd: pkgDir, absolute: true, onlyFiles: true })`.
- `findHtmlScriptEntries(rootDir)`: `fg(['*.html', 'src/**/*.html', 'public/**/*.html'], …ignore node_modules/dist)`, regex `/<script[^>]*\ssrc=["']([^"']+)["']/g`; for each src not starting with `http`/`//`: `path.resolve(path.dirname(html), src.startsWith('/') ? path.join(rootDir, src) : src)`; keep existing files.
- `findServerlessEntries(rootDir)`: `api/**/*.{ts,js}` only if `vercel.json` exists; always `netlify/functions/**/*.{ts,js}`, `functions/src/index.{ts,js}`, `supabase/functions/*/index.ts`; `serverless.yml`/`.yaml`: regex `/^\s*handler:\s*([\w./-]+)\.\w+\s*$/gm` → `path.resolve(rootDir, m[1])` + first existing of `.ts/.js/.mjs/.cjs`.

`frameworkDetector.ts`: add `nuxt` and `sveltekit` configs exactly as the spec §2.2 lists; `FRAMEWORK_DEPS` += `nuxt: 'nuxt'`, `'@sveltejs/kit': 'sveltekit'`; `findAngularJsonEntries(rootDir)` parses `angular.json` (`projects[*].architect.build.options.{main,browser,polyfills}` strings or arrays) and `findFrameworkEntryPoints` appends its result when `angular` is among detected frameworks.

`typescriptAnalyzer.findEntryPoints(rootDir)`:
```ts
    const dirs = [rootDir, ...(await findWorkspacePackageDirs(rootDir))];
    const entries = new Set<string>();
    for (const d of dirs) { for (const e of resolvePackageJsonEntries(d)) entries.add(e); for (const e of await findConventionalEntries(d)) entries.add(e); }
    for (const e of await findFrameworkEntryPoints(rootDir)) entries.add(e);
    for (const e of await findHtmlScriptEntries(rootDir)) entries.add(e);
    for (const e of await findServerlessEntries(rootDir)) entries.add(e);
    return Array.from(entries).map((p) => path.normalize(p));
```

- [ ] **Step 4: Run** the three test files + `pnpm type-check && pnpm lint`.

---

### Task 8: Multi-tsconfig program groups and SFC support

**Files:**
- Create: `src/analyzer/sfc.ts`
- Modify: `src/analyzer/programFactory.ts`, `src/analyzer/dependencyGraph.ts`, `src/analyzer/index.ts`, `src/analyzer/languages/typescriptAnalyzer.ts`
- Test: `test/unit/analyzer/sfc.test.ts` (new), `test/unit/analyzer/programFactory.test.ts` (new), `test/unit/analyzer/sfcAnalysis.test.ts` (new, through `analyze()`)

**Interfaces:**
- Produces: `isSfcFile(filePath: string): boolean`; `extractSfcScript(content: string, ext: '.vue' | '.svelte'): string` (same line count, non-script chars blanked); `extractSfcTemplate(content, ext): string` (script bodies blanked instead); `countTemplateReferences(template: string, name: string): number`; `interface ProgramGroup { program: ts.Program; files: string[]; configPath?: string }`; `createPrograms(files: string[], rootDir: string, tsconfigPath?: string): ProgramGroup[]`; `createProgram(files, tsconfigPath?)` kept as `createPrograms(files, path.dirname(files[0] ?? '.'), tsconfigPath)[0].program`.

- [ ] **Step 1: Failing tests**

```ts
// sfc.test.ts
describe('extractSfcScript', () => {
  it('keeps line numbers and blanks everything outside script blocks (vue)', () => {
    const vue = `<template>\n  <Foo :x="count" />\n</template>\n<script setup lang="ts">\nimport Foo from './Foo.vue';\nconst count = 1;\n</script>\n<style>.a{}</style>\n`;
    const out = extractSfcScript(vue, '.vue');
    expect(out.split('\n').length).toBe(vue.split('\n').length);
    expect(out.split('\n')[4]).toBe("import Foo from './Foo.vue';");
    expect(out).not.toContain('<template>'); expect(out).not.toContain('.a{}');
  });
  it('keeps both module and instance scripts (svelte)', () => {
    const sv = `<script context="module">export const load = 1;</script>\n<script>let n = 0;</script>\n<p>{n}</p>`;
    const out = extractSfcScript(sv, '.svelte');
    expect(out).toContain('export const load = 1;'); expect(out).toContain('let n = 0;'); expect(out).not.toContain('<p>');
  });
});
describe('countTemplateReferences', () => {
  it('matches identifiers and kebab-case component names in the template only', () => {
    const vue = `<template><my-comp :v="count" @click="onClick" /></template><script setup>const count = 1; const onClick = () => {}; const MyComp = 1; const unused = 2;</script>`;
    const tpl = extractSfcTemplate(vue, '.vue');
    expect(countTemplateReferences(tpl, 'count')).toBe(1);
    expect(countTemplateReferences(tpl, 'onClick')).toBe(1);
    expect(countTemplateReferences(tpl, 'MyComp')).toBe(1);
    expect(countTemplateReferences(tpl, 'unused')).toBe(0);
  });
});
```

```ts
// programFactory.test.ts
describe('createPrograms', () => {
  it('groups files by nearest tsconfig within rootDir and applies each config\'s paths', () => {
    w('packages/a/tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@a/*":["src/*"]}}}');
    w('packages/b/tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@b/*":["src/*"]}}}');
    const a = w('packages/a/src/index.ts', "import { x } from '@a/util';"); const au = w('packages/a/src/util.ts', 'export const x = 1;');
    const b = w('packages/b/src/index.ts', "import { y } from '@b/util';"); const bu = w('packages/b/src/util.ts', 'export const y = 1;');
    const loose = w('tools/x.ts', 'export const t = 1;');
    const groups = createPrograms([a, au, b, bu, loose], dir);
    expect(groups).toHaveLength(3);
    const byCfg = Object.fromEntries(groups.map((g) => [g.configPath ? path.relative(dir, g.configPath) : 'default', g.files.map((f) => path.basename(f)).sort()]));
    expect(byCfg['packages/a/tsconfig.json']).toEqual(['index.ts', 'util.ts']);
    expect(byCfg['default']).toEqual(['x.ts']);
    expect(groups.find((g) => g.configPath?.includes('packages/a'))!.program.getCompilerOptions().paths).toHaveProperty('@a/*');
  });
  it('accepts .vue files through the SFC host', () => {
    const v = w('App.vue', '<template><p/></template>\n<script setup lang="ts">\nexport const fromVue: number = 1;\n</script>');
    const [g] = createPrograms([v], dir);
    const sf = g.program.getSourceFile(v)!;
    expect(sf.text.split('\n')[2]).toBe('export const fromVue: number = 1;');
  });
});
```

```ts
// sfcAnalysis.test.ts — through analyze()
it('links TS utilities imported from .vue files and does not report template-used locals', async () => {
  const util = w('src/util.ts', 'export const helper = 1; export const dead = 2;');
  const comp = w('src/Comp.vue', '<template><p>{{ count }}</p></template><script setup lang="ts">import { helper } from "./util"; const count = helper; const unusedLocal = 3;</script>');
  const app = w('src/App.vue', '<template><Comp /></template><script setup lang="ts">import Comp from "./Comp.vue";</script>');
  const r = await analyze({ files: [util, comp, app], rootDir: dir, entryPoints: [app] });
  expect(r.unusedFiles).toHaveLength(0);
  expect(r.unusedExports.map((e) => e.exportName)).toEqual(['dead']);
  expect(r.unusedLocals.map((l) => l.symbolName)).toEqual(['unusedLocal']);
});
it('resolves a monorepo where each package has its own tsconfig paths', async () => { /* same layout as programFactory test; expect no unused files/exports besides none */ });
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

`sfc.ts`:
```ts
const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
export function isSfcFile(filePath: string): boolean { return /\.(vue|svelte)$/i.test(filePath); }
function blankExcept(content: string, keep: Array<[number, number]>): string {
  let out = ''; let cursor = 0;
  for (const [s, e] of keep) { out += content.slice(cursor, s).replace(/[^\n]/g, ' '); out += content.slice(s, e); cursor = e; }
  return out + content.slice(cursor).replace(/[^\n]/g, ' ');
}
function scriptRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []; let m: RegExpExecArray | null; SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(content))) { const start = m.index + m[0].indexOf(m[1]); ranges.push([start, start + m[1].length]); }
  return ranges;
}
export function extractSfcScript(content: string, _ext: '.vue' | '.svelte'): string { return blankExcept(content, scriptRanges(content)); }
export function extractSfcTemplate(content: string, _ext: '.vue' | '.svelte'): string {
  let out = content; for (const [s, e] of scriptRanges(content).reverse()) out = out.slice(0, s) + out.slice(s, e).replace(/[^\n]/g, ' ') + out.slice(e); return out;
}
export function countTemplateReferences(template: string, name: string): number {
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const re = new RegExp(`(?<![\\w$])(?:${escape(name)}|${escape(kebab)})(?![\\w$])`, 'g');
  return (template.match(re) ?? []).length;
}
```

`programFactory.ts`:
- `createPrograms(files, rootDir, tsconfigPath?)`: if `tsconfigPath` given, one group. Else group by `findNearestTsConfig(path.dirname(file), rootDir)` (walk up until `rootDir`, inclusive; `undefined` when none). For each group: options via existing `getCompilerOptions` logic plus `allowNonTsExtensions: true` and `allowJs: true` when unset; host = `ts.createCompilerHost(options, true)` with `readFile`/`getSourceFile`/`fileExists` overridden for `isSfcFile` paths (`readFile` returns `extractSfcScript(fs.readFileSync(...), ext)`; `getSourceFile` calls `ts.createSourceFile(fileName, extracted, languageVersion, true, ts.ScriptKind.TS)`). `ts.createProgram({ rootNames: group.files, options, host, oldProgram: cache.get(key)?.program })`. Cache `Map<string, ProgramCache>` keyed by `configPath ?? '<default>:' + rootDir`. `clearProgramCache()` clears the map.

`dependencyGraph.ts` `buildDependencyGraph`: after collecting exports for an SFC file, push `{ name: 'default', isDefault: true, isReExport: false, line: 1, column: 0, kind: 'default', isTypeOnly: false }` unless an export named `default` exists; after collecting locals, for SFC files compute `template = extractSfcTemplate(readSource(filePath)!, ext)` and set `references = Math.max(references, countTemplateReferences(template, name))` for each local with `references === 0`.

`index.ts`: replace `createProgram(files, options.tsconfigPath)` + single `buildDependencyGraph` with a loop over `createPrograms(files, options.rootDir, options.tsconfigPath)`; push each `group.program` into `tsPrograms`; build/merge a graph per group. `typescriptAnalyzer.buildGraph` does the same with `createPrograms(files, rootDir, tsconfigPath)`.

- [ ] **Step 4: Run** the three new tests + `test/unit/analyzer/importCollector.test.ts` + `test/integration` + `pnpm type-check && pnpm lint`.

---

### Task 9: Commands, config and packaging wiring, docs

**Files:**
- Create: `src/commands/runAnalysis.ts`
- Modify: `src/commands/analyzeProject.ts`, `src/commands/analyzeCurrentFile.ts`, `src/config/configManager.ts`, `src/extension.ts`, `package.json`, `README.md`, `CHANGELOG.md`
- Test: `test/unit/commands/runAnalysis.test.ts` (new; `vscode` is aliased to the mock by vitest config)

**Interfaces:**
- Produces: `runProjectAnalysis(rootDir: string, config: ExtensionConfig): Promise<{ result: AnalysisResult; fileCount: number; entryPoints: string[] }>`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { runProjectAnalysis } from '../../../src/commands/runAnalysis';
import { DEFAULT_INCLUDE_PATTERNS, DEFAULT_EXCLUDE_PATTERNS } from '../../../src/constants';
const base = { include: DEFAULT_INCLUDE_PATTERNS, exclude: DEFAULT_EXCLUDE_PATTERNS, entryPoints: [], analyzeOnSave: false, reportFormat: 'json' as const, confidenceThreshold: 'low' as const, ignorePatterns: [], enabledLanguages: ['typescript', 'python', 'go', 'java', 'dart', 'php'] as const, entryPointDecorators: [], containerFiles: [], alwaysUsedPatterns: [] };
describe('runProjectAnalysis', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('auto-detects entry points, honours enabledLanguages and alwaysUsedPatterns', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"src/index.ts"}');
    fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src/index.ts'), "import { a } from './svc'; console.log(a);");
    fs.writeFileSync(path.join(dir, 'src/svc.ts'), 'export const a = 1; export const UserRepository = 2; export const dead = 3;');
    fs.writeFileSync(path.join(dir, 'ignored.py'), 'def orphan(): pass');
    const { result, entryPoints, fileCount } = await runProjectAnalysis(dir, { ...base, enabledLanguages: ['typescript'], alwaysUsedPatterns: ['*Repository'] });
    expect(entryPoints).toContain(path.join(dir, 'src/index.ts'));
    expect(fileCount).toBe(2);
    expect(result.unusedExports.map((e) => e.exportName)).toEqual(['dead']);
  });
});
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement** `runAnalysis.ts` (scan → filter by `detectLanguage(file)` ∈ `config.enabledLanguages` → entry points from `getAllAnalyzers()` when `config.entryPoints` is empty → `analyze({ files, rootDir, entryPoints, ignorePatterns, entryPointDecorators, containerFiles, alwaysUsedPatterns })`). `analyzeProject.ts` calls it and keeps its UI code; `analyzeCurrentFile.ts` calls it and then filters the three result arrays to `filePath` (delete the `analyzeFile` call; keep `analyzeFile` exported in `analyzer/index.ts` for API compatibility but implement it as "run `analyze`, filter"). Unsupported-file message lists "TypeScript, JavaScript, Vue, Svelte, Python, Go, Java, Dart, PHP".
  `configManager.ts` default `enabledLanguages`: `['typescript', 'python', 'go', 'java', 'dart', 'php']`.
  `extension.ts`: selector and `supportedLanguages` add `'vue', 'svelte', 'dart', 'php'`.
  `package.json`: `include` default = `DEFAULT_INCLUDE_PATTERNS` from Task 1; `exclude` default = `DEFAULT_EXCLUDE_PATTERNS`; `enabledLanguages` enum/default add `dart`, `php`; `activationEvents` add `workspaceContains:**/pubspec.yaml`, `workspaceContains:**/composer.json`, `workspaceContains:**/*.php`, `workspaceContains:**/package.json`; keywords add `php`, `laravel`, `dart`, `flutter`, `vue`, `svelte`; `description` mentions PHP and Vue/Svelte; version `1.2.0`.
  `README.md`: languages list, full configuration table (include/exclude/entryPoints/analyzeOnSave/reportFormat/confidenceThreshold/ignorePatterns/enabledLanguages/entryPointDecorators/containerFiles/alwaysUsedPatterns), confidence semantics incl. dead clusters and parameters, "How It Works" adds reachability and member-name matching. `CHANGELOG.md`: `[1.2.0]` (this work, grouped Added/Fixed/Changed) and a retroactive `[1.1.1]` entry summarising P0–P4.
- [ ] **Step 4: Run** the new test, `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm build`.

---

### Task 10: PHP source utilities and module resolver

**Files:**
- Create: `src/analyzer/languages/php/phpSource.ts`, `src/analyzer/languages/php/phpModuleResolver.ts`
- Test: `test/unit/analyzer/languages/php/phpSource.test.ts`, `test/unit/analyzer/languages/php/phpModuleResolver.test.ts`

**Interfaces:**
- Produces (`phpSource.ts`): `stripPhpCommentsAndStrings(content: string): string` (same length; comment and string *bodies* replaced by spaces, newlines kept, `#[` attributes kept); `findMatchingBrace(content: string, openIndex: number): number` (index of matching `}` or -1; must be called on stripped content); `lineOf(content: string, index: number): number` (1-based).
- Produces (`phpModuleResolver.ts`): `parseNamespace(content: string): string` (`''` if none); `interface PhpUseTable { classes: Map<string, string>; functions: Map<string, string>; consts: Map<string, string> }` (alias → FQCN without leading `\`); `parseUseStatements(content: string): PhpUseTable`; `buildClassIndex(files: string[]): Map<string, string>` (lower-cased FQCN → file; includes top-level functions as `ns\fn`); `interface ComposerAutoload { psr4: Array<{ prefix: string; dirs: string[] }>; psr0: Array<{ prefix: string; dirs: string[] }>; classmapDirs: string[]; files: string[] }`; `loadComposerAutoload(rootDir: string): ComposerAutoload`; `interface PhpResolverContext { index: Map<string, string>; autoload: ComposerAutoload }`; `resolveFqcn(fqcn: string, ctx: PhpResolverContext): string | undefined`; `resolveInclude(spec: string, fromFile: string): string | undefined`; `resolveClassReference(name: string, currentNamespace: string, uses: PhpUseTable, ctx: PhpResolverContext): string | undefined` (handles `\Fully\Qualified`, aliased, relative-to-namespace, and global fallbacks).

- [ ] **Step 1: Failing tests**

```ts
// phpSource.test.ts
describe('stripPhpCommentsAndStrings', () => {
  it('blanks // # /* */ comments and string bodies but keeps #[attributes] and length', () => {
    const src = `<?php\n// c1\n# c2\n#[Route('/x')]\n/* c3\n c3 */\n$a = "str with // inside";\n$b = 'it\\'s';\n$c = <<<EOT\nheredoc Foo::bar()\nEOT;\n$d = Foo::bar();`;
    const out = stripPhpCommentsAndStrings(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain('c1'); expect(out).not.toContain('c2'); expect(out).not.toContain('c3');
    expect(out).toContain("#[Route(''"); expect(out).not.toContain('/x');
    expect(out).not.toContain('str with'); expect(out).not.toContain('heredoc');
    expect(out).toContain('$d = Foo::bar();');
  });
});
describe('findMatchingBrace', () => {
  it('returns the index of the matching close brace', () => {
    const s = 'function f() { if (x) { y(); } }';
    expect(findMatchingBrace(s, s.indexOf('{'))).toBe(s.length - 1);
  });
});
```

```ts
// phpModuleResolver.test.ts (temp dir + w() helper)
describe('parseNamespace / parseUseStatements', () => {
  it('parses namespace and grouped, aliased, function and const uses', () => {
    const src = `<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nuse App\\Services\\{Mailer, Payment as Pay};\nuse function App\\Helpers\\fmt;\nuse const App\\Consts\\LIMIT;`;
    expect(parseNamespace(src)).toBe('App\\Http');
    const u = parseUseStatements(src);
    expect(u.classes.get('User')).toBe('App\\Models\\User');
    expect(u.classes.get('Pay')).toBe('App\\Services\\Payment');
    expect(u.classes.get('Mailer')).toBe('App\\Services\\Mailer');
    expect(u.functions.get('fmt')).toBe('App\\Helpers\\fmt');
    expect(u.consts.get('LIMIT')).toBe('App\\Consts\\LIMIT');
  });
});
describe('buildClassIndex / resolveFqcn', () => {
  it('indexes classes, interfaces, traits, enums and functions by FQCN (case-insensitive)', () => {
    const f = w('src/Models/User.php', '<?php\nnamespace App\\Models;\nclass User {}\ninterface HasName {}\ntrait Soft {}\nenum Status: string {}\nfunction helper() {}');
    const idx = buildClassIndex([f]);
    for (const n of ['App\\Models\\User', 'app\\models\\hasname', 'App\\Models\\Soft', 'App\\Models\\Status', 'App\\Models\\helper']) expect(idx.get(n.toLowerCase())).toBe(f);
  });
  it('falls back to composer PSR-4 for files not in the index', () => {
    w('composer.json', '{"autoload":{"psr-4":{"App\\\\":"app/","Lib\\\\":["lib/src/"]}}}');
    const target = w('app/Http/Kernel.php', '<?php'); const lib = w('lib/src/Tool.php', '<?php');
    const ctx = { index: new Map(), autoload: loadComposerAutoload(dir) };
    expect(resolveFqcn('App\\Http\\Kernel', ctx)).toBe(target);
    expect(resolveFqcn('Lib\\Tool', ctx)).toBe(lib);
    expect(resolveFqcn('Nope\\X', ctx)).toBeUndefined();
  });
});
describe('resolveClassReference', () => {
  it('resolves fully-qualified, aliased, same-namespace and global names', () => {
    const user = w('src/Models/User.php', '<?php namespace App\\Models; class User {}');
    const repo = w('src/Http/UserRepo.php', '<?php namespace App\\Http; class UserRepo {}');
    const glob = w('src/Legacy.php', '<?php class Legacy {}');
    const ctx = { index: buildClassIndex([user, repo, glob]), autoload: loadComposerAutoload(dir) };
    const uses = parseUseStatements('<?php use App\\Models\\User as U;');
    expect(resolveClassReference('\\App\\Models\\User', 'App\\Http', uses, ctx)).toBe(user);
    expect(resolveClassReference('U', 'App\\Http', uses, ctx)).toBe(user);
    expect(resolveClassReference('UserRepo', 'App\\Http', uses, ctx)).toBe(repo);
    expect(resolveClassReference('Legacy', 'App\\Http', uses, ctx)).toBe(glob);
    expect(resolveClassReference('string', 'App\\Http', uses, ctx)).toBeUndefined();
  });
});
describe('resolveInclude', () => {
  it('resolves relative, __DIR__ and dirname(__FILE__) forms', () => {
    const inc = w('lib/helpers.php', '<?php'); const from = w('lib/app.php', '<?php');
    expect(resolveInclude("'helpers.php'", from)).toBe(inc);
    expect(resolveInclude("__DIR__ . '/helpers.php'", from)).toBe(inc);
    expect(resolveInclude("dirname(__FILE__) . '/helpers.php'", from)).toBe(inc);
    expect(resolveInclude("dirname(__DIR__) . '/lib/helpers.php'", from)).toBe(inc);
    expect(resolveInclude("$base . '/x.php'", from)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

`phpSource.ts` — single left-to-right scanner with states `code | lineComment | blockComment | single | double | heredoc`; in `code`, `//` and `#` (when the next char is not `[`) start a line comment, `/*` a block comment, `'`/`"` strings (handle `\\` escapes), `<<<['"]?ID['"]?` starts heredoc/nowdoc until a line that is exactly `ID` (optionally followed by `;` and leading whitespace per PHP 7.3+). Replace every consumed non-newline char of comments and string bodies with a space; keep quotes and the `<<<ID`/`ID` markers. `findMatchingBrace` counts `{`/`}` from `openIndex`. `lineOf` counts `\n` before `index`.

`phpModuleResolver.ts`:
- `parseNamespace`: `/^\s*namespace\s+([\w\\]+)\s*[;{]/m` on stripped content.
- `parseUseStatements`: iterate `/^\s*use\s+(function\s+|const\s+)?([^;]+);/gm` on stripped content; for each body handle `Prefix\{A, B as C}` groups and comma lists; alias = part after `as` or last segment.
- `buildClassIndex(files)`: for each file `readSource` → strip → namespace → regex `/^\s*(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum|function)\s+([A-Za-z_]\w*)/gm` at brace depth 0 (track depth while scanning lines; functions inside classes are at depth ≥ 1 and skipped) → `index.set((ns ? ns + '\\' : '') + name).toLowerCase(), file)`.
- `loadComposerAutoload`: read `composer.json`; `autoload`+`autoload-dev`; `psr-4`/`psr-0` values string or array; dirs resolved against `rootDir`; `classmap` entries that are directories → `classmapDirs`; `files` resolved.
- `resolveFqcn(fqcn, ctx)`: `const key = fqcn.replace(/^\\/, '').toLowerCase(); if (ctx.index.has(key)) return …`; PSR-4: for each mapping whose prefix (case-insensitive, trailing `\`) is a prefix of the FQCN, candidate = `dir + rest.replace(/\\/g, '/') + '.php'`; PSR-0: underscores in the class name become directory separators; return first existing.
- `resolveInclude(spec, fromFile)`: match `/^(?:__DIR__|dirname\(__FILE__\)|dirname\(__DIR__\))?\s*\.?\s*['"]([^'"]+)['"]$/`; base = `dirname(fromFile)` (`dirname(__DIR__)` → parent of that); `path.resolve(base, literal)` if it exists; a bare `'x.php'` is relative to `dirname(fromFile)`.
- `resolveClassReference(name, ns, uses, ctx)`: `BUILTIN = new Set(['string','int','float','bool','array','void','mixed','null','self','static','parent','object','callable','iterable','never','true','false','this'])`; if name (lower) in BUILTIN → undefined; if starts with `\` → `resolveFqcn(name)`; head = first segment; if `uses.classes.has(head)` → `resolveFqcn(uses.classes.get(head) + rest)`; else try `resolveFqcn(ns ? ns + '\\' + name : name)`, then `resolveFqcn(name)` (global).

- [ ] **Step 4: Run** the two test files + `pnpm type-check`.

---

### Task 11: PHP export collector

**Files:**
- Create: `src/analyzer/languages/php/phpExportCollector.ts`
- Test: `test/unit/analyzer/languages/php/phpExportCollector.test.ts`

**Interfaces:**
- Consumes: Task 10 `stripPhpCommentsAndStrings`, `findMatchingBrace`, `lineOf`; `isPhpDIAttribute` from `decoratorDetector` (added in Task 15 — until then import a local stub `const isPhpDIAttribute = () => false` and switch in Task 15).
- Produces: `collectPhpExports(content: string, filePath: string): ExportInfo[]` with kinds: class/interface/trait → `'class'` (interface → `'interface'`), enum → `'enum'`, top-level function → `'function'`, top-level `const`/`define` → `'constant'`, public method → `'method'`, public property → `'variable'`, class constant → `'constant'`.

- [ ] **Step 1: Failing tests**

```ts
describe('collectPhpExports', () => {
  it('collects top-level declarations and public members with line numbers', () => {
    const src = `<?php\nnamespace App;\nconst LIMIT = 5;\ndefine('FLAG', true);\nfunction helper() {}\nabstract class Base {}\nfinal class User extends Base implements \\JsonSerializable {\n  public const TABLE = 'users';\n  const IMPLICIT = 1;\n  public string $name;\n  private int $secret;\n  public function __construct() {}\n  public static function find(int $id): ?static {}\n  function implicitPublic() {}\n  private function hidden() {}\n  protected function inherited() {}\n  public function jsonSerialize(): array {}\n}\ninterface Repo {}\ntrait Soft {}\nenum Status: string { case A = 'a'; public function label(): string {} }`;
    const e = collectPhpExports(src, '/p/User.php');
    const byName = Object.fromEntries(e.map((x) => [x.name, { k: x.kind, l: x.line }]));
    expect(byName.LIMIT).toEqual({ k: 'constant', l: 3 }); expect(byName.FLAG).toEqual({ k: 'constant', l: 4 });
    expect(byName.helper).toEqual({ k: 'function', l: 5 }); expect(byName.Base).toEqual({ k: 'class', l: 6 });
    expect(byName.User).toEqual({ k: 'class', l: 7 }); expect(byName.TABLE.k).toBe('constant'); expect(byName.IMPLICIT.k).toBe('constant');
    expect(byName.name.k).toBe('variable'); expect(byName.secret).toBeUndefined();
    expect(byName.__construct.k).toBe('method'); expect(byName.find.k).toBe('method'); expect(byName.implicitPublic.k).toBe('method');
    expect(byName.hidden).toBeUndefined(); expect(byName.inherited).toBeUndefined();
    expect(byName.Repo.k).toBe('interface'); expect(byName.Soft.k).toBe('class'); expect(byName.Status.k).toBe('enum'); expect(byName.label.k).toBe('method');
  });
  it('ignores declarations inside strings and comments and closures', () => {
    const src = `<?php\n// class Fake {}\n$s = "function notReal() {}";\n$f = function () { return 1; };\nclass Real { public function m() { $g = fn() => 1; } }`;
    expect(collectPhpExports(src, '/p/a.php').map((x) => x.name).sort()).toEqual(['Real', 'm']);
  });
  it('sets isEntryPointDecorated for DI attributes on classes', () => {
    const src = `<?php\n#[\\Symfony\\Component\\DependencyInjection\\Attribute\\AsService]\nclass Svc {}`;
    // Task 15 wires the real predicate; until then this asserts the field exists (false/undefined)
    expect(collectPhpExports(src, '/p/Svc.php')[0]).toHaveProperty('name', 'Svc');
  });
});
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement**: strip content; scan with a depth-aware loop over `/(abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)|(?<![\w>$])function\s+&?([A-Za-z_]\w*)\s*\(|^\s*const\s+([A-Z_a-z]\w*)\s*=|define\s*\(\s*['"]([A-Za-z_]\w*)['"]/gm` — determine the brace depth at each match (precompute a depth array once by scanning `{`/`}`); depth 0 → top-level; when a class-like starts, find its body via `findMatchingBrace` and scan the body (depth 1 only) with `/^\s*((?:public|private|protected|static|final|abstract|readonly|\s)*)\s*(?:(function)\s+&?([A-Za-z_]\w*)\s*\(|(const)\s+([A-Za-z_]\w*)\s*=|(?:[?\w\\|]+\s+)?\$([A-Za-z_]\w*)\s*[=;,])/gm`, skipping members whose modifiers include `private`/`protected`. Lines from `lineOf` on the original content (same length). Attribute detection: look at the non-blank lines immediately above a class-like for `#[...]` and pass each attribute's short name to `isPhpDIAttribute`.
- [ ] **Step 4: Run** the test file + `pnpm type-check`.

---

### Task 12: PHP import collector

**Files:**
- Create: `src/analyzer/languages/php/phpImportCollector.ts`
- Test: `test/unit/analyzer/languages/php/phpImportCollector.test.ts`

**Interfaces:**
- Consumes: Task 10 resolver API.
- Produces: `collectPhpImports(content: string, filePath: string, ctx: PhpResolverContext): ImportInfo[]` — one `ImportInfo` per resolved target file with `specifiers` = referenced class short names ∪ member names used on those classes in this file; includes → `isNamespaceImport: true`.

- [ ] **Step 1: Failing tests**

```ts
describe('collectPhpImports', () => {
  it('resolves use statements, inline FQCNs, same-namespace and typed references, with member specifiers', () => {
    const user = w('app/Models/User.php', '<?php namespace App\\Models; class User { public static function find() {} public function save() {} const TABLE = "u"; }');
    const post = w('app/Models/Post.php', '<?php namespace App\\Models; class Post {}');
    const mail = w('app/Services/Mailer.php', '<?php namespace App\\Services; class Mailer { public function send() {} }');
    const base = w('app/Http/Controller.php', '<?php namespace App\\Http; class Controller {}');
    const ctl = w('app/Http/UserController.php', `<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nuse App\\Services\\Mailer as M;\nclass UserController extends Controller {\n  public function show(int $id, M $mailer): \\App\\Models\\Post {\n    $u = User::find($id); $u->save(); echo User::TABLE; $mailer->send();\n    return new \\App\\Models\\Post();\n  }\n}`);
    const ctx = { index: buildClassIndex([user, post, mail, base, ctl]), autoload: loadComposerAutoload(dir) };
    const imps = collectPhpImports(fs.readFileSync(ctl, 'utf-8'), ctl, ctx);
    const byPath = Object.fromEntries(imps.map((i) => [i.resolvedPath, i.specifiers.map((s) => s.name).sort()]));
    expect(byPath[user]).toEqual(['TABLE', 'User', 'find', 'save', 'send']); // member names are name-based within the file
    expect(byPath[mail]).toEqual(['Mailer', 'TABLE', 'find', 'save', 'send']);
    expect(byPath[post]).toEqual(['Post', 'TABLE', 'find', 'save', 'send']);
    expect(byPath[base]).toEqual(['Controller', 'TABLE', 'find', 'save', 'send']);
  });
  it('treats require/include as namespace imports and ignores unresolvable ones', () => {
    const h = w('lib/helpers.php', '<?php function x() {}'); const a = w('lib/app.php', "<?php require_once __DIR__ . '/helpers.php'; include 'missing.php'; require $dyn;");
    const imps = collectPhpImports(fs.readFileSync(a, 'utf-8'), a, { index: new Map(), autoload: loadComposerAutoload(dir) });
    expect(imps).toHaveLength(1); expect(imps[0].resolvedPath).toBe(h); expect(imps[0].isNamespaceImport).toBe(true);
  });
  it('collects attribute, instanceof, catch and trait-use references', () => {
    const attr = w('src/Attr/Route.php', '<?php namespace Attr; class Route {}'); const ex = w('src/MyEx.php', '<?php class MyEx extends \\Exception {}'); const tr = w('src/Tr.php', '<?php trait Tr {}');
    const a = w('src/A.php', `<?php\nuse Attr\\Route;\nclass A { use Tr; #[Route('/x')] public function f($o) { if ($o instanceof MyEx) {} try {} catch (MyEx $e) {} } }`);
    const ctx = { index: buildClassIndex([attr, ex, tr, a]), autoload: loadComposerAutoload(dir) };
    const paths = collectPhpImports(fs.readFileSync(a, 'utf-8'), a, ctx).map((i) => i.resolvedPath).sort();
    expect(paths).toEqual([attr, ex, tr].sort());
  });
});
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement**: strip content; `ns = parseNamespace`, `uses = parseUseStatements`. Candidate name regexes over stripped content (each captures a possibly-qualified name `\\?[A-Za-z_]\w*(?:\\[A-Za-z_]\w*)*`): `new\s+(NAME)`, `(NAME)::`, `extends\s+(NAME)`, `implements\s+([^{]+)` (split by `,`), `instanceof\s+(NAME)`, `catch\s*\(\s*([^)$]+)` (split by `|`), `#\[\s*(NAME)`, `^\s*use\s+(NAME)\s*;` inside class bodies (depth ≥ 1), typed params/returns/properties: `(?:\(|,)\s*\??(NAME)(?:\|(NAME))*\s+\$`, `\)\s*:\s*\??(NAME)`, `(?:public|private|protected|readonly|static)\s+\??(NAME)\s+\$`. Also every `use` statement's classes. Resolve each via `resolveClassReference`; group by resolved path (skip the file itself). Member tokens for the file: matches of `(?:->|::)\s*([A-Za-z_]\w*)` on stripped content (all of them, name-based) — added as specifiers to **every** class import in the file (this is the documented over-approximation). Includes: `/\b(require|include)(?:_once)?\s*\(?\s*([^;]+?)\s*\)?\s*;/g` → `resolveInclude(expr, filePath)`; push namespace `ImportInfo` when resolved. Never emit an import whose `resolvedPath` is undefined.
- [ ] **Step 4: Run** the test file + `pnpm type-check`.

---

### Task 13: PHP local collector

**Files:**
- Create: `src/analyzer/languages/php/phpLocalCollector.ts`
- Test: `test/unit/analyzer/languages/php/phpLocalCollector.test.ts`

**Interfaces:**
- Produces: `collectPhpLocals(content: string, exportedNames: Set<string>): LocalSymbolInfo[]` with kinds `'method'` (private methods), `'field'` (private properties), `'constant'` (private consts), `'variable'` (unused local variables, `references` = 0 only when never read).

- [ ] **Step 1: Failing tests**

```ts
describe('collectPhpLocals', () => {
  it('reports private members with reference counts', () => {
    const src = `<?php\nclass A {\n  private int $used = 1;\n  private $unusedProp;\n  private const SECRET = 'x';\n  private function helper() { return $this->used; }\n  private function dead() {}\n  public function run() { return $this->helper() . self::SECRET; }\n}`;
    const l = collectPhpLocals(src, new Set(['A', 'run']));
    const byName = Object.fromEntries(l.map((x) => [x.name, { r: x.references, k: x.kind }]));
    expect(byName.used).toEqual({ r: 1, k: 'field' }); expect(byName.unusedProp).toEqual({ r: 0, k: 'field' });
    expect(byName.SECRET).toEqual({ r: 1, k: 'constant' }); expect(byName.helper).toEqual({ r: 1, k: 'method' }); expect(byName.dead).toEqual({ r: 0, k: 'method' });
  });
  it('reports local variables that are assigned but never read', () => {
    const src = `<?php\nfunction f($p) {\n  $unused = 1;\n  $read = 2; echo $read;\n  $interp = 3; echo "v=$interp";\n  $compact = 4; return compact('compact');\n  $cb = function () use ($p) {}; $cb();\n  $_ignored = 5; $this->x = 6; $GLOBALS['a'] = 7;\n}`;
    const l = collectPhpLocals(src, new Set(['f']));
    expect(l.filter((x) => x.kind === 'variable').map((x) => [x.name, x.references])).toEqual([['unused', 0], ['read', 1], ['interp', 1], ['compact', 1], ['cb', 1]]);
  });
  it('does not report variables assigned in a loop head or foreach as unused when used in the body', () => {
    const src = `<?php\nfunction f($items) { foreach ($items as $k => $v) { echo $v; } for ($i = 0; $i < 2; $i++) {} }`;
    const l = collectPhpLocals(src, new Set());
    expect(l.find((x) => x.name === 'v')?.references).toBe(1);
    expect(l.find((x) => x.name === 'k')?.references).toBe(0);
    expect(l.find((x) => x.name === 'i')?.references).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement**: strip content; class bodies via the same depth scan as Task 11; private members via `/^\s*private\s+(?:static\s+|readonly\s+)*(?:(function)\s+&?([A-Za-z_]\w*)|(const)\s+([A-Za-z_]\w*)|(?:[?\w\\|]+\s+)?\$([A-Za-z_]\w*))/gm`; references = occurrences of `->name\b`, `::name\b`, `::$name\b` in the stripped content excluding the definition line. Function/method bodies: for every `function ... (` find `{` and its matching brace; inside the body, assignments `/\$([A-Za-z_]\w*)\s*(?:=[^=]|\+=|-=|\.=|\?\?=)/g`, `foreach\s*\([^)]*\bas\s+(?:\$(\w+)\s*=>\s*)?\$(\w+)`, `for\s*\(\s*\$(\w+)\s*=`; skip `$this`, `$_*`, superglobals (`GLOBALS _SERVER _GET _POST _FILES _COOKIE _SESSION _REQUEST _ENV`), names starting with `_`, closure `use (...)` captures; reads = occurrences of `\$name\b` in the **original** (unstripped, so string interpolation counts) body minus assignment sites, plus `compact('name')`/`compact("name")` occurrences. Line = `lineOf` of the first assignment.
- [ ] **Step 4: Run** the test file + `pnpm type-check`.

---

### Task 14: PHP framework detector

**Files:**
- Create: `src/analyzer/languages/php/phpFrameworkDetector.ts`
- Test: `test/unit/analyzer/languages/php/phpFrameworkDetector.test.ts`

**Interfaces:**
- Produces: `type PhpFrameworkType = 'laravel' | 'symfony' | 'wordpress'`; `detectPhpFrameworks(rootDir: string): PhpFrameworkType[]`; `findPhpFrameworkEntryPoints(rootDir: string, frameworks: PhpFrameworkType[]): Promise<string[]>` (generic patterns always included); `PHP_MAGIC_METHODS: string[]`; `getPhpConventionalExports(rootDir: string): string[]` (magic methods + per-framework lists from spec §4.5); `matchesPhpConventionalPattern(name: string): boolean` (`/^scope[A-Z]/`, `/^get[A-Z]\w*Attribute$/`, `/^set[A-Z]\w*Attribute$/`, `/^updated[A-Z]/`).

- [ ] **Step 1: Failing tests**

```ts
describe('phpFrameworkDetector', () => {
  it('detects laravel/symfony from composer.json and wordpress from wp-config.php', () => {
    w('composer.json', '{"require":{"laravel/framework":"^11","symfony/framework-bundle":"^7"}}'); w('wp-config.php', '<?php');
    expect(detectPhpFrameworks(dir).sort()).toEqual(['laravel', 'symfony', 'wordpress']);
  });
  it('returns generic + laravel entry points', async () => {
    const idx = w('public/index.php', ''); const route = w('routes/web.php', ''); const ctl = w('app/Http/Controllers/UserController.php', ''); const blade = w('resources/views/home.blade.php', ''); const model = w('app/Models/User.php', '');
    const out = await findPhpFrameworkEntryPoints(dir, ['laravel']);
    for (const p of [idx, route, ctl, blade]) expect(out).toContain(p);
    expect(out).not.toContain(model);
  });
  it('returns symfony attribute-annotated files and wordpress plugin headers', async () => {
    const cmd = w('src/Command/Sync.php', '<?php #[AsCommand(name: "sync")] class Sync {}'); const svc = w('src/Service/Plain.php', '<?php class Plain {}');
    const plugin = w('wp-content/plugins/my/my.php', '<?php\n/**\n * Plugin Name: My\n */'); const other = w('wp-content/plugins/my/lib.php', '<?php');
    const out = await findPhpFrameworkEntryPoints(dir, ['symfony', 'wordpress']);
    expect(out).toContain(cmd); expect(out).not.toContain(svc); expect(out).toContain(plugin); expect(out).not.toContain(other);
  });
  it('merges conventional exports', () => {
    w('composer.json', '{"require":{"laravel/framework":"^11"}}');
    const c = getPhpConventionalExports(dir);
    expect(c).toContain('__construct'); expect(c).toContain('boot'); expect(c).not.toContain('getSubscribedEvents');
    expect(matchesPhpConventionalPattern('scopeActive')).toBe(true); expect(matchesPhpConventionalPattern('getFullNameAttribute')).toBe(true); expect(matchesPhpConventionalPattern('getUser')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement** exactly the lists and patterns from spec §4.5 (`fg` with `ignore: ['**/vendor/**', '**/node_modules/**']`; Symfony attribute scan reads `src/**/*.php` through `readSource` and tests `/#\[\s*(?:[\w\\]+\\)?(Route|AsCommand|AsEventListener|AsMessageHandler|AsController|AsTwigFilter|AsTwigFunction)\b/`; WordPress plugin header `/^\s*\*?\s*Plugin Name:/m` on `wp-content/plugins/*/*.php`).
- [ ] **Step 4: Run** the test file + `pnpm type-check`.

---

### Task 15: PHP analyzer, registration, confidence rules, fixture

**Files:**
- Create: `src/analyzer/languages/php/phpAnalyzer.ts`, `test/fixtures/php-laravel-project/**` (see below), `test/unit/analyzer/languages/php/phpAnalyzer.test.ts`
- Modify: `src/analyzer/languages/index.ts` (register), `src/analyzer/decoratorDetector.ts` (`PHP_DI_ATTRIBUTES`, `isPhpDIAttribute(name, userDecorators?)`), `src/analyzer/languages/php/phpExportCollector.ts` (use the real predicate), `src/analyzer/unusedExportDetector.ts` (PHP confidence rules), `src/analyzer/index.ts` (`getPhpConventionalExports`)

**Interfaces:**
- Produces: `class PhpAnalyzer implements LanguageAnalyzer { language = 'php'; extensions = ['.php']; vscodeLanguageIds = ['php']; buildGraph(files, rootDir); findEntryPoints(rootDir); dispose() }`; `isPhpDIAttribute(name: string, userDecorators: string[] = []): boolean` recognising `Injectable, Inject, Autowire, AsService, Service, Singleton, Bind, Autoconfigure, AsDecorator, Lazy, Transient, Scoped` plus user names.

Fixture `test/fixtures/php-laravel-project/`:
```
composer.json                      {"require":{"laravel/framework":"^11"},"autoload":{"psr-4":{"App\\":"app/"}}}
public/index.php                   <?php require __DIR__.'/../bootstrap/app.php';
bootstrap/app.php                  <?php use App\Providers\AppServiceProvider; new AppServiceProvider();
routes/web.php                     <?php use App\Http\Controllers\UserController; Route::get('/u', [UserController::class, 'index']); Route::get('/l', 'App\Http\Controllers\UserController@legacy');
app/Providers/AppServiceProvider.php   namespace App\Providers; class AppServiceProvider { public function boot() {} public function register() {} }
app/Http/Controllers/UserController.php namespace App\Http\Controllers; use App\Models\User; use App\Services\Mailer; class UserController { public function index(Mailer $m) { $m->send(); return User::query(); } public function legacy() {} public function orphanAction() {} private function helper() {} }
app/Models/User.php                namespace App\Models; class User { public static function query() {} public function scopeActive($q) {} public function getFullNameAttribute() {} public function unusedModelMethod() {} }
app/Services/Mailer.php            namespace App\Services; class Mailer { public function send() { $this->format(); } private function format() {} private function deadPrivate() {} public function __toString() {} }
app/Services/Orphan.php            namespace App\Services; class Orphan { public function nothing() {} }
resources/views/home.blade.php     <h1>Hi</h1>
```

- [ ] **Step 1: Failing test** (`phpAnalyzer.test.ts`, through `analyze()` on the fixture, files from `fg('**/*.php', { cwd: fixture, absolute: true })`, entry points from `new PhpAnalyzer().findEntryPoints(fixture)`):
```ts
  const names = (arr: { exportName?: string; symbolName?: string; filePath: string; confidence: string }[]) => arr.map((x) => `${path.basename(x.filePath)}:${x.exportName ?? x.symbolName}:${x.confidence}`);
  expect(r.unusedFiles.map((f) => path.basename(f.filePath))).toEqual(['Orphan.php']);
  const exps = names(r.unusedExports);
  expect(exps).toContain('UserController.php:orphanAction:medium');
  expect(exps).toContain('User.php:unusedModelMethod:medium');
  expect(exps).toContain('Orphan.php:Orphan:medium');
  expect(exps).toContain('User.php:scopeActive:low');           // conventional pattern
  expect(exps).toContain('User.php:getFullNameAttribute:low');
  expect(exps).toContain('Mailer.php:__toString:low');          // magic
  for (const ok of ['index', 'legacy', 'send', 'query', 'boot', 'register', 'AppServiceProvider', 'UserController', 'User', 'Mailer']) expect(exps.find((e) => e.includes(`:${ok}:`))).toBeUndefined();
  const locals = names(r.unusedLocals);
  expect(locals).toContain('Mailer.php:deadPrivate:high');
  expect(locals).toContain('UserController.php:helper:high');
  expect(locals.find((l) => l.includes(':format:'))).toBeUndefined();
```
Also unit-test `isPhpDIAttribute('AsService')` → true, `isPhpDIAttribute('Route')` → false, user list honoured.

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement**
  - `phpAnalyzer.ts` mirrors `JavaAnalyzer`: `ctx = { index: buildClassIndex(files), autoload: loadComposerAutoload(rootDir) }`; per file: `content = readSource(f)`, imports/exports/locals; `buildGraphFromFileNodes(fileMap)`. `findEntryPoints` = `findPhpFrameworkEntryPoints(rootDir, detectPhpFrameworks(rootDir))`.
  - `languages/index.ts`: `analyzers.set('php', new PhpAnalyzer())`.
  - `decoratorDetector.ts`: `export const PHP_DI_ATTRIBUTES = [...]` and `isPhpDIAttribute`.
  - `unusedExportDetector.determineConfidence`: before the `.tsx` rules add
    ```ts
    if (filePath.endsWith('.php')) {
      if (/\/tests\//.test(filePath) || /Test\.php$/.test(filePath) || /\.spec\.php$/.test(filePath) || /\.blade\.php$/.test(filePath)) return 'low';
      if (PHP_MAGIC_METHODS.includes(exportInfo.name) || matchesPhpConventionalPattern(exportInfo.name)) return 'low';
    }
    ```
  - `index.ts`: `...getPhpConventionalExports(options.rootDir)` in `frameworkExports`.
- [ ] **Step 4: Run** `pnpm vitest run test/unit/analyzer/languages/php test/unit/analyzer/memberUsage.test.ts` + `pnpm type-check && pnpm lint`.

---

### Task 16: Accuracy fixtures, end-to-end assertions, dogfooding, docs check

**Files:**
- Create: `test/fixtures/sfc-project/**`, `test/fixtures/monorepo-project/**`, `test/fixtures/cjs-project/**`, `test/fixtures/barrel-project/**`, `test/integration/accuracy.test.ts`
- Modify: `test/integration/pipeline.test.ts` only if counts changed by design (nested locals, parameters)

Fixtures (each a minimal project with a `package.json` `main` so entry detection works; contents are the synthetic cases from the 2026-08-28 assessment):

- `barrel-project`: `src/index.ts` imports `{ used }` from `./barrel`; `barrel.ts` = `export * from './star-target'; export { used } from './named-target'; export { neverImported } from './named-target2';`; `star-target.ts` exports `starDeadA`, `starDeadB`; `named-target.ts` exports `used`, `alsoDead`; `named-target2.ts` exports `neverImported`; `dead-cluster-a.ts`/`dead-cluster-b.ts` import each other; `nested.ts` (nested arrow/callback locals, private members); `writeonly.ts`; `dyn.ts` + `locales/en.ts`; `worker-host.ts` + `worker.ts`; `params.ts`.
  Expected: unused exports ⊇ `{starDeadA, starDeadB, alsoDead, neverImported(low), a(low), b(low), useA(low)}`; unused files ⊇ `{named-target2.ts(low), dead-cluster-a.ts(low), dead-cluster-b.ts(low)}`; unused files ∌ `{locales/en.ts, worker.ts}`; unused locals ⊇ `{unusedInNested(high), unusedInCallback(high), unusedField(medium), unusedPrivate(high), req(medium)}` and ∌ `{err}`.
- `cjs-project`: `index.js` = `const { cjsFn } = require('./cjs'); cjsFn();`; `cjs.js` = `module.exports = { cjsFn: () => 1, cjsDead: () => 2 };` Expected unused exports = `[cjsDead]`.
- `sfc-project`: `src/main.ts` imports `./App.vue`; `App.vue` imports `./Comp.vue` + `./vue-util`; `Comp.vue` uses `count` only in template; `vue-util.ts` exports `vueHelper`, `vueDead`; `index.html` with `<script type="module" src="/src/main.ts">` and `package.json` with `vue` dep and no `main`. Expected: unused files = `[]`, unused exports = `[vueDead]`, unused locals = `[]`.
- `monorepo-project`: root `package.json` `{"workspaces":["packages/*"]}`; `packages/a` and `packages/b` each with `package.json` (`main: src/index.ts`), `tsconfig.json` (`paths` `@a/*` / `@b/*`), `src/index.ts` importing `@x/util`, `src/util.ts` exporting one used and one dead symbol; `packages/b/src/index.ts` also imports `{ x } from '@ws/a'` where `node_modules/@ws/a` is a symlink created **by the test at runtime** (git does not store it) to `packages/a`. Expected: unused files = `[]`, unused exports = `[aDead, bDead]`.

- [ ] **Step 1: Write `accuracy.test.ts`** — one `describe` per fixture: files via `scanFiles({ rootDir, include: DEFAULT_INCLUDE_PATTERNS, exclude: DEFAULT_EXCLUDE_PATTERNS })`, entry points via `getAllAnalyzers()` like `runProjectAnalysis`, then the expectations above written as `expect(set).toContain/…` with `[name, confidence]` tuples.
- [ ] **Step 2: Run, fix any failures at their root** (a failing expectation here means a task above is incomplete — fix the task's module, not the expectation).
- [ ] **Step 3: Dogfood**: build the bundle described in memory `dogfood-harness` (or reuse the scratchpad script) and run the analyzer on this repository. Expected: `src/extension.ts` is an entry point (no longer reported), `fileWatcher.ts` is reported as unused (`low`, via the unused barrel export) or `medium`, `activate/deactivate` not reported, analysis of the repo completes in under 5 s.
- [ ] **Step 4: Full verification**: `pnpm test` (all files), `pnpm type-check`, `pnpm lint`, `pnpm build`. Fix everything. Update CHANGELOG counts (`N new tests`).

---

## Self-review notes

- Spec §2.1–§2.11 → Tasks 1–9; §3 → Task 8 + 9; §4 → Tasks 10–15; §5 → every task's Step 1 plus Task 16.
- `collectImports(sourceFile, program, rootDir?)` is introduced in Task 2 (call site) and Task 4 (behaviour); Task 2 must add the optional parameter as a no-op if executed first.
- `MEMBER_USAGE_SENTINEL` is consumed by `unusedExportDetector` (Task 3) — import it from `memberUsage.ts`, not redefine.
- `isPhpDIAttribute` lands in Task 15; Task 11 uses a local stub until then and Task 15 replaces it.
