# False Positive Fix & Flutter/Dart Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 root causes of false positives in dead code detection and add Flutter/Dart language support.

**Architecture:** Incremental fixes applied in priority order (R-3 → R-1 → R-2 → R-5 → R-4 → Dart). Re-export propagation and internal reference analysis are placed in the orchestrator (`analyzer/index.ts`) to benefit all languages. Dart analyzer follows the existing Go/Java/Python pattern (regex-based parsing, `LanguageAnalyzer` interface).

**Tech Stack:** TypeScript, Vitest, TypeScript Compiler API (`ts.resolveModuleName`, `ts.TypeChecker`), regex parsing for Dart/Python/Go/Java

**Spec:** `docs/superpowers/specs/2026-03-24-false-positive-fix-and-flutter-support-design.md`

---

## File Map

### Modified Files

| File | Changes |
|---|---|
| `src/types/graph.ts` | Add `originalName?: string` to `ExportInfo` |
| `src/types/language.ts` | Add `'dart'` to `SupportedLanguage` |
| `src/analyzer/importCollector.ts` | Add `resolveWithPathAlias()` fallback before "non-relative = external" early return |
| `src/analyzer/programFactory.ts` | Ensure `extends` chain resolves paths/baseUrl from external packages (e.g., `expo/tsconfig.base`); expose resolved config |
| `src/analyzer/exportCollector.ts` | Capture `originalName` via `element.propertyName?.text`; resolve `reExportSource` to absolute path |
| `src/analyzer/index.ts` | Add `propagateReExportUsage()`, `analyzeInternalReferences()`, `markInternalReferencesRegex()` pre-passes; register Dart; add tooling entry points |
| `src/analyzer/unusedExportDetector.ts` | Add Dart confidence patterns; add `isNamedExportIncludedInDefaultObject()` for R-4 |
| `src/analyzer/unusedLocalDetector.ts` | Add Dart confidence patterns |
| `src/analyzer/frameworkDetector.ts` | Add tooling entry patterns; expand Expo config; add Flutter framework |
| `src/analyzer/unusedLocalDetector.ts` | Add Dart confidence patterns (Dart test files, generated files) |
| `src/analyzer/languages/index.ts` | Register `.dart` extension and `DartAnalyzer` |
| `src/analyzer/languages/python/pythonFrameworkDetector.ts` | Add tooling entries and pytest conventionals |
| `src/analyzer/languages/go/goFrameworkDetector.ts` | Add tooling entries |
| `src/analyzer/languages/java/javaFrameworkDetector.ts` | Add tooling entries |

### New Files

| File | Purpose |
|---|---|
| `src/analyzer/languages/dart/dartAnalyzer.ts` | `LanguageAnalyzer` implementation for Dart |
| `src/analyzer/languages/dart/dartImportCollector.ts` | Collect Dart imports (package:, relative, export directives) |
| `src/analyzer/languages/dart/dartExportCollector.ts` | Collect Dart public symbols and re-exports |
| `src/analyzer/languages/dart/dartLocalCollector.ts` | Collect `_`-prefixed private symbols |
| `src/analyzer/languages/dart/dartModuleResolver.ts` | Resolve package: URIs and relative imports |
| `src/analyzer/languages/dart/dartFrameworkDetector.ts` | Detect Flutter framework from pubspec.yaml |
| `test/unit/analyzer/pathAliasResolution.test.ts` | Tests for R-3 path alias fallback |
| `test/unit/analyzer/reExportPropagation.test.ts` | Tests for R-1 re-export usage propagation |
| `test/unit/analyzer/internalReferences.test.ts` | Tests for R-2 same-file export references |
| `test/unit/analyzer/propertyAccess.test.ts` | Tests for R-4 property access confidence |
| `test/unit/analyzer/entryPoints.test.ts` | Tests for R-5 tooling/framework entry points |
| `test/unit/analyzer/languages/dart/dartImportCollector.test.ts` | Dart import tests |
| `test/unit/analyzer/languages/dart/dartExportCollector.test.ts` | Dart export tests |
| `test/unit/analyzer/languages/dart/dartLocalCollector.test.ts` | Dart local tests |
| `test/unit/analyzer/languages/dart/dartModuleResolver.test.ts` | Dart module resolver tests |
| `test/unit/analyzer/languages/dart/dartFrameworkDetector.test.ts` | Flutter framework detector tests |
| `test/fixtures/dart-project/` | Dart test fixture project |

---

## Task 1: R-3 — Path Alias Resolution Enhancement

**Files:**
- Modify: `src/analyzer/importCollector.ts:184-213`
- Modify: `src/analyzer/programFactory.ts:63-112`
- Create: `test/unit/analyzer/pathAliasResolution.test.ts`

- [ ] **Step 1: Write failing test for path alias fallback**

```typescript
// test/unit/analyzer/pathAliasResolution.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { collectImports } from '../../../src/analyzer/importCollector';

describe('path alias resolution fallback', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-alias-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createProgram(files: string[], tsconfigPath?: string): ts.Program {
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };

    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(tsconfigPath)
        );
        compilerOptions = parsed.options;
      }
    }

    return ts.createProgram(files, compilerOptions);
  }

  it('should resolve @/ alias when ts.resolveModuleName fails', () => {
    // Create project structure
    const srcDir = path.join(tempDir, 'src');
    const dataDir = path.join(srcDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // tsconfig with @/* -> ./* mapping
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
      },
    }));

    // Target file
    fs.writeFileSync(path.join(srcDir, 'data', 'MealDTO.ts'),
      'export type MealDTO = { name: string };'
    );

    // Source file using alias
    const mainFile = path.join(srcDir, 'main.ts');
    fs.writeFileSync(mainFile,
      "import { MealDTO } from '@/src/data/MealDTO';\nconsole.log({} as MealDTO);"
    );

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram(
      [mainFile, path.join(srcDir, 'data', 'MealDTO.ts')],
      tsconfigPath
    );
    const sourceFile = program.getSourceFile(mainFile)!;
    const imports = collectImports(sourceFile, program);

    expect(imports).toHaveLength(1);
    // Should resolve to absolute path, NOT remain as '@/src/data/MealDTO'
    expect(imports[0].resolvedPath).toContain('MealDTO');
    expect(imports[0].resolvedPath).not.toBe('@/src/data/MealDTO');
    expect(path.isAbsolute(imports[0].resolvedPath)).toBe(true);
  });

  it('should resolve alias with index file', () => {
    const utilsDir = path.join(tempDir, 'src', 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
      },
    }));

    fs.writeFileSync(path.join(utilsDir, 'index.ts'), 'export const helper = 1;');

    const mainFile = path.join(tempDir, 'src', 'main.ts');
    fs.writeFileSync(mainFile, "import { helper } from '@/src/utils';");

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram(
      [mainFile, path.join(utilsDir, 'index.ts')],
      tsconfigPath
    );
    const sourceFile = program.getSourceFile(mainFile)!;
    const imports = collectImports(sourceFile, program);

    expect(imports).toHaveLength(1);
    expect(imports[0].resolvedPath).toContain('index.ts');
    expect(path.isAbsolute(imports[0].resolvedPath)).toBe(true);
  });

  it('should not resolve actual external modules as aliases', () => {
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
      },
    }));

    const mainFile = path.join(tempDir, 'main.ts');
    fs.writeFileSync(mainFile, "import React from 'react';");

    const tsconfigPath = path.join(tempDir, 'tsconfig.json');
    const program = createProgram([mainFile], tsconfigPath);
    const sourceFile = program.getSourceFile(mainFile)!;
    const imports = collectImports(sourceFile, program);

    expect(imports).toHaveLength(1);
    // Should remain as external module name
    expect(imports[0].resolvedPath).toBe('react');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/pathAliasResolution.test.ts`
Expected: FAIL — first test fails because `@/src/data/MealDTO` is returned as-is (external module)

- [ ] **Step 3: Ensure `programFactory.ts` resolves `extends` chain paths**

In `src/analyzer/programFactory.ts`, the `getCompilerOptions()` function (line 63) uses `ts.parseJsonConfigFileContent()` which should resolve `extends` chains. However, if the extended config is in node_modules (e.g., `extends: "expo/tsconfig.base"`), the host system `ts.sys` may not find it. Add a verification step: after parsing, if `paths` or `baseUrl` are missing but the raw config has `extends`, manually walk the extends chain to merge missing fields. **Note**: `ts.parseJsonConfigFileContent()` handles most `extends` cases correctly — only add manual resolution if the test for external package extends (`expo/tsconfig.base`) fails.

- [ ] **Step 4: Implement `resolveWithPathAlias()` in importCollector.ts**

In `src/analyzer/importCollector.ts`, modify `resolveImportPath()` to add the path alias fallback BEFORE the "non-relative = external" early return (line 206-209):

```typescript
function resolveImportPath(
  importPath: string,
  containingFileDir: string,
  program: ts.Program
): string {
  // 1. Always try TS resolver first (handles path aliases, baseUrl, etc.)
  const compilerOptions = program.getCompilerOptions();
  const resolved = ts.resolveModuleName(
    importPath,
    path.join(containingFileDir, 'dummy.ts'),
    compilerOptions,
    ts.sys
  );

  if (resolved.resolvedModule) {
    if (resolved.resolvedModule.isExternalLibraryImport) {
      return importPath;
    }
    return path.normalize(resolved.resolvedModule.resolvedFileName);
  }

  // 2. NEW: Try path alias resolution manually before giving up on non-relative paths
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    const aliasResolved = resolveWithPathAlias(importPath, compilerOptions);
    if (aliasResolved) {
      return aliasResolved;
    }
    return importPath;
  }

  // 3. Relative path fallback
  return resolvePathManually(importPath, containingFileDir);
}

/**
 * Resolves a module path using tsconfig paths mapping as fallback
 */
function resolveWithPathAlias(
  moduleName: string,
  compilerOptions: ts.CompilerOptions
): string | undefined {
  const paths = compilerOptions.paths;
  const baseUrl = compilerOptions.baseUrl;
  if (!paths || !baseUrl) {
    return undefined;
  }

  for (const [pattern, mappings] of Object.entries(paths)) {
    const starIndex = pattern.indexOf('*');
    if (starIndex === -1) {
      if (moduleName === pattern && mappings.length > 0) {
        const resolved = tryResolveFile(path.resolve(baseUrl, mappings[0]));
        if (resolved) return resolved;
      }
      continue;
    }

    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);

    if (moduleName.startsWith(prefix) && moduleName.endsWith(suffix)) {
      const matchedWildcard = moduleName.slice(
        prefix.length,
        moduleName.length - suffix.length
      );

      for (const mapping of mappings) {
        const mappedPath = mapping.replace('*', matchedWildcard);
        const absolutePath = path.resolve(baseUrl, mappedPath);
        const resolved = tryResolveFile(absolutePath);
        if (resolved) return resolved;
      }
    }
  }

  return undefined;
}

/**
 * Tries to resolve a file path with common TypeScript/JavaScript extensions
 */
function tryResolveFile(basePath: string): string | undefined {
  try {
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
      return basePath;
    }
  } catch {
    // continue
  }

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];
  for (const ext of extensions) {
    const withExt = basePath + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }

  for (const ext of extensions) {
    const indexPath = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/unit/analyzer/pathAliasResolution.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Run all existing tests for regression**

Run: `pnpm vitest run`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add src/analyzer/importCollector.ts src/analyzer/programFactory.ts test/unit/analyzer/pathAliasResolution.test.ts
git commit -m "feat(R-3): add path alias fallback resolution for @/ imports"
```

---

## Task 2: R-1 — ExportInfo `originalName` + resolved `reExportSource`

**Files:**
- Modify: `src/types/graph.ts:24-33`
- Modify: `src/analyzer/exportCollector.ts:8,69-89`
- Create: `test/unit/analyzer/reExportPropagation.test.ts`

- [ ] **Step 1: Add `originalName` to `ExportInfo` interface**

In `src/types/graph.ts`, add to the `ExportInfo` interface:

```typescript
export interface ExportInfo {
  name: string;
  originalName?: string;  // Original name before aliasing in re-exports
  isDefault: boolean;
  isReExport: boolean;
  reExportSource?: string;
  line: number;
  column: number;
  kind: string;
  isTypeOnly: boolean;
}
```

- [ ] **Step 2: Write failing test for originalName capture and re-export propagation**

```typescript
// test/unit/analyzer/reExportPropagation.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import { collectExports } from '../../../src/analyzer/exportCollector';
import { buildDependencyGraph, makeExportKey } from '../../../src/analyzer/dependencyGraph';
import { createProgram } from '../../../src/analyzer/programFactory';

describe('re-export originalName capture', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reexport-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function setupProgram(files: Record<string, string>): ts.Program {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(tempDir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    const filePaths = Object.keys(files).map(f => path.join(tempDir, f));
    return createProgram(filePaths);
  }

  it('should capture originalName for aliased re-exports', () => {
    const program = setupProgram({
      'IconDinner.ts': 'export default function IconDinner() {}',
      'index.ts': "export { default as IconDinner } from './IconDinner';",
    });

    const indexFile = program.getSourceFile(path.join(tempDir, 'index.ts'))!;
    const exports = collectExports(indexFile, program);

    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('IconDinner');
    expect(exports[0].originalName).toBe('default');
    expect(exports[0].isReExport).toBe(true);
    // reExportSource should be resolved to absolute path
    expect(path.isAbsolute(exports[0].reExportSource!)).toBe(true);
    expect(exports[0].reExportSource!).toContain('IconDinner');
  });

  it('should capture originalName for renamed re-exports', () => {
    const program = setupProgram({
      'utils.ts': 'export function originalFn() {}',
      'index.ts': "export { originalFn as renamedFn } from './utils';",
    });

    const indexFile = program.getSourceFile(path.join(tempDir, 'index.ts'))!;
    const exports = collectExports(indexFile, program);

    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('renamedFn');
    expect(exports[0].originalName).toBe('originalFn');
  });

  it('should not set originalName for non-aliased re-exports', () => {
    const program = setupProgram({
      'utils.ts': 'export function helper() {}',
      'index.ts': "export { helper } from './utils';",
    });

    const indexFile = program.getSourceFile(path.join(tempDir, 'index.ts'))!;
    const exports = collectExports(indexFile, program);

    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('helper');
    expect(exports[0].originalName).toBeUndefined();
  });
});

describe('re-export usage propagation (via analyze())', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'propagation-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // NOTE: Tests use analyze() (not buildDependencyGraph directly) because
  // propagateReExportUsage() runs in analyzer/index.ts after graph merge.

  it('should propagate usage from barrel re-export to original default export', async () => {
    // Setup files
    const iconsDir = path.join(tempDir, 'icons');
    fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(path.join(iconsDir, 'IconDinner.tsx'), 'export default function IconDinner() { return null; }');
    fs.writeFileSync(path.join(iconsDir, 'index.ts'), "export { default as IconDinner } from './IconDinner';");
    fs.writeFileSync(path.join(tempDir, 'App.tsx'), "import { IconDinner } from './icons';\nconsole.log(IconDinner);");

    const { analyze } = await import('../../../src/analyzer');
    const files = [
      path.join(iconsDir, 'IconDinner.tsx'),
      path.join(iconsDir, 'index.ts'),
      path.join(tempDir, 'App.tsx'),
    ];
    const result = await analyze({ files, rootDir: tempDir, entryPoints: [] });

    // IconDinner.tsx::default should NOT be reported as unused
    const unusedNames = result.unusedExports.map(e => `${e.filePath}::${e.exportName}`);
    expect(unusedNames.some(n => n.includes('IconDinner.tsx') && n.includes('default'))).toBe(false);
  });

  it('should propagate through multi-level re-export chain', async () => {
    fs.mkdirSync(path.join(tempDir, 'deep'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'mid'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'top'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'deep/helper.ts'), 'export function doThing() {}');
    fs.writeFileSync(path.join(tempDir, 'mid/index.ts'), "export { doThing } from '../deep/helper';");
    fs.writeFileSync(path.join(tempDir, 'top/index.ts'), "export { doThing } from '../mid';");
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), "import { doThing } from './top';\ndoThing();");

    const { analyze } = await import('../../../src/analyzer');
    const files = [
      path.join(tempDir, 'deep/helper.ts'),
      path.join(tempDir, 'mid/index.ts'),
      path.join(tempDir, 'top/index.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];
    const result = await analyze({ files, rootDir: tempDir, entryPoints: [] });

    // deep/helper.ts::doThing should NOT be unused
    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('doThing');
  });

  it('should not infinite loop on circular re-exports', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.ts'), "export { b } from './b';\nexport const a = 1;");
    fs.writeFileSync(path.join(tempDir, 'b.ts'), "export { a } from './a';\nexport const b = 2;");
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), "import { a } from './a';\nconsole.log(a);");

    const { analyze } = await import('../../../src/analyzer');
    const files = [
      path.join(tempDir, 'a.ts'),
      path.join(tempDir, 'b.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];

    // Should complete without hanging (maxIterations guard)
    const result = await analyze({ files, rootDir: tempDir, entryPoints: [] });
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/reExportPropagation.test.ts`
Expected: FAIL — `originalName` undefined, `reExportSource` not absolute

- [ ] **Step 4: Modify `exportCollector.ts` to capture `originalName` and resolve `reExportSource`**

In `src/analyzer/exportCollector.ts`:

1. Change function signature to accept `program`:
```typescript
export function collectExports(sourceFile: ts.SourceFile, program?: ts.Program): ExportInfo[] {
```

2. Add imports at top:
```typescript
import * as path from 'path';
import * as fs from 'fs';
```

3. In the named re-export section (lines 74-89), capture `originalName` and resolve `reExportSource`:
```typescript
for (const element of exportDecl.exportClause.elements) {
  const { line, character } =
    sourceFile.getLineAndCharacterOfPosition(element.getStart());

  const hasAlias = element.propertyName !== undefined;
  const originalName = hasAlias ? element.propertyName!.text : undefined;

  let resolvedReExportSource = reExportSource;
  if (program) {
    const compilerOptions = program.getCompilerOptions();
    const resolution = ts.resolveModuleName(
      reExportSource,
      sourceFile.fileName,
      compilerOptions,
      ts.sys
    );
    if (resolution.resolvedModule && !resolution.resolvedModule.isExternalLibraryImport) {
      resolvedReExportSource = path.normalize(resolution.resolvedModule.resolvedFileName);
    } else {
      // Fallback: manual resolution
      const fileDir = path.dirname(sourceFile.fileName);
      const basePath = path.resolve(fileDir, reExportSource);
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];
      for (const ext of extensions) {
        if (fs.existsSync(basePath + ext)) {
          resolvedReExportSource = basePath + ext;
          break;
        }
      }
      if (resolvedReExportSource === reExportSource) {
        for (const ext of extensions) {
          const indexPath = path.join(basePath, `index${ext}`);
          if (fs.existsSync(indexPath)) {
            resolvedReExportSource = indexPath;
            break;
          }
        }
      }
    }
  }

  exports.push({
    name: element.name.text,
    originalName,
    isDefault: false,
    isReExport: true,
    reExportSource: resolvedReExportSource,
    line: line + 1,
    column: character,
    kind: 'unknown',
    isTypeOnly,
  });
}
```

4. Apply the same `resolvedReExportSource` logic for `export * from` and `export * as X from` blocks.

- [ ] **Step 5: Update ALL callers to pass `program` to `collectExports()`**

The `program` parameter is optional, so existing callers without it still compile. But for re-export resolution to work, update the main caller:

In `src/analyzer/dependencyGraph.ts` line 28:
```typescript
const exports = collectExports(sourceFile, program);
```

Also check `test/unit/analyzer/exportCollector.test.ts` — existing tests call `collectExports(sourceFile)` without program. These should still pass since `program` is optional. Tests that verify `reExportSource` resolution should pass `program`.

- [ ] **Step 6: Implement `propagateReExportUsage()` in `analyzer/index.ts`**

Add after the graph merge loop in `analyze()`:

```typescript
/**
 * Propagates export usage from re-exports to their original source files.
 */
function propagateReExportUsage(graph: DependencyGraph): void {
  let changed = true;
  const maxIterations = 10;
  let iteration = 0;

  while (changed && iteration < maxIterations) {
    changed = false;
    iteration++;

    for (const [filePath, fileNode] of graph.files) {
      for (const exp of fileNode.exports) {
        if (!exp.isReExport || !exp.reExportSource) continue;

        const reExportKey = makeExportKey(filePath, exp.name);
        const usages = graph.exportUsages.get(reExportKey);
        if (!usages || usages.size === 0) continue;

        const originalName = exp.originalName || exp.name;
        const sourceKey = makeExportKey(exp.reExportSource, originalName);

        let sourceUsages = graph.exportUsages.get(sourceKey);
        if (!sourceUsages) {
          sourceUsages = new Set();
          graph.exportUsages.set(sourceKey, sourceUsages);
        }

        const prevSize = sourceUsages.size;
        for (const user of usages) {
          sourceUsages.add(user);
        }
        if (sourceUsages.size > prevSize) {
          changed = true;
        }
      }
    }
  }
}
```

Call it in `analyze()` after merge loop:
```typescript
propagateReExportUsage(mergedGraph);
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run test/unit/analyzer/reExportPropagation.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Run all tests for regression**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/types/graph.ts src/analyzer/exportCollector.ts src/analyzer/dependencyGraph.ts src/analyzer/index.ts test/unit/analyzer/reExportPropagation.test.ts
git commit -m "feat(R-1): propagate re-export usage to original source files"
```

---

## Task 3: R-2 — Same-File Export Internal Reference Tracking

**Files:**
- Modify: `src/analyzer/index.ts`
- Create: `test/unit/analyzer/internalReferences.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/analyzer/internalReferences.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { analyze } from '../../../src/analyzer';

describe('internal reference tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-ref-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should not report type used as field type in same-file exported type', async () => {
    fs.writeFileSync(path.join(tempDir, 'dto.ts'), `
export type BodyCompositionDTO = {
  weight_kg: number;
  body_fat_pct?: number;
};

export type DailyBodyCompositionDTO = {
  record_date: string;
  body_composition?: BodyCompositionDTO;
};
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { DailyBodyCompositionDTO } from './dto';
const x: DailyBodyCompositionDTO = { record_date: '2024-01-01' };
`);

    const files = [
      path.join(tempDir, 'dto.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];

    const result = await analyze({
      files,
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('BodyCompositionDTO');
  });

  it('should not report function param type used in same-file exported function', async () => {
    fs.writeFileSync(path.join(tempDir, 'dto.ts'), `
export type InputDTO = { value: number };
export function processInput(dto: InputDTO): number {
  return dto.value * 2;
}
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { processInput } from './dto';
processInput({ value: 42 });
`);

    const files = [
      path.join(tempDir, 'dto.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];

    const result = await analyze({
      files,
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('InputDTO');
  });

  it('should still report truly unused exports', async () => {
    fs.writeFileSync(path.join(tempDir, 'dto.ts'), `
export type UsedType = { value: number };
export type TrulyUnusedType = { id: string };
export function usedFn(): UsedType { return { value: 1 }; }
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { usedFn } from './dto';
usedFn();
`);

    const files = [
      path.join(tempDir, 'dto.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];

    const result = await analyze({
      files,
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('UsedType');
    expect(unusedNames).toContain('TrulyUnusedType');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/internalReferences.test.ts`
Expected: FAIL — `BodyCompositionDTO` and `InputDTO` reported as unused

- [ ] **Step 3: Implement TypeScript internal reference analysis in `analyzer/index.ts`**

Add `analyzeInternalReferences()` function and helper functions (`findSymbolByName`, `countNonDeclarationReferences`) as documented in the spec. Also add `markInternalReferencesRegex()` for non-TS languages with `stripCommentsAndStrings()` and `escapeRegex()` helpers.

Call both in `analyze()` after `propagateReExportUsage()`. **Important**: Reuse the `program` already created in the language loop (save it to a variable before the loop scope ends) instead of creating a second program:

```typescript
// Save program reference from the TS branch of the language loop
let tsProgram: ts.Program | undefined;
// ... in the loop where language === 'typescript':
//   tsProgram = program;  // save reference

// After propagateReExportUsage():
if (tsProgram) {
  analyzeInternalReferences(mergedGraph, tsProgram);
}
markInternalReferencesRegex(mergedGraph);
```

Key functions to implement:
- `analyzeInternalReferences(graph, program)` — TypeChecker-based, for .ts/.tsx/.js/.jsx
- `markInternalReferencesRegex(graph)` — regex-based, for .py/.go/.java/.dart (skips TS files)
- `findSymbolByName(name, sourceFile, checker)` — walks top-level statements
- `countNonDeclarationReferences(symbol, sourceFile, checker)` — AST walk counting non-declaration identifier matches
- `stripCommentsAndStrings(content)` — removes comments and string literals
- `escapeRegex(str)` — escapes regex special characters

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/unit/analyzer/internalReferences.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run all tests for regression**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/analyzer/index.ts test/unit/analyzer/internalReferences.test.ts
git commit -m "feat(R-2): track same-file export references to reduce false positives"
```

---

## Task 4: R-5 — Entry Point Pattern Expansion

**Files:**
- Modify: `src/analyzer/frameworkDetector.ts`
- Modify: `src/analyzer/index.ts`
- Modify: `src/analyzer/languages/python/pythonFrameworkDetector.ts`
- Modify: `src/analyzer/languages/go/goFrameworkDetector.ts`
- Modify: `src/analyzer/languages/java/javaFrameworkDetector.ts`
- Create: `test/unit/analyzer/entryPoints.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/analyzer/entryPoints.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findFrameworkEntryPoints, findToolingEntryPoints } from '../../../src/analyzer/frameworkDetector';

describe('tooling entry points', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-points-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should recognize jest.config.js as entry point', async () => {
    fs.writeFileSync(path.join(tempDir, 'jest.config.js'), 'module.exports = {};');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('jest.config.js'))).toBe(true);
  });

  it('should recognize vitest.config.ts as entry point', async () => {
    fs.writeFileSync(path.join(tempDir, 'vitest.config.ts'), 'export default {};');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('vitest.config.ts'))).toBe(true);
  });

  it('should not include regular source files', async () => {
    fs.writeFileSync(path.join(tempDir, 'main.ts'), 'console.log("hi");');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('main.ts'))).toBe(false);
  });
});

describe('expo entry points expanded', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-entry-test-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { expo: '~49.0.0' },
    }));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should recognize modules/*/index.ts as entry points', async () => {
    const moduleDir = path.join(tempDir, 'modules', 'expo-app-lifecycle');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'index.ts'), 'export default {};');

    const entries = await findFrameworkEntryPoints(tempDir);
    expect(entries.some(e => e.includes('modules/expo-app-lifecycle/index.ts'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/entryPoints.test.ts`
Expected: FAIL — `findToolingEntryPoints` doesn't exist

- [ ] **Step 3: Add `findToolingEntryPoints()` to `frameworkDetector.ts` and expand Expo patterns**

Add `TOOLING_ENTRY_PATTERNS` array and `findToolingEntryPoints()` export. Add `'modules/*/index.{ts,js}'` and `'modules/*/src/*.{ts,js}'` to Expo entry patterns.

- [ ] **Step 4: Wire tooling entries into `analyzer/index.ts`**

Import `findToolingEntryPoints` and merge into entry points before detection.

- [ ] **Step 5: Add Python/Go/Java tooling entries to respective framework detectors**

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run test/unit/analyzer/entryPoints.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Run all tests for regression**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/analyzer/frameworkDetector.ts src/analyzer/index.ts src/analyzer/languages/python/pythonFrameworkDetector.ts src/analyzer/languages/go/goFrameworkDetector.ts src/analyzer/languages/java/javaFrameworkDetector.ts test/unit/analyzer/entryPoints.test.ts
git commit -m "feat(R-5): add tooling entry points and expand Expo/framework patterns"
```

---

## Task 5: R-4 — Property Access Confidence Downgrade

**Files:**
- Modify: `src/analyzer/unusedExportDetector.ts:91-242`
- Create: `test/unit/analyzer/propertyAccess.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/analyzer/propertyAccess.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { analyze } from '../../../src/analyzer';

describe('property access confidence downgrade', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-access-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence when named export is in default object', async () => {
    fs.writeFileSync(path.join(tempDir, 'typo.ts'), `
export const mediumRegular = { fontSize: 14 };
export const largeBold = { fontSize: 18 };
export default { mediumRegular, largeBold };
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import KpdsTypo from './typo';
const style = KpdsTypo.mediumRegular;
`);

    const files = [
      path.join(tempDir, 'typo.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];

    const result = await analyze({
      files,
      rootDir: tempDir,
      entryPoints: [],
    });

    const mediumRegular = result.unusedExports.find(e => e.exportName === 'mediumRegular');
    if (mediumRegular) {
      expect(mediumRegular.confidence).toBe('low');
    }
  });

  it('should not downgrade named export not in default object', async () => {
    fs.writeFileSync(path.join(tempDir, 'module.ts'), `
export const helper = 42;
export const unused = 99;
export default { helper };
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import mod from './module';
console.log(mod.helper);
`);

    const files = [
      path.join(tempDir, 'module.ts'),
      path.join(tempDir, 'consumer.ts'),
    ];

    const result = await analyze({
      files,
      rootDir: tempDir,
      entryPoints: [],
    });

    const unused = result.unusedExports.find(e => e.exportName === 'unused');
    if (unused) {
      expect(unused.confidence).not.toBe('low');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/propertyAccess.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement confidence downgrade in `unusedExportDetector.ts`**

Add `isNamedExportInDefaultObject()` helper and modify `determineConfidence()` to accept `fileNode` and `exportUsages` parameters. Check if default export is used and the named export appears as shorthand property in `export default { ... }`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/unit/analyzer/propertyAccess.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run all tests for regression**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/analyzer/unusedExportDetector.ts test/unit/analyzer/propertyAccess.test.ts
git commit -m "feat(R-4): downgrade confidence for named exports included in default object"
```

---

## Task 6: Flutter/Dart — Module Resolver

**Files:**
- Create: `src/analyzer/languages/dart/dartModuleResolver.ts`
- Create: `test/unit/analyzer/languages/dart/dartModuleResolver.test.ts`

- [ ] **Step 1: Write test**

```typescript
// test/unit/analyzer/languages/dart/dartModuleResolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveDartImport, getPackageName } from '../../../../../src/analyzer/languages/dart/dartModuleResolver';

describe('dartModuleResolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dart-resolver-test-'));
    fs.writeFileSync(path.join(tempDir, 'pubspec.yaml'), 'name: my_app\n');
    fs.mkdirSync(path.join(tempDir, 'lib', 'src'), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should read package name from pubspec.yaml', () => {
    expect(getPackageName(tempDir)).toBe('my_app');
  });

  it('should resolve internal package import to lib/ path', () => {
    const result = resolveDartImport(
      'package:my_app/src/models/user.dart',
      path.join(tempDir, 'lib', 'main.dart'),
      tempDir,
      'my_app'
    );
    expect(result).toBe(path.join(tempDir, 'lib', 'src', 'models', 'user.dart'));
  });

  it('should return undefined for external package import', () => {
    const result = resolveDartImport(
      'package:flutter/material.dart',
      path.join(tempDir, 'lib', 'main.dart'),
      tempDir,
      'my_app'
    );
    expect(result).toBeUndefined();
  });

  it('should return undefined for dart: SDK imports', () => {
    const result = resolveDartImport('dart:async', path.join(tempDir, 'lib', 'main.dart'), tempDir, 'my_app');
    expect(result).toBeUndefined();
  });

  it('should resolve relative imports', () => {
    const result = resolveDartImport(
      '../models/user.dart',
      path.join(tempDir, 'lib', 'src', 'widgets', 'button.dart'),
      tempDir,
      'my_app'
    );
    expect(result).toBe(path.join(tempDir, 'lib', 'src', 'models', 'user.dart'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/dartModuleResolver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `dartModuleResolver.ts`**

Implement `getPackageName(rootDir)` (parse pubspec.yaml) and `resolveDartImport(importPath, containingFile, rootDir, packageName)` (handle dart:, package:, and relative paths).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/dartModuleResolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/languages/dart/dartModuleResolver.ts test/unit/analyzer/languages/dart/dartModuleResolver.test.ts
git commit -m "feat(dart): add Dart module resolver for package: and relative imports"
```

---

## Task 7: Flutter/Dart — Import Collector

**Files:**
- Create: `src/analyzer/languages/dart/dartImportCollector.ts`
- Create: `test/unit/analyzer/languages/dart/dartImportCollector.test.ts`

- [ ] **Step 1: Write test**

Tests covering: basic import, external package, dart: SDK, relative import, show, hide, as alias, export directives, multiple imports. (See spec Section 7.2 for all patterns.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/dartImportCollector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `dartImportCollector.ts`**

Regex-based parser matching `import/export 'path' [as alias] [show/hide names];` patterns. Uses `resolveDartImport()` for path resolution. Maps to `ImportInfo`/`ImportSpecifier` structures.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/dartImportCollector.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/languages/dart/dartImportCollector.ts test/unit/analyzer/languages/dart/dartImportCollector.test.ts
git commit -m "feat(dart): add Dart import collector with show/hide/as support"
```

---

## Task 8: Flutter/Dart — Export Collector

**Files:**
- Create: `src/analyzer/languages/dart/dartExportCollector.ts`
- Create: `test/unit/analyzer/languages/dart/dartExportCollector.test.ts`

- [ ] **Step 1: Write test**

Tests covering: public class, private class (skipped), mixin, enum, typedef, top-level function, top-level variables, private functions (skipped), export directives as re-exports, extension, part-of detection.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/dartExportCollector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `dartExportCollector.ts`**

Line-by-line regex parser. Public symbols (no `_` prefix) at top level become exports. Export directives become re-exports. Also exports `isPartFile()` helper.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/dartExportCollector.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/languages/dart/dartExportCollector.ts test/unit/analyzer/languages/dart/dartExportCollector.test.ts
git commit -m "feat(dart): add Dart export collector for public symbols and re-exports"
```

---

## Task 9: Flutter/Dart — Local Collector

**Files:**
- Create: `src/analyzer/languages/dart/dartLocalCollector.ts`
- Create: `test/unit/analyzer/languages/dart/dartLocalCollector.test.ts`

- [ ] **Step 1: Write test**

Tests covering: private class, private function, private variable, public symbols excluded, unused private with zero references.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `dartLocalCollector.ts`**

Collect `_`-prefixed top-level symbols. Count references via regex (occurrences minus 1 for declaration).

- [ ] **Step 4: Run tests and commit**

```bash
git add src/analyzer/languages/dart/dartLocalCollector.ts test/unit/analyzer/languages/dart/dartLocalCollector.test.ts
git commit -m "feat(dart): add Dart local collector for private symbols"
```

---

## Task 10: Flutter/Dart — Framework Detector

**Files:**
- Create: `src/analyzer/languages/dart/dartFrameworkDetector.ts`
- Create: `test/unit/analyzer/languages/dart/dartFrameworkDetector.test.ts`

- [ ] **Step 1: Write test**

Tests covering: Flutter detection from pubspec.yaml, non-Flutter Dart project, entry point finding, conventional exports, ignore patterns.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `dartFrameworkDetector.ts`**

Detect Flutter from `pubspec.yaml` dependencies. Entry patterns for lib/main.dart, tests, generated files. Conventional exports for Widget lifecycle, serialization, routing, state management, testing. Ignore patterns for *.g.dart, *.freezed.dart, etc.

- [ ] **Step 4: Run tests and commit**

```bash
git add src/analyzer/languages/dart/dartFrameworkDetector.ts test/unit/analyzer/languages/dart/dartFrameworkDetector.test.ts
git commit -m "feat(dart): add Flutter framework detector with entry points and conventionals"
```

---

## Task 11: Flutter/Dart — Analyzer + Registration

**Files:**
- Create: `src/analyzer/languages/dart/dartAnalyzer.ts`
- Modify: `src/types/language.ts`
- Modify: `src/analyzer/languages/index.ts`
- Modify: `src/analyzer/index.ts`
- Modify: `src/analyzer/unusedExportDetector.ts`
- Create: `test/fixtures/dart-project/`

- [ ] **Step 1: Update `SupportedLanguage` type** — Add `'dart'`

- [ ] **Step 2: Create `dartAnalyzer.ts`** — Implement `LanguageAnalyzer` interface with `buildGraph()` (classify part files, collect imports/exports/locals, merge parts) and `findEntryPoints()`.

- [ ] **Step 3: Register in `languages/index.ts`** — Add `.dart` extension mapping and `DartAnalyzer` instantiation.

- [ ] **Step 4: Wire into `analyzer/index.ts`** — Import `getDartConventionalExports`, `getDartIgnorePatterns`, `detectDartFramework`. Add Dart conventional exports to merge. Add Dart ignore patterns when Flutter detected.

- [ ] **Step 5: Add Dart confidence patterns to `unusedExportDetector.ts`** — Dart test files (`*_test.dart`, `test/`, `integration_test/`), generated files (`*.g.dart`, `*.freezed.dart`).

- [ ] **Step 5b: Add Dart confidence patterns to `unusedLocalDetector.ts`** — Dart test file locals get `'low'` confidence. Private symbols in generated `.g.dart` files get `'low'`.

- [ ] **Step 6: Create test fixture** — `test/fixtures/dart-project/` with pubspec.yaml, lib/, test/ structure.

- [ ] **Step 7: Write integration test for DartAnalyzer**

- [ ] **Step 8: Run all Dart tests**

Run: `pnpm vitest run test/unit/analyzer/languages/dart/`
Expected: ALL PASS

- [ ] **Step 9: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add src/analyzer/languages/dart/ src/types/language.ts src/analyzer/languages/index.ts src/analyzer/index.ts src/analyzer/unusedExportDetector.ts test/fixtures/dart-project/ test/unit/analyzer/languages/dart/
git commit -m "feat(dart): add complete Flutter/Dart language analyzer with framework detection"
```

---

## Task 12: Final Integration Test + Version Bump

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Run linting**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run type check**

Run: `pnpm type-check`
Expected: No errors

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit version bump**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 1.1.0 for false positive fixes and Dart support"
```
