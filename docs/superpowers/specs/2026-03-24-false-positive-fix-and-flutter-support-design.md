# False Positive Fix & Flutter/Dart Support — Design Spec

**Date**: 2026-03-24
**Status**: Approved
**Version**: 1.1 (post-review)

---

## 1. Overview

Fix 5 root causes of false positives identified from real-world testing (Kurly Balance, 847 files, 276 reported unused exports with >60% false positive rate), and add Flutter/Dart language support.

### Implementation Strategy

**Phase A**: Independent, incremental fixes following PRD priority order. Re-export propagation (R-1) and internal reference tracking (R-2) are implemented in the common graph layer so all languages benefit automatically.

**Phase B** (post-A): Architectural refactoring to make re-export propagation and internal references first-class concepts in the graph builder.

### Success Criteria

| Metric | Current | Target |
|---|---|---|
| Unused export reports (Kurly Balance) | 276 | <100 (true positives) |
| False positive rate | ~60% | <10% |
| Barrel file false positives | ~84 | 0 |
| DTO internal reference false positives | ~30 | 0 |
| Analysis time increase | baseline 7.4s | <15s (2x) |

---

## 2. R-3: Path Alias Resolution Enhancement

**Priority**: 1st (broadest false positive source, ~50+ items)
**Scope**: TypeScript only

### Problem

`@/src/...` path alias imports fail to resolve when `ts.resolveModuleName()` doesn't handle the tsconfig `paths`/`baseUrl` correctly, especially with `extends` chains to external packages (e.g., `expo/tsconfig.base`).

### Changes

#### `programFactory.ts`

- Ensure `extends` chain is fully resolved including node_modules packages
- After `ts.parseJsonConfigFileContent()`, verify that `paths` and `baseUrl` are present in the resolved options
- If missing, manually walk the `extends` chain and merge `paths`/`baseUrl`

#### `importCollector.ts`

Add new fallback step. **Important**: In the current code, non-relative paths that fail TS resolution hit an early return that treats them as external modules (line ~206-209). The new fallback must be inserted BEFORE this early return:

```
Resolution order:
1. ts.resolveModuleName() (existing — handles paths if tsconfig is correct)
2. NEW: resolveWithPathAlias(moduleName, paths, baseUrl) — BEFORE "non-relative = external" early return
3. "non-relative = external" early return (existing, now only reached if step 2 also fails)
4. resolvePathManually() (existing — relative path fallback)
```

**`resolveWithPathAlias(moduleName, paths, baseUrl)`**:
- Iterate over `paths` entries (e.g., `{"@/*": ["./*"]}`)
- Match module name against pattern prefix (e.g., `@/` matches `@/*`)
- Replace prefix with mapping, resolve against `baseUrl`
- Try extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.tsx`, `/index.js`
- Return first match found on filesystem

### Tests

- `paths: {"@/*": ["./*"]}` + `baseUrl: "."` resolves `@/src/foo`
- `extends: "expo/tsconfig.base"` inherits paths correctly
- Existing path alias tests pass (regression)

---

## 3. R-1: Named Re-export Usage Propagation

**Priority**: 2nd (~84 false positives)
**Scope**: TypeScript, Python (via common layer)

### Problem

When `import { IconDinner } from '@/assets/icons'` uses a barrel file that has `export { default as IconDinner } from './IconDinner'`, usage is recorded only for `index.ts::IconDinner`, not propagated to `IconDinner.tsx::default`.

`resolveStarReExport()` only traces `export * from` chains, not named re-exports.

### Prerequisite: Type Changes

**`types/graph.ts`** — Add `originalName` field to `ExportInfo`:
```typescript
interface ExportInfo {
  // ... existing fields ...
  originalName?: string;  // NEW: original name before aliasing in re-exports
}
```

This must be done FIRST as R-1 depends on it.

### Changes

#### `exportCollector.ts` — Capture `originalName` and resolve `reExportSource`

For aliased re-exports, capture the original name via `element.propertyName?.text`:
- `export { default as X } from './Y'` → `name: 'X'`, `originalName: 'default'` (propertyName = 'default')
- `export { Foo as Bar } from './Y'` → `name: 'Bar'`, `originalName: 'Foo'` (propertyName = 'Foo')
- `export { X } from './Y'` → `name: 'X'`, `originalName: undefined` (no aliasing)

**Critical**: Currently `reExportSource` stores the raw module specifier (e.g., `'./IconDinner'`), NOT a resolved absolute path. Since `exportUsages` keys use absolute paths, propagation would silently fail. Two options:

- **Option A (chosen)**: Resolve `reExportSource` to absolute path during collection by passing the `program` to `collectExports()` and using the same resolution logic as `importCollector.ts`.
- **Option B**: Resolve during propagation by looking up the file's imports to find the resolved path for a given specifier. More complex, less reliable.

#### `analyzer/index.ts` — Run propagation on merged graph

**Important**: `propagateReExportUsage()` runs in `analyzer/index.ts` AFTER `mergeGraphInto()` completes, operating on `mergedGraph.exportUsages` and `mergedGraph.files`. This ensures it works for ALL languages (TypeScript via `dependencyGraph.ts` AND Python/Go/Java via `graphBuilder.ts`) without duplicating logic in two places.

#### New function: `propagateReExportUsage()`

```typescript
function propagateReExportUsage(
  exportUsages: Map<string, Set<string>>,
  fileMap: Map<string, FileNode>
): void {
  let changed = true;
  const maxIterations = 10; // safety limit for deep chains
  let iteration = 0;

  while (changed && iteration < maxIterations) {
    changed = false;
    iteration++;

    for (const [filePath, fileNode] of fileMap) {
      for (const exp of fileNode.exports) {
        if (!exp.isReExport || !exp.reExportSource) continue;

        const reExportKey = makeExportKey(filePath, exp.name);
        const usages = exportUsages.get(reExportKey);
        if (!usages || usages.size === 0) continue;

        // Determine original export name
        // "export { default as X } from './Y'" → originalName = 'default'
        // "export { X } from './Y'" → originalName = 'X'
        const originalName = exp.originalName || exp.name;
        const sourceKey = makeExportKey(exp.reExportSource, originalName);

        let sourceUsages = exportUsages.get(sourceKey);
        if (!sourceUsages) {
          sourceUsages = new Set();
          exportUsages.set(sourceKey, sourceUsages);
        }

        const prevSize = sourceUsages.size;
        for (const user of usages) {
          sourceUsages.add(user);
        }
        if (sourceUsages.size > prevSize) {
          changed = true; // propagate further in next iteration
        }
      }
    }
  }
}
```

#### `dependencyGraph.ts`

No changes needed — propagation runs in `analyzer/index.ts` after merge.

#### Python Impact

Python `__init__.py` files with `from .module import X` are already collected with `isReExport: true`. The common `propagateReExportUsage()` in `graphBuilder.ts` handles them automatically.

#### Go/Java Impact

No re-export patterns in these languages. No changes needed.

### Tests

- Barrel `export { X } from './X'` → usage propagated to source
- `export { default as X } from './Y'` → default usage propagated
- Multi-level chain A→B→C propagation
- Circular re-export → no infinite loop (maxIterations guard)
- Python `__init__.py` re-export propagation

---

## 4. R-2: Same-File Export Reference Tracking

**Priority**: 3rd (~30 false positives)
**Scope**: All languages

### Problem

Exported types/functions used only within the same file (as field types, parameters, etc.) are reported as unused because the detector only counts cross-file imports.

### Changes

#### Execution Model

`detectUnusedExports()` currently only receives `graph`, `entryPoints`, and `frameworkConventionalExports` — it has no access to `ts.Program`, `ts.SourceFile`, or `ts.TypeChecker`. The internal reference analysis runs as a **pre-pass in `analyzer/index.ts`** that mutates `exportUsages` BEFORE `detectUnusedExports()` is called:

```typescript
// analyzer/index.ts — after building mergedGraph, before detection
if (tsProgram) {
  analyzeInternalReferences(mergedGraph, tsProgram);  // mutates exportUsages
}
markInternalReferencesRegex(mergedGraph);  // regex-based for all languages
// Then proceed to detectUnusedExports(mergedGraph, ...)
```

#### TypeScript: `analyzeInternalReferences()` (new function)

Use Type Checker to find same-file references. Placed in a new file or in `unusedExportDetector.ts`:

```typescript
function analyzeInternalReferences(
  fileNode: FileNode,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  exportUsages: Map<string, Set<string>>
): void {
  const exportNames = new Set(fileNode.exports.map(e => e.name));

  for (const exp of fileNode.exports) {
    // Skip if already has external usage
    const key = makeExportKey(fileNode.path, exp.name);
    const usages = exportUsages.get(key);
    if (usages && usages.size > 0) continue;

    // Find the declaration node for this export
    const symbol = findExportSymbol(exp, sourceFile, checker);
    if (!symbol) continue;

    // Count references in same file, excluding the declaration itself
    const refCount = countSameFileReferences(symbol, sourceFile, checker);
    if (refCount > 0) {
      // Check if any referencing export is externally used
      if (hasExternallyUsedReferrer(exp, fileNode, sourceFile, checker, exportUsages)) {
        // Mark as internally used — add self-reference to prevent unused detection
        if (!usages) {
          exportUsages.set(key, new Set([fileNode.path]));
        } else {
          usages.add(fileNode.path);
        }
      }
    }
  }
}
```

Key rule: An export is "internally used" only if it's referenced by another export that IS externally used. This prevents marking truly unused exports as used just because they reference each other.

#### Python/Go/Java/Dart: `markInternalReferencesRegex()` — Regex-based internal reference

Runs for ALL languages (including TypeScript files not covered by the checker-based pass).

```typescript
function markInternalReferencesRegex(
  graph: DependencyGraph
): void {
  for (const [filePath, fileNode] of graph.files) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const externallyUsed = new Set<string>();

    // Find which exports have external usage
    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) externallyUsed.add(exp.name);
    }

    if (externallyUsed.size === 0) continue; // no anchor — skip file

    // Strip comments and string literals to avoid false matches
    const strippedContent = stripCommentsAndStrings(fileContent);

    for (const exp of fileNode.exports) {
      const key = makeExportKey(filePath, exp.name);
      const usages = graph.exportUsages.get(key);
      if (usages && usages.size > 0) continue; // already used

      // Skip short names (≤2 chars) — too many false matches
      if (exp.name.length <= 2) continue;

      // Count occurrences in stripped content (excluding declaration line)
      const regex = new RegExp(`\\b${escapeRegex(exp.name)}\\b`, 'g');
      const matches = strippedContent.match(regex);
      const refCount = (matches?.length || 0) - 1; // subtract declaration

      if (refCount > 0) {
        if (!usages) {
          graph.exportUsages.set(key, new Set([filePath]));
        } else {
          usages.add(filePath);
        }
      }
    }
  }
}
```

**Safeguards against false matches**:
- `stripCommentsAndStrings()`: Remove single/multi-line comments and string literals before matching
- Skip export names ≤2 characters (e.g., `id`, `of`) to avoid noise
- Word boundary (`\b`) matching to prevent substring matches
```

### Tests

- Same-file type field reference → internal usage detected
- Same-file function parameter reference → internal usage detected
- Truly unused export (no references anywhere) → still detected
- Circular reference (A→B→A in same file) → both marked as used

---

## 5. R-4: Property Access Usage Tracking

**Priority**: 5th (~14 false positives)
**Scope**: TypeScript, Python

### Problem

`import KpdsTypo from './KpdsTypo'` then `KpdsTypo.mediumRegular` doesn't mark the named export `mediumRegular` as used.

### Solution: Confidence Downgrade

In `unusedExportDetector.ts`, within `determineConfidence()`:

```typescript
// If default export of same file is used, and this named export
// appears as a shorthand property in the default export object literal,
// downgrade to 'low'
if (isNamedExportIncludedInDefaultObject(exp, fileNode, sourceFile)) {
  return 'low';
}
```

**Detection logic**:
1. Check if the file's `default` export has external usage
2. Find the default export's AST node
3. If it's an object literal expression, check if any property matches the named export name (shorthand or `key: value` where value references the export)
4. If match found → confidence `'low'`

### Python Equivalent

For Python files with `__all__`:
- If `__all__` list is used externally and contains a symbol name, that symbol → confidence `'low'`

### Go/Java

No equivalent pattern. No changes.

### Tests

- Default export object contains named export via shorthand → `'low'` confidence
- Default export is used, named export in object → filtered at medium threshold
- Named export NOT in default object → normal confidence

---

## 6. R-5: Entry Point Pattern Expansion

**Priority**: 4th (5 false positives, low implementation effort)
**Scope**: All languages

### Changes to `frameworkDetector.ts`

#### New "Tooling" Entry Points (framework-agnostic)

```typescript
const TOOLING_ENTRY_PATTERNS = [
  'jest.config.*',
  'jest.setup.*',
  'vitest.config.*',
  'babel.config.*',
  'metro.config.*',
  'webpack.config.*',
  'rollup.config.*',
  'vite.config.*',
  'tailwind.config.*',
  'postcss.config.*',
  '.eslintrc.*',
  '.prettierrc.*',
  'tsconfig.json',
  'next.config.*',
  'app.config.*',
];
```

These are always added to entry points regardless of detected framework.

#### Expo Framework Config Expansion

```typescript
expo: {
  entryPatterns: [
    ...existing,
    'app/**/*.tsx',        // Expo Router file-based routing
    'app/**/*.ts',
    'modules/*/index.ts',  // Expo native modules
    'modules/*/src/*.ts',
  ],
  conventionalExports: [
    ...existing,
    'generateStaticParams',
  ],
}
```

#### Python Additions

```typescript
// pythonFrameworkDetector.ts
const PYTHON_TOOLING_ENTRIES = [
  'conftest.py',
  'setup.cfg',
  'noxfile.py',
  'fabfile.py',
];
// Add pytest plugin hooks to conventional exports
const PYTEST_CONVENTIONAL = ['pytest_configure', 'pytest_collection_modifyitems', ...];
```

#### Go Additions

```typescript
// goFrameworkDetector.ts
// TestMain is already conventional; add build tool configs
const GO_TOOLING_ENTRIES = [
  'tools.go',        // Go tool dependency tracking convention
  'doc.go',          // Package documentation
];
```

#### Java Additions

```typescript
// javaFrameworkDetector.ts
const JAVA_TOOLING_ENTRIES = [
  'src/test/resources/**',
  'src/main/resources/**',
];
```

### Tests

- `jest.config.js` recognized as entry point
- `app/**/*.tsx` under Expo recognized as entry points
- `modules/expo-lifecycle/index.ts` recognized as entry point
- Non-config files not incorrectly marked as entry points

---

## 7. Flutter/Dart Language Support

**Scope**: New language analyzer + framework detector

### File Structure

```
src/analyzer/languages/dart/
├── dartAnalyzer.ts
├── dartImportCollector.ts
├── dartExportCollector.ts
├── dartLocalCollector.ts
├── dartModuleResolver.ts
└── dartFrameworkDetector.ts

test/
├── unit/analyzer/languages/dart/
│   ├── dartImportCollector.test.ts
│   ├── dartExportCollector.test.ts
│   ├── dartLocalCollector.test.ts
│   ├── dartModuleResolver.test.ts
│   └── dartFrameworkDetector.test.ts
└── fixtures/dart-project/
    ├── pubspec.yaml
    ├── lib/
    │   ├── main.dart
    │   ├── app.dart
    │   └── src/
    │       ├── models/user.dart
    │       ├── widgets/custom_button.dart
    │       └── utils/helpers.dart
    └── test/
        └── widget_test.dart
```

### 7.1 Language Registration

**`types/language.ts`**: Add `'dart'` to `SupportedLanguage` union

**`languages/index.ts`**: Map `.dart` → `'dart'`, register `DartAnalyzer`

**Wider impact of `SupportedLanguage` change**: Update all places that switch/match on this type:
- `groupFilesByLanguage()` in `languages/index.ts` — add `.dart` extension mapping
- `getAnalyzer()` in `languages/index.ts` — register `DartAnalyzer` instance
- `unusedExportDetector.ts` confidence rules — add Dart-specific patterns
- `unusedLocalDetector.ts` confidence rules — add Dart-specific patterns
- VS Code language ID mapping in extension activation

### 7.2 dartImportCollector.ts

**Dart import patterns** (regex-based):

```
import 'package:flutter/material.dart';           → external
import 'package:my_app/src/models/user.dart';     → internal (same package)
import '../widgets/custom_button.dart';            → relative
import 'utils.dart';                               → relative (same dir)
import 'foo.dart' as foo;                          → namespace
import 'bar.dart' show Bar, Baz;                   → selective
import 'bar.dart' hide internalFn;                 → hide (treat as namespace)
export 'src/models.dart';                          → re-export (all)
export 'src/utils.dart' show formatDate;           → re-export (selective)
```

**Resolution rules**:
1. `dart:*` → external SDK, skip
2. `package:<name>/*` where `<name>` matches `pubspec.yaml` name → resolve to `lib/` directory
3. `package:<other>/*` → external package, skip
4. Relative path → resolve against containing file directory
5. Extension: Dart always uses `.dart` explicitly, no extension guessing needed

**Specifiers** (maps to existing `ImportInfo`/`ImportSpecifier` structures):
- No `show`/`hide` → `isNamespaceImport: true`, specifiers: `[]`
- `show X, Y` → `isNamespaceImport: false`, specifiers: `[{name: 'X', isDefault: false, isNamespace: false}, {name: 'Y', ...}]`
- `hide X` → `isNamespaceImport: true`, specifiers: `[]` (treat as namespace for simplicity; hide list is not tracked)
- `as foo` → `isNamespaceImport: true`, specifiers: `[{name: 'foo', isNamespace: true}]` (alias tracked at specifier level, matching existing `ImportSpecifier.alias` pattern)

### 7.3 dartExportCollector.ts

**Dart export/visibility rules**:
- `_` prefix → private (file-scoped) → NOT an export
- No `_` prefix, top-level → public → IS an export

**Collected declarations** (regex):
```
class ClassName                    → kind: 'class'
mixin MixinName                    → kind: 'class' (treat as class)
enum EnumName                      → kind: 'enum'
extension ExtensionName            → kind: 'class'
typedef TypedefName                → kind: 'type'
ReturnType functionName(...)       → kind: 'function'
var/final/const variableName       → kind: 'variable'
Type variableName                  → kind: 'variable'

export 'path.dart' [show/hide]     → isReExport: true, reExportSource: resolved path
```

**`part`/`part of` handling**:
- Files with `part of` directive are NOT standalone — they belong to their parent library
- Treat as part of the parent file (merge into parent's file node)
- `part 'file.dart'` in parent → include file in parent's scope
- **Unused file detector protection**: `part of` files are excluded from the file list passed to analyzers (filtered in `classifyDartFiles()`), so they won't appear as "unused files". Their symbols are merged into the parent library's `FileNode` instead.

### 7.4 dartLocalCollector.ts

**Private symbols** (`_` prefix at top-level):
```
class _PrivateClass               → local, kind: 'class'
_privateFunction(...)             → local, kind: 'function'
var _privateVar                   → local, kind: 'variable'
```

**Reference counting**: Regex-based, count occurrences of `_symbolName` in same file minus declaration.

**Method-level locals**: Not tracked in initial version (would require Dart AST parser). Only top-level private symbols.

### 7.5 dartModuleResolver.ts

```typescript
function resolveDartImport(
  importPath: string,
  containingFile: string,
  rootDir: string,
  packageName: string  // from pubspec.yaml
): string | undefined {
  // 1. dart: SDK imports → external
  if (importPath.startsWith('dart:')) return undefined;

  // 2. package: imports
  if (importPath.startsWith('package:')) {
    const parts = importPath.replace('package:', '').split('/');
    const pkgName = parts[0];

    if (pkgName === packageName) {
      // Internal package import → lib/ directory
      const relativePath = parts.slice(1).join('/');
      return path.resolve(rootDir, 'lib', relativePath);
    }
    // External package → skip
    return undefined;
  }

  // 3. Relative imports
  const dir = path.dirname(containingFile);
  return path.resolve(dir, importPath);
}

function getPackageName(rootDir: string): string | undefined {
  // Parse pubspec.yaml for 'name:' field
}
```

### 7.6 dartFrameworkDetector.ts

**Detection**: Check `pubspec.yaml` for `flutter` in dependencies.

**Flutter Framework Config**:
```typescript
{
  name: 'flutter',
  detection: pubspec.yaml contains 'flutter:' in dependencies,
  entryPatterns: [
    'lib/main.dart',
    'lib/app.dart',
    'test/**/*_test.dart',
    'integration_test/**/*.dart',
    'lib/firebase_options.dart',
    'lib/generated/**/*.dart',
    'lib/l10n/*.dart',
  ],
  ignorePatterns: [
    '*.g.dart',           // json_serializable, built_value
    '*.freezed.dart',     // freezed
    '*.gr.dart',          // auto_route
    '*.config.dart',      // injectable
    '*.mocks.dart',       // mockito
  ],
  conventionalExports: [
    // Widget lifecycle
    'build', 'createState', 'dispose', 'initState',
    'didChangeDependencies', 'didUpdateWidget', 'deactivate', 'reassemble',
    // Serialization
    'toJson', 'fromJson', 'fromMap', 'toMap', 'copyWith',
    // Factory patterns
    'of', 'builder',
    // Routing
    'route', 'routeName', 'path',
    // State management (Provider/Riverpod/Bloc)
    'mapEventToState', 'watch', 'read', 'select',
    // Testing
    'setUp', 'tearDown', 'setUpAll', 'tearDownAll', 'main',
  ],
}
```

**Confidence rules in `unusedExportDetector.ts`**:
- `*.g.dart`, `*.freezed.dart` etc. → add to ignore patterns (generated code)
- Dart test files (`*_test.dart`, `test/`) → `'low'`
- Widget subclass methods matching lifecycle names → `'low'`
- Riverpod providers (`*Provider`, `*Notifier`) → `'low'`

### 7.7 dartAnalyzer.ts

```typescript
class DartAnalyzer implements LanguageAnalyzer {
  readonly language = 'dart' as SupportedLanguage;
  readonly extensions = ['.dart'];
  readonly vscodeLanguageIds = ['dart'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const packageName = getPackageName(rootDir);
    const fileMap = new Map<string, FileNode>();

    // Separate part files from library files
    const { libraries, parts } = classifyDartFiles(files);

    for (const file of libraries) {
      const content = fs.readFileSync(file, 'utf-8');
      const imports = collectDartImports(content, file, rootDir, packageName);
      const exports = collectDartExports(content, file);
      const locals = collectDartLocals(content, file);

      // Merge part file symbols into this library
      const partFiles = findPartFiles(content, file);
      for (const partFile of partFiles) {
        if (parts.has(partFile)) {
          mergePartIntoLibrary(exports, locals, partFile);
        }
      }

      fileMap.set(file, { imports, exports, locals });
    }

    return buildGraphFromFileNodes(fileMap);
  }

  async findEntryPoints(rootDir: string): Promise<string[]> {
    const entries: string[] = [];
    // pubspec.yaml → lib/main.dart
    // Flutter framework entries
    const framework = detectDartFramework(rootDir);
    if (framework) {
      entries.push(...await findDartFrameworkEntryPoints(rootDir, framework));
    }
    // Common Dart entries
    entries.push(...findCommonDartEntries(rootDir));
    return entries;
  }

  dispose(): void { /* no-op */ }
}
```

---

## 8. Orchestrator Changes (`analyzer/index.ts`)

- Import and register `DartAnalyzer`
- Add `getDartConventionalExports()` to the framework exports merge
- Add Dart generated file patterns to default ignore patterns when Flutter detected

---

## 9. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-1 | R-2 internal reference analysis stays within 2x total analysis time |
| NF-2 | Existing `@dead-code-ignore` and `ignorePatterns` behavior unchanged |
| NF-3 | Python, Go, Java analysis unaffected negatively |
| NF-4 | All changes have unit tests |
| NF-5 | Existing 359+ tests continue to pass |

---

## 10. Implementation Order

| Step | Work | Files | Language Scope |
|---|---|---|---|
| 1 | R-3 Path Alias | programFactory.ts, importCollector.ts | TS |
| 2a | R-1 Prerequisite: Add `originalName` to `ExportInfo` | types/graph.ts | All |
| 2b | R-1 Capture originalName + resolve reExportSource | exportCollector.ts | TS |
| 2c | R-1 Re-export propagation in orchestrator | analyzer/index.ts (new `propagateReExportUsage()`) | TS, Python |
| 3a | R-2 TS internal references (pre-pass with TypeChecker) | analyzer/index.ts, new `internalReferenceAnalyzer.ts` | TS |
| 3b | R-2 Regex-based internal references | analyzer/index.ts (new `markInternalReferencesRegex()`) | All |
| 4 | R-5 Entry Points | frameworkDetector.ts, language FDs | All |
| 5 | R-4 Property Access | unusedExportDetector.ts | TS, Python |
| 6 | Flutter/Dart Support | 6 new files + registration + type updates | Dart |
| 7 | Phase B Refactoring | graphBuilder.ts architecture | All |
