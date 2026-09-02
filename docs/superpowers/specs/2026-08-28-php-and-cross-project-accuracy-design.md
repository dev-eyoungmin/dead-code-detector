# PHP Support & Cross-Project Detection Accuracy — Design

Date: 2026-08-28
Status: approved for implementation (autonomous run; assumptions listed in §1.3)

## 1. Goal

Make Dead Code Detector produce *meaningful* results on real frontend and backend
projects, and add PHP as a first-class language.

"Meaningful" is defined by the verified gap list from the 2026-08-28 assessment:

| Symptom (verified) | Root cause |
|---|---|
| Every save reports the current file + all its exports as unused | `analyzeCurrentFile` builds a one-file graph |
| Settings added in 1.1.1 do nothing | `entryPointDecorators`/`containerFiles`/`alwaysUsedPatterns`/`enabledLanguages` never reach `analyze()` |
| Source entry file reported unused | `package.json#main` points at `dist/*.js`, never mapped back to source |
| Barrel-heavy projects report ~no unused exports | `export * from` marks every target export used |
| Dead clusters and files kept alive by dead re-exports are missed | Only "inbound edge == 0" is checked; no reachability |
| Java/Go public methods used from other files reported unused | Import specifiers carry class names only, never member names |
| 55 s for a 2000-function file | Per-symbol full-AST walks (O(n²)) |
| Locals in nested callbacks never reported; private members never reported | Local collector stops recursing inside function bodies |
| Positional params reported `high` | No `after-used` rule |
| Vue/Svelte projects report their TS utils unused | SFC files are never parsed |
| Monorepo packages report each other's files unused | One `tsconfig.json` (nearest to first file) for the whole workspace |
| Template-literal `import()`, `new Worker(new URL())`, `import.meta.glob` targets reported unused | Not collected |
| CommonJS projects have zero export detection | `module.exports`/`exports.x` not collected |
| Dart never runs inside VS Code | Not wired in `package.json`/`extension.ts` |

### 1.1 Scope

Three sub-projects, delivered together on one branch:

- **Part 1 — Core accuracy** (all languages): commands, config wiring, entry points, graph semantics, reachability, member-name usage, performance, TS local collection, CJS/dynamic imports, multi-tsconfig, new extensions.
- **Part 2 — Frontend**: Vue/Svelte SFC parsing, frontend framework entry points (Vite, Nuxt, SvelteKit, Angular).
- **Part 3 — PHP**: new language analyzer with Laravel/Symfony/WordPress detection, plus wiring for PHP and Dart.

### 1.2 Non-goals

- Unused imports, unused enum members, write-only variables (tsc/ESLint already cover these).
- Astro/Blade/Twig template *parsing* (Blade files are handled as entry points, see §4.5).
- Type-based method resolution for dynamic languages (we use name-based member matching, §2.6).
- Changing the `AnalysisResult` shape, reporters, or the tree view.

### 1.3 Assumptions made without user confirmation

- Results shape stays identical; new detections surface through existing categories and confidence levels.
- New risky detections (dead clusters, parameters, private fields injected via constructor) ship at `low`/`medium` confidence so the default `medium` threshold stays quiet.
- `analyzeOnSave` keeps its `true` default but now runs a full-project analysis (debounced, cached program).
- No commits are made by the autonomous run; changes are left in the working tree on branch `feature/php-and-detection-accuracy` for review.

## 2. Part 1 — Core accuracy

### 2.1 Commands (`src/commands/`)

New helper `src/commands/runAnalysis.ts`:

```ts
export async function runProjectAnalysis(rootDir: string, config: ExtensionConfig): Promise<AnalysisResult>
```

It scans with `config.include/exclude`, filters files by `config.enabledLanguages`
(via `detectLanguage`), auto-detects entry points when `config.entryPoints` is empty,
and calls `analyze()` with **all** config fields (`ignorePatterns`, `entryPointDecorators`,
`containerFiles`, `alwaysUsedPatterns`). Both `analyzeProject` and `analyzeCurrentFile`
use it; `analyzeCurrentFile` then filters results to the active file (existing
`analyzeFile` semantics, but `analyzeFile` now receives the full file list).

`enabledLanguages` gains `'dart'` and `'php'` in the type, the `package.json` enum, and defaults.

### 2.2 Entry-point detection (`typescriptAnalyzer.ts`, `frameworkDetector.ts`)

New module `src/analyzer/entryPointResolver.ts`:

- `mapBuildPathToSource(rootDir, filePath): string | undefined` — if `filePath` does not
  exist or lives under `dist|build|out|lib|.next|.output`, try: replace the first path segment
  with tsconfig `rootDir` (if set) or `src`, then swap `.js/.mjs/.cjs/.d.ts` → `.ts/.tsx/.mts/.cts/.js/.jsx`.
  Return the first existing candidate. Used for `main`, `module`, `types`, `bin`, every string
  in `exports` (recursively, all conditions), and for workspace-package resolution (§2.10).
- `scriptEntryPoints(packageJson)` — every token in `scripts.*` matching
  `/[\w./-]+\.(?:[mc]?[jt]sx?)\b/` resolved relative to the package dir (after build→source mapping).
- `workspacePackageDirs(rootDir)` — from `package.json#workspaces` (array or `{packages}`),
  `pnpm-workspace.yaml` (`packages:` list), and `lerna.json#packages`. Globs are expanded with
  fast-glob (`onlyDirectories`). `TypeScriptAnalyzer.findEntryPoints` runs the package.json /
  conventional-file logic for the root **and** each workspace package dir.
- Conventional files extended to `{src/,}{index,main,cli,server,app}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`,
  `bin/*.{ts,js,mjs,cjs}`, `scripts/*.{ts,js,mjs,cjs}` (top-level only).
- Tooling entries extended: `*.html` at root, `src/**/*.html`, `public/**/*.html` → their
  `<script src="...">` targets (relative to the html file) become entry points; serverless
  targets `api/**/*.{ts,js}` (only when `vercel.json` exists), `netlify/functions/**/*.{ts,js}`,
  `functions/src/index.{ts,js}`, `supabase/functions/*/index.ts`, and `serverless.yml`
  `handler:` values (`path/to/file.fn` → `path/to/file.{ts,js}`).

Frontend framework configs added to `FRAMEWORK_CONFIGS` (`FRAMEWORK_DEPS` keys in parentheses):

- `nuxt` (`nuxt`): `app.vue`, `error.vue`, `pages/**`, `layouts/**`, `components/**`,
  `composables/**`, `middleware/**`, `plugins/**`, `server/**`, `utils/**`, `nuxt.config.*` — all
  `{vue,ts,js}`. Conventional: `definePageMeta`, `defineNuxtConfig`, `default`.
- `sveltekit` (`@sveltejs/kit`): `src/routes/**/*.{svelte,ts,js}`, `src/hooks.{client,server}.{ts,js}`,
  `src/params/*.{ts,js}`, `src/service-worker.{ts,js}`, `svelte.config.*`. Conventional: `load`,
  `actions`, `prerender`, `ssr`, `csr`, `trailingSlash`, `handle`, `handleError`, `handleFetch`,
  `GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD`, `match`, `default`.
- `angular` gains `angular.json` parsing: `projects.*.architect.build.options.{main,browser,polyfills}`
  (string or array) become entry points.
- `vite` (`vite`): `index.html` script targets (via tooling entries above) — no extra patterns.

### 2.3 Graph builder unification (`dependencyGraph.ts`, `graphBuilder.ts`)

`buildDependencyGraph` becomes: collect `FileNode`s → `buildGraphFromFileNodes(fileMap, options)`.
`buildGraphFromFileNodes(fileMap, { containerFilePaths?: Set<string> })` is the **only** edge/usage
builder. Semantics per import:

| Import shape | Edge | Export usage |
|---|---|---|
| named specifiers | yes | `target::name`; if absent, resolve through `export *` chain (existing `resolveStarReExport`) |
| namespace / dynamic / `require` / container file | yes | all target exports **and, transitively, all exports of every module the target star-re-exports** |
| `export * from` (collected as import with `isStarReExport: true`) | yes | **none** |
| `globPattern` set (§2.8) | edge to every fileMap key matching the pattern | all exports of each match (namespace semantics) |

`ImportInfo` gains optional `isStarReExport?: boolean` and `globPattern?: string`
(absolute minimatch pattern). `importCollector` sets `isStarReExport` for `export * from`
and `export * as X from` (the latter still marks nothing — `X` is accessed as a namespace only
through the re-exporting file, and a namespace import of *that* file propagates).

Entry-point re-exports: new pass in `analyzer/index.ts`, `markEntryPointReExports(graph, entryPoints)`:
for each entry file, named re-exports mark `source::originalName` used by the entry file; star
re-exports mark all exports of the source used, following star chains (visited-set guarded).
Runs before `propagateReExportUsage`.

### 2.4 Reachability (dead clusters)

New `src/analyzer/reachability.ts`: `computeReachable(graph, entryPoints): Set<string>` — BFS over
`outboundEdges` from entry points. Applied only when `entryPoints.length > 0`.

- `detectUnusedFiles`: a file with inbound edges but unreachable → reported with
  `confidence: 'low'`, `reason: 'Not reachable from any entry point (imported only by unreachable files)'`.
  Files with zero inbound edges keep today's behaviour.
- `detectUnusedExports`: an export whose usages all come from unreachable files → reported at `'low'`.

Both detectors receive the reachable set as an optional parameter (undefined = skip).

### 2.5 Source cache

`src/analyzer/sourceCache.ts`: `readSource(path): string | null` (memoised), `clearSourceCache()`.
`analyze()` clears it at start. All `fs.readFileSync` calls in detectors, `findDIContainerFiles`,
`isNamedExportInDefaultObject`, `markInternalReferencesRegex`, and language analyzers' `buildGraph`
go through it.

### 2.6 Member-name usage pass (Java, Go, PHP)

`applyMemberNameUsage(graph)` in `analyzer/index.ts`, after graph merge: build one set of member
tokens per language from every analyzed file: matches of `/(?:->|::|\.)\s*([A-Za-z_]\w*)\s*(?:\(|\b)/`
and, for PHP, callable strings (§4.3). Then for every export of kind `method`/`constant`/`variable`
in a non-TS file that has no usages, if its name is in the token set of **another** file of the
same language, mark it used by `'<member-usage>'` (a sentinel path; `detectUnusedExports` only counts
size). Same-file references are already handled by `markInternalReferencesRegex`.

### 2.7 Performance

- `localSymbolCollector.collectLocals`: one AST walk builds `Map<ts.Symbol, number>` of identifier
  references (shorthand-property aware, declaration-name sites excluded). Declarations then look up
  their count. Complexity O(n).
- `analyzeInternalReferences`: per file, one walk builds the same map restricted to exported symbols.
- `findDIContainerFiles`, detectors: use the source cache (§2.5).

Acceptance: the 2000-function probe file analyses in < 3 s (was 55 s).

### 2.8 TypeScript collectors

`importCollector.ts`:
- Strip `?query` / `#hash` from specifiers before resolution (Vite `?worker`, `?raw`, `?url`).
- `const { a, b: c } = require('./x')` → named specifiers `a`, `b`; `const x = require('./x')` and
  bare `require('./x')` stay namespace.
- `import(\`./dir/${x}\`)` and `import('./dir/' + x)`: static prefix up to the first dynamic part →
  if it names a directory (after resolving relative to the file) emit `globPattern = <absdir>/**`;
  if it names a file prefix, `globPattern = <absprefix>*`.
- `import.meta.glob('./x/*.ts')` / `import.meta.globEager` / `require.context('./x', bool, /re/)`:
  `globPattern` from the literal (for `require.context` use `<dir>/**`).
- `new URL('./w.ts', import.meta.url)`, `new Worker('./w.ts')`, `new SharedWorker('./w.ts')`,
  `new Worker(new URL('./w.ts', import.meta.url))` → namespace import of the file.

`exportCollector.ts` (CommonJS, JS/TS):
- `module.exports = { a, b: expr, ...rest }` → exports `a`, `b`; spread contributes nothing.
- `module.exports = identifier | function | class | expr` → `default`.
- `exports.x = …`, `module.exports.x = …` → `x`.

### 2.9 TypeScript locals (`localSymbolCollector.ts`, `unusedLocalDetector.ts`)

- Walk the whole AST once. Collect: non-exported top-level `function/class/variable` declarations;
  `VariableStatement`/`FunctionDeclaration`/`ClassDeclaration` at any depth inside function-like
  bodies; parameters of every function-like node that has a body; destructuring bindings as today.
- Parameters: apply `after-used` — within one parameter list only parameters positioned after the last
  referenced parameter are candidates. Skip parameter lists of methods in classes that have
  `extends`/`implements` clauses or decorators, of overload signatures, and of abstract methods.
  Remaining unused parameters are reported at `'medium'` (never `'high'`).
- Private class members: `private`/`#name` methods, accessors, properties, and constructor parameter
  properties. Reference counting uses symbols (`this.x`, `this.#x`, `obj.x` inside the file). Kinds:
  `method` / `field`. Confidence: methods and accessors `'high'`; properties `'medium'`; constructor
  parameter properties `'medium'` (DI side-effect injection is common). Members with decorators are
  skipped (framework-managed).

### 2.10 Multiple tsconfigs / monorepos (`programFactory.ts`, `analyzer/index.ts`)

- `createPrograms(files, rootDir, tsconfigPath?): ProgramGroup[]` where `ProgramGroup = { program, files, configPath? }`.
  Files are grouped by the nearest `tsconfig.json` found walking up from the file's directory
  **without leaving `rootDir`** (files with none share a default-options group). One program per group,
  cached by config path (`oldProgram` reuse per group). `clearProgramCache()` clears all.
- `buildDependencyGraph` runs per group and the graphs are merged; `analyzeInternalReferences` receives
  `ts.Program[]` and looks each file up across them.
- Workspace imports: in `resolveImportPath`, when TS reports `isExternalLibraryImport` but the
  real path (`fs.realpathSync`) is inside `rootDir` and contains no `node_modules` segment, return
  the real path (pnpm/yarn symlinked workspace packages). If the resolved path is a build artifact
  not in the analysed set, `mapBuildPathToSource` is tried. `rootDir` is threaded to
  `collectImports` via the program-group options.

### 2.11 File extensions

`.mts`, `.cts`, `.mjs`, `.cjs` are TypeScript-family everywhere: `languages/index.ts` map,
`RESOLVE_EXTENSIONS`, default include patterns, and a single helper `isTypeScriptFamily(filePath)`
exported from `languages/index.ts` replacing every `/\.(ts|tsx|js|jsx)$/` test. `.vue`/`.svelte`
are also TypeScript-family (Part 2).

## 3. Part 2 — Frontend SFC support

### 3.1 Script extraction

`src/analyzer/sfc.ts`: `extractSfcScript(content, ext): string` returns a string of the **same
length in lines** where every character outside `<script>`…`</script>` bodies is replaced by a
space (newlines kept), so line/column numbers in results are unchanged. Vue: all `<script>` blocks
(`setup` and options API) are kept, in order. Svelte: `<script>` and `<script context="module">`.
`isSfcFile(path)` = `.vue` | `.svelte`.

### 3.2 Program integration

`createPrograms` builds a `CompilerHost` from `ts.createCompilerHost(options)` and overrides
`readFile`/`getSourceFile`/`fileExists` so that SFC paths return the extracted script; compiler
option `allowNonTsExtensions: true` lets TS accept the root names. Module resolution for
`./Foo.vue` already succeeds through the manual fallback (exact-path check).

### 3.3 SFC-specific collection

- Exports: every SFC file gets a synthetic `default` export (`kind: 'default'`, line 1) in addition
  to anything a `<script context="module">`/options-API block exports.
- Locals: after normal collection, any local with zero references whose name (or its kebab-case
  form for PascalCase names) appears as a whole word in the **non-script** part of the file counts
  as referenced (template usage). Same for imported component names — imports are edges regardless,
  so nothing extra is needed there.

### 3.4 Wiring

Default include patterns add `**/*.vue`, `**/*.svelte`; `extension.ts` code-action selector and
save listener add language ids `vue`, `svelte`.

## 4. Part 3 — PHP

Directory `src/analyzer/languages/php/`, mirroring the Java layout: `phpAnalyzer.ts`,
`phpModuleResolver.ts`, `phpImportCollector.ts`, `phpExportCollector.ts`, `phpLocalCollector.ts`,
`phpFrameworkDetector.ts`. Regex/line based like the other non-TS analyzers; a comment/string
stripper shared within the package handles `//`, `#` (not `#[`), `/* */`, single/double-quoted
strings and heredoc/nowdoc bodies.

### 4.1 Module resolution (`phpModuleResolver.ts`)

- `buildClassIndex(files): Map<FQCN, filePath>` — for each analysed file read `namespace X;` (or
  braced `namespace X { }`) and every top-level `class|interface|trait|enum|function` name.
  Global functions are indexed as `FQCN` of `Ns\fn`.
- `loadComposerAutoload(rootDir)`: `autoload` + `autoload-dev` `psr-4` (prefix → dir(s)), `psr-0`,
  `classmap` dirs, `files`. `resolveFqcn(fqcn, index, autoload)` tries the index first, then PSR-4
  mapping (`App\Http\Foo` + `App\ → app/` → `app/Http/Foo.php`), then PSR-0.
- `resolveInclude(spec, fromFile)`: `require|include(_once)` with a string literal, optionally
  prefixed by `__DIR__ .` / `dirname(__FILE__) .` / `dirname(__DIR__) .`.

### 4.2 Imports (`phpImportCollector.ts`)

Per file, resolve the current namespace and the alias table from `use` statements
(`use A\B;`, `use A\B as C;`, grouped `use A\{B, C as D};`, `use function`, `use const`).
Then collect class references from these positions (identifier = `[A-Z]\w*` or qualified `\A\B`):
`new X`, `X::`, `extends X`, `implements X, Y`, `instanceof X`, `catch (X $e)`, typed parameters
`(X $a, ?Y $b, X|Y $c)`, return types `: X`, property types `private X $p`, attributes `#[X(`,
`use X;` inside a class body (traits), and `X::class`. Each reference is resolved:
alias table → same namespace → global; then through `resolveFqcn`. Each distinct resolved file
yields one `ImportInfo` with specifiers = the referenced short names **plus** member names used
on that class in this file (`X::member`, `X::CONST`; for `new X` also every `->member(` in the file
— name-based, over-approximating). Includes become namespace imports of the included file.

### 4.3 Exports (`phpExportCollector.ts`)

Top level: `class|abstract class|final class|readonly class|interface|trait|enum` (`kind` class /
interface / class / enum), `function name(` (`function`), `const NAME =` and `define('NAME'`
(`constant`). Class members: `public` (or visibility-less) `function` → `method`; `public` properties
→ `variable`; `const`/`public const` → `constant`. Magic methods (`__*`) are still collected but
`determineConfidence` gives them `'low'`. `isEntryPointDecorated` is set when the class carries a DI
attribute recognised by `decoratorDetector` (`#[Injectable]`, `#[Service]`, `#[AsService]`, …).

Callable strings feeding §2.6 tokens: `[X::class, 'm']`, `[$this, 'm']`, `'X::m'`, `'X@m'`
(Laravel legacy routes), and the second argument of `add_action|add_filter|register_*_hook|
call_user_func(_array)?|array_map|usort|uasort|array_filter|array_walk` when it is a string.

### 4.4 Locals (`phpLocalCollector.ts`)

- `private` methods, properties and `private const` → `method`/`field`/`constant`; references counted
  by name across the file (`->name`, `::name`, `$this->name`, `self::name`, `static::name`),
  definition line excluded. Confidence: methods `'high'`, fields `'medium'`.
- Local variables inside function/method bodies (brace-matched): `$name =` assignments where the
  variable is never read elsewhere in the body (`\$name\b` occurrences beyond the assignment, inside
  strings included; `compact('name')` counts as a read). Skip `$this`, superglobals, `use ($name)`
  captured variables, and names starting with `_`. Confidence `'medium'`, kind `'variable'`.

### 4.5 Framework detection (`phpFrameworkDetector.ts`)

`detectPhpFramework(rootDir)` reads `composer.json` `require`/`require-dev`:
`laravel/framework` → laravel; `symfony/framework-bundle`|`symfony/symfony` → symfony;
WordPress when `wp-config.php`, `wp-content/`, or a file with a `Plugin Name:` header exists.
Multiple frameworks may be returned.

Entry patterns (relative to root):
- Generic: `index.php`, `public/index.php`, `bin/**/*.php`, `tests/bootstrap.php`.
- Laravel: `routes/**/*.php`, `config/**/*.php`, `bootstrap/**/*.php`, `artisan`,
  `database/{migrations,seeders,factories}/**/*.php`, `app/Console/Kernel.php`, `app/Http/Kernel.php`,
  `app/Providers/**`, `app/Http/{Controllers,Middleware}/**`, `app/Console/Commands/**`,
  `app/{Jobs,Listeners,Events,Policies,Observers,Notifications,Mail,Rules,Exceptions}/**`,
  `app/View/Components/**`, `resources/views/**/*.blade.php`, `app/Livewire/**`, `app/Http/Livewire/**`,
  `app/Nova/**`, `app/Filament/**`.
- Symfony: `public/index.php`, `bin/console`, `config/**/*.php`, `src/Kernel.php`,
  `src/{Controller,Command,EventSubscriber,EventListener,MessageHandler,Security,Twig,DataFixtures,Migrations}/**`,
  `migrations/**`, plus any file containing `#[Route`, `#[AsCommand`, `#[AsEventListener`,
  `#[AsMessageHandler`, `#[AsController`, `#[AsTwigFilter`, `#[AsTwigFunction`.
- WordPress: `wp-content/plugins/*/*.php` with a `Plugin Name:` header, `wp-content/themes/*/functions.php`,
  `wp-content/themes/*/*.php` (template hierarchy), `wp-content/mu-plugins/*.php`.

Conventional exports (`'low'` confidence):
- PHP magic methods: `__construct __destruct __call __callStatic __get __set __isset __unset __sleep
  __wakeup __serialize __unserialize __toString __invoke __set_state __clone __debugInfo`, and
  interface methods `jsonSerialize offsetExists offsetGet offsetSet offsetUnset getIterator count
  current key next rewind valid`.
- Laravel: `boot register handle rules authorize toArray toResponse render build via toMail toDatabase
  toBroadcast broadcastOn broadcastWith failed middleware tags shouldQueue retryUntil up down run
  definition passes message terminate report casts booted viewAny view create update delete restore
  forceDelete creating created updating updated deleting deleted saving saved restoring restored
  mount hydrate dehydrate updated updating rendering rendered attributes configure schedule commands
  map routes gate policies subscribe` and pattern rules `scope[A-Z]\w*`, `get[A-Z]\w*Attribute`,
  `set[A-Z]\w*Attribute`, `updated[A-Z]\w*` (Livewire).
- Symfony: `configure execute interact initialize getSubscribedEvents load process getConfigTreeBuilder
  buildForm configureOptions getParent supports authenticate onAuthenticationSuccess
  onAuthenticationFailure vote supportsNormalization normalize denormalize supportsDenormalization
  getFunctions getFilters getTests transform reverseTransform validate validatedBy getTargets
  configureRoutes registerBundles configureContainer getProjectDir getCacheDir getLogDir preUpdate
  prePersist postPersist postUpdate preRemove postRemove postLoad`.
- WordPress: `init activate deactivate uninstall register widget form update enqueue_scripts
  admin_menu render_callback register_routes get_items get_item create_item update_item delete_item
  permissions_check`.

`getPhpConventionalExports(rootDir)` merges the applicable lists; `analyze()` adds them to
`frameworkExports`. The magic-method list is always applied to `.php` files by
`determineConfidence` even with no framework.

### 4.6 `determineConfidence` additions

`.php`: test files (`/tests/`, `*Test.php`, `*.spec.php`), magic methods, and `*.blade.php` → `'low'`.

### 4.7 Wiring

- `SupportedLanguage` += `'php'`; `languages/index.ts` registers `PhpAnalyzer`, maps `.php`.
- `package.json`: include `**/*.php`; exclude adds `**/*Test.php`, `**/*.spec.php`, `**/tests/**`
  (consistent with the other languages: test code is excluded, so symbols used only by tests are
  reported); `enabledLanguages` enum/default add `dart`, `php`; `activationEvents` add
  `workspaceContains:**/composer.json`, `workspaceContains:**/*.php`, `workspaceContains:**/pubspec.yaml`;
  keywords add `php`, `laravel`, `dart`, `flutter`, `vue`, `svelte`.
- `extension.ts` selectors and save listener add `php`, `dart`, `vue`, `svelte`.
- `analyzeCurrentFile` unsupported-file message lists all languages.
- `markInternalReferencesRegex` strips `#` comments (not `#[`) for `.php`/`.py`.
- README: languages, configuration table (all settings), confidence semantics; CHANGELOG entries for
  1.1.1 (retro) and 1.2.0.

## 5. Testing

- Unit tests per new module (vitest, existing style): `entryPointResolver`, `reachability`,
  `sourceCache`, `sfc`, every `php/*` file, `programFactory.createPrograms` grouping.
- Extended tests: `importCollector` (query strip, require destructuring, glob/template/worker),
  `exportCollector` (CJS), `localSymbolCollector` (nested scopes, private members, after-used),
  `graphBuilder` (star re-export semantics, glob edges, container files), `frameworkDetector`
  (nuxt/sveltekit/angular.json/html scripts).
- New fixtures under `test/fixtures/`: `php-laravel-project`, `sfc-project`, `monorepo-project`,
  `cjs-project`, `barrel-project` (star re-exports + dead cluster).
- Integration: `test/integration/accuracy.test.ts` asserts, per fixture, the exact set of expected
  unused files/exports/locals and the absence of the known false positives from §1.
- Performance test: a generated 2000-function file analyses in under 3 s. Always runs.
- Existing 420 tests must keep passing; the orphaned `internalReferences.test.ts` is included.

## 6. Rollout / risk notes

- Reachability and parameter findings are `low`/`medium` by design; users tighten via
  `confidenceThreshold`.
- Name-based member matching over-approximates usage (fewer reports, never more) — acceptable.
- Multi-program analysis raises memory on very large monorepos; groups are created lazily and the
  program cache is per config path.
