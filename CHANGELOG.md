# Changelog

All notable changes to the **Dead Code Detector** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-30

### Added
- **New finding kind: unused parameters.** TypeScript/JavaScript function, method and arrow-function parameters that are never read are now reported (`kind: 'parameter'`) at `medium` confidence — i.e. they are visible at the default `confidenceThreshold`, so upgrading surfaces new diagnostics in files you have not touched. The rule mirrors eslint's `no-unused-vars` with `args: 'after-used'`: only parameters after the last used one are reported, and signatures imposed from outside (decorated or abstract members, overload implementations, members of a class with `extends`/`implements`, setters, `this` and rest parameters) are never reported. Rename the parameter with a leading `_` (`_req`) or add a `// @dead-code-ignore` comment to silence one
- **New finding kind: unused private class members.** `private` methods, `private` fields, `#private` names and TypeScript constructor parameter properties (`constructor(private readonly repo: Repo)`) are reported when nothing in the declaring file references them; PHP `private` methods, properties and constants are covered too. Fields report at `medium`; methods report at `high` for TypeScript/JavaScript and at `medium` for regex-analysed languages such as PHP, where a member reached only through a string callable (`call_user_func([$this, 'refresh'])`, `array_map([$this, 'transform'], ...)`, `$this->{$handler}()`) cannot be seen by reference counting
- **New result class: dead clusters (entry-point reachability).** Files that *are* imported — and were therefore never reportable before — but that no entry point can transitively reach are now reported at `low` confidence with the reason "Not reachable from any entry point (imported only by unreachable files)". Likewise an export whose only users are such files is reported at `low`. This finds whole orphaned subtrees (a feature deleted from the router but still internally cross-importing), which inbound-edge counting alone can never see. It is applied per language and only when that language has at least one non-tooling entry point, so a repo where entry-point detection found nothing for a language behaves exactly as before for that language's files
- **Entry-point detection expansion**: build-output paths are mapped back to sources (`dist/index.js` → `src/index.ts`, honouring tsconfig `rootDir`); `package.json` `bin`, `exports` and `scripts` targets join `main`/`module`/`types`/`browser`; monorepo `workspaces` (including the `{ packages: [...] }` form) contribute each package's entries and conventional roots; `<script src="...">` targets in root/`src`/`public` HTML files; serverless handlers (Vercel `api/**` when `vercel.json` is present, `serverless.yml`/`.yaml` `handler:` targets)
- **CommonJS support**: `module.exports = {...}`, `module.exports = expr`, `module.exports.x = ...` and `exports.x = ...` are now collected as exports, and `const { a, b: renamed } = require('./x')` is collected with its named specifiers (a rest element widens to a namespace import). `require.context('./mods', true, /\.ts$/)` is resolved as a glob dependency. CommonJS files previously contributed neither exports nor usages to the graph
- **Multi-tsconfig program groups**: files are grouped by the nearest `tsconfig.json` between them and the workspace root, and one TypeScript program is created per group, all feeding a single dependency graph. A monorepo's per-package `paths` aliases now resolve in each package instead of one package's config being applied to all of them
- **PHP/Laravel language support**: New export/import/local collectors, module resolver, and framework detector for PHP projects (`src/analyzer/languages/php/`); `SupportedLanguage` extended with `'php'`
- **Vue and Svelte single-file components**: `.vue`/`.svelte` files are analyzed through the TypeScript pipeline via script-block extraction
- **New file extensions**: `.mts`, `.cts`, `.mjs`, `.cjs` added to default include patterns and language detection
- **`runProjectAnalysis()`** (`src/commands/runAnalysis.ts`): shared, full-project analysis runner used by both commands — scans with `include`/`exclude`, filters files by `enabledLanguages`, auto-detects entry points via the language analyzers whose language is enabled when `entryPoints` is empty, and calls `analyze()` with every configuration field (`ignorePatterns`, `entryPointDecorators`, `containerFiles`, `alwaysUsedPatterns`); also returns the exact list of files that were analyzed (`analyzedFiles`)
- **Reachability analysis** and **name-based member matching** (see below) are now reflected in the README's "How It Works" section and confidence-level documentation
- New activation events for PHP/Dart/npm projects: `workspaceContains:**/pubspec.yaml`, `workspaceContains:**/composer.json`, `workspaceContains:**/*.php`, `workspaceContains:**/package.json`

### Fixed
- **Critical: `Analyze Current File` always reported the active file's own exports as dead code.** The command built a single-file dependency graph (`analyzeFile(filePath, { files: [filePath], ... })`), so every export and cross-file usage was invisible to the analysis. It now runs a full-project analysis via `runProjectAnalysis()` and filters the three result arrays down to the active file, matching real project-wide reachability
- **`Analyze Project` silently ignored `ignorePatterns`, `entryPointDecorators`, `containerFiles`, and `alwaysUsedPatterns`.** These config fields existed on `ExtensionConfig` since 1.1.1 but were never read by the command. Both commands now pass the complete configuration through to `analyze()`
- **`enabledLanguages` was not enforced during scanning.** Files of a language absent from the setting were previously still scanned and analyzed; `runProjectAnalysis()` now filters scanned files by `detectLanguage(file)` membership in `config.enabledLanguages`
- **`enabledLanguages` was not enforced during entry-point auto-detection.** Disabled languages' analyzers were still probed for entry points (e.g. `pom.xml`/`go.mod`/`pubspec.yaml` scanning) and their results still surfaced in the returned entry-point list; `runProjectAnalysis()` now restricts auto-detection to analyzers whose language is enabled
- **`Analyze Current File` could show a false "No dead code found" for a file excluded by the current configuration.** If the active file's language was disabled via `enabledLanguages`, or the file fell outside `include`/`exclude`, the command still ran and silently produced an empty (never-analyzed) result. It now checks whether the file was actually analyzed and, if not, warns that the file was skipped by the current configuration instead of reporting it clean
- **`Analyze Project` ran the full analysis even when the scan matched zero files**, doing unnecessary entry-point detection and `analyze()` work before its "No files found" early exit. `runProjectAnalysis()` now short-circuits immediately when no files match, restoring the pre-refactor behavior
- Stale `deadCodeDetector.entryPoints` setting description ("auto-detected from package.json") updated to match the README (`package.json`, `pubspec.yaml`, `composer.json`, and framework conventions)

### Changed
- **Graph semantics: `export * from './x'` no longer marks `x`'s exports as used.** A star re-export now only creates a dependency edge; usage is recorded when a downstream consumer actually imports a specific name (resolved through the star chain) or the barrel's namespace. Projects built around star barrels will therefore start seeing genuinely unused exports that were previously hidden behind the barrel
- **Graph semantics: a dead named re-export no longer keeps its target alive.** `export { x } from './target'` forwards `x` rather than consuming it, so it confers liveness only once the re-export itself is known to be used; the reachability walk also refuses to traverse edges whose only justification is such a dead forward. Both the dead forward in the barrel and the declaration behind it in the target file are now reported, and the target file itself can be reported as unreachable. `@dead-code-ignore` and `alwaysUsedPatterns` exempt a re-export from this
- **Full-project dependency graph**: analysis now always builds the graph from every scanned file (previously some paths built a graph from a single file), which is what makes cross-file usage, reachability and the re-export semantics above correct
- `package.json`: `include`/`exclude` configuration defaults now match `DEFAULT_INCLUDE_PATTERNS`/`DEFAULT_EXCLUDE_PATTERNS` from `src/constants.ts` exactly (adds the new extensions and new exclude patterns such as `**/coverage/**`, `**/.next/**`, `**/.nuxt/**`, `**/.svelte-kit/**`, `**/tests/**`)
- `deadCodeDetector.enabledLanguages` enum and default now include `dart` and `php`
- `analyzeCurrentFile`'s unsupported-file-type message lists all currently supported languages (TypeScript, JavaScript, Vue, Svelte, Python, Go, Java, Dart, PHP)
- Code-action provider selector and the save-on-analyze language allowlist in `extension.ts` add `vue`, `svelte`, `dart`, `php`
- README fully documents all eleven `ExtensionConfig` settings, confidence semantics (including dead-cluster findings and unused parameters shipping at `low`/`medium`), and the supported-languages list
- **Precedence change in `detectUnusedExports`**: `alwaysUsedPatterns` is now checked before the dead-cluster and the DI-decorated (`isEntryPointDecorated`) branches, so a name matching a user pattern is skipped entirely instead of being reported at `low` confidence
- **PHP entry-point files now have their exports analyzed.** For every other language an entry point's exports are its public API and are skipped wholesale, but PHP framework entry points are convention-scanned directories (`app/Http/Controllers/**`, `app/Providers/**`, `src/Controller/**`, …), so skipping them hid most of a Laravel/Symfony codebase. Their exports are now reported, with framework-conventional names (`boot`, `register`, `handle`, `up`/`down`, …) skipped entirely rather than reported at `low`, and members carrying a DI or routing attribute (`#[Route]`, `#[AsCommand]`, `#[Autowire]`, …) treated as entry points. Attributed PHP class members were previously dropped from collection entirely (an attribute line broke the member regex) and are now collected; one carrying an unrecognised attribute (`#[ORM\Column]`, `#[Assert\NotBlank]`, …) reports at `low` rather than `medium`, since it is typically read reflectively or by a template

## [1.1.1] - 2026-03-25

### Added
- **DI-aware entry point recognition (P0)**: New `src/analyzer/decoratorDetector.ts` registry recognizes DI decorators/annotations across TypeScript (InversifyJS, NestJS, Angular, tsyringe, TypeDI), Python, Java, and Dart; decorated classes/functions are treated as entry points and reported at `low` confidence when otherwise unused
- **DI container file tracking (P1)**: New `containerFiles` config setting — every import in a matching file is treated as used, covering manual DI registration modules; applied both during TypeScript graph building and in a language-agnostic post-merge pass for Python/Go/Java/Dart
- **Automatic DI container detection (P4)**: `findDIContainerFiles()` scans file content against a registry of framework-specific DI patterns (InversifyJS, NestJS, Angular, tsyringe, Spring, Guice, Dagger, GetIt, Python `dependency-injector`, Go `wire`/`fx`) without requiring configuration
- **`entryPointDecorators` and `alwaysUsedPatterns` config settings (P3)**: user-supplied decorator names and export-name glob patterns that are always treated as used, wired through `ConfigManager` and `AnalyzeOptions`
- No new test files were added in this change; the existing suite (414 tests) was verified to pass with no regressions

## [1.1.0] - 2026-03-25

### Added
- **Flutter/Dart language support**: Full dead code detection for Dart projects with import/export/local collection, module resolution (`package:`, relative paths), and `part`/`part of` file merging
- **Flutter framework detection**: Auto-detects Flutter from `pubspec.yaml`; recognizes entry points (`lib/main.dart`, test files, generated files), conventional exports (Widget lifecycle, serialization, routing, state management), and ignore patterns for generated files (`*.g.dart`, `*.freezed.dart`, etc.)
- **Tooling entry points**: `jest.config.*`, `vitest.config.*`, `webpack.config.*`, `babel.config.*`, and other build tool config files are now automatically recognized as entry points regardless of framework
- **Expo native module support**: `modules/*/index.ts` and `modules/*/src/*.ts` patterns added to Expo entry points

### Fixed
- **R-3: Path alias resolution** (~50+ false positives): Added `resolveWithPathAlias()` fallback when `ts.resolveModuleName()` fails for `@/` imports — manually matches tsconfig `paths` mappings with extension probing
- **R-1: Barrel re-export propagation** (~84 false positives): `export { default as X } from './Y'` now propagates usage to the original source file's export via `propagateReExportUsage()` with multi-level chain support and circular guard
- **R-2: Same-file export references** (~30 false positives): Exports used as field types, function parameters, or return types by other exports in the same file are no longer reported as unused (TypeChecker-based for TS, regex-based for other languages)
- **R-4: Property access via default export** (~14 false positives): Named exports included as shorthand properties in the file's `export default { ... }` object receive `low` confidence when the default export is used
- **Dart test/generated file confidence**: Dart test files (`*_test.dart`, `test/`) and generated files (`*.g.dart`, `*.freezed.dart`) receive `low` confidence

### Changed
- `ExportInfo` interface now includes optional `originalName` field for aliased re-exports
- `SupportedLanguage` type extended with `'dart'`
- `reExportSource` in `ExportInfo` now stores resolved absolute paths instead of raw module specifiers
- Orchestrator flow: graph merge → re-export propagation → internal reference analysis → tooling entry points → detection
- 61 new tests (359 → 420 total)

## [1.0.7] - 2026-02-13

### Added
- **Python export confidence**: Test files (`test_*.py`, `*_test.py`, `tests/` directory, `conftest.py`) and dunder methods/attributes (`__init__`, `__str__`, etc.) now receive `low` confidence
- **Java export confidence**: Test files (`*Test.java`, `*Tests.java`, `*Spec.java`, `src/test/`) receive `low` confidence; common override methods (`toString`, `hashCode`, `equals`, `compareTo`, `clone`) and `enum` exports receive `low` confidence
- **Go export confidence**: Test utility packages (`testdata/`, `testutil/`, `testing/` directories) receive `low` confidence
- **Java local confidence**: `serialVersionUID` receives `low` confidence; logger fields (`logger`, `log`, `LOG`, `LOGGER`) receive `medium` confidence
- **Python framework conventional exports**: Django (views, models, admin, URLs, middleware, signals — 30+ exports), Flask (`create_app`, `init_app`, etc.), FastAPI (`get_db`, `lifespan`, `startup`, `shutdown`, etc.)
- **Java framework conventional exports**: Spring Boot (lifecycle, Spring Data, MVC, configuration, scheduling — 16 exports), Android (Activity/Fragment/Service/BroadcastReceiver/ContentProvider/ViewModel lifecycle — 22 exports)
- **Go framework detector**: New `goFrameworkDetector.ts` detects Gin, Echo, Fiber, Chi from `go.mod`; adds conventional exports (`Handler`, `ServeHTTP`, `MarshalJSON`, `Scan`, etc.) and handler/middleware/routes entry patterns
- **Orchestrator integration**: All language-specific conventional exports (Python, Java, Go) are now merged into the framework exports array alongside TypeScript framework exports
- 29 new tests (330 → 359 total)

## [1.0.6] - 2026-02-12

### Added
- **New framework detection**: Vue, Svelte, Express, Gatsby, Storybook, Expo auto-detected from `package.json`
- **Multi-framework support**: `detectFrameworks()` detects multiple frameworks simultaneously (e.g., Next.js + Storybook); entry points and conventional exports are merged from all detected frameworks
- **React pattern heuristics**: `use*` hooks, `with*` HOC functions, `*Context`/`*Provider`/`*Consumer` exports now receive `low` confidence; `.jsx` PascalCase default exports recognized alongside `.tsx`
- **Next.js Route Handlers**: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS` added as conventional exports; `template`, `default`, and `app/api/**` entry patterns added
- **NestJS conventional exports**: Lifecycle hooks (`onModuleInit`, `onModuleDestroy`, etc.), guards (`canActivate`), interceptors, and common patterns
- **Angular conventional exports**: Lifecycle hooks (`ngOnInit`, `ngOnDestroy`, etc.), router guards (`canActivate`, `canDeactivate`), pipes
- **React Native conventional exports**: `navigationOptions`, `screenOptions`, `displayName`, etc.
- **Java framework detection**: Spring Boot (via `pom.xml`/`build.gradle` annotation scanning) and Android (via `AndroidManifest.xml`/extends patterns) entry point detection
- **Python framework detection**: Django, Flask, FastAPI detected from `requirements.txt`, `Pipfile`, `pyproject.toml`; framework-specific entry patterns (`models.py`, `views.py`, routers, etc.)
- 59 new tests (236 → 295 total)

## [1.0.5] - 2026-02-12

### Fixed
- **Default export false positives**: Default exports now always register as name `default` via `hasDefaultModifier()`, ensuring `import X from './module'` correctly links to the default export
- **Star re-export false positives**: Named imports through `export * from` chains are now traced via `resolveStarReExport()`, preventing unused-export false positives on barrel re-exports
- **Path normalization**: TS-resolved import paths are now normalized with `path.normalize()` to prevent duplicate tracking from inconsistent path separators
- **Aliased export names**: Re-exported and named exports with aliases now use the exported name (`element.name.text`) instead of the local property name

## [1.0.4] - 2026-02-12

### Added
- **Framework detection**: Auto-detect Next.js, React Native, NestJS, Angular, Remix from `package.json` and register framework-specific entry points (pages, routes, controllers, etc.)
- **`@dead-code-ignore` comment support**: Add `// @dead-code-ignore` on the preceding line or inline to suppress a specific result; add it in the first 3 lines of a file to suppress the entire file
- **`ignorePatterns` config wiring**: The `deadCodeDetector.ignorePatterns` setting now filters analysis results via `minimatch` glob matching
- **Framework conventional export recognition**: Next.js (`getServerSideProps`, `generateMetadata`, etc.) and Remix (`loader`, `action`, `meta`, etc.) conventional exports are reported with `low` confidence
- 61 new tests (19 ignoreComment, 24 frameworkDetector, 5 importCollector path alias, 13 integration)

### Fixed
- **Path alias resolution**: `@/`, `~/`, and `baseUrl` imports were incorrectly treated as external modules, breaking import-export linking. Now resolves via `ts.resolveModuleName` first, then checks `isExternalLibraryImport`

## [1.0.3] - 2026-02-11

### Fixed
- Negative character position error in diagnostics and tree view that caused VS Code rendering issues

## [1.0.2] - 2026-02-10

### Fixed
- Publish issues: bundle TypeScript as a dependency, add prepublish build script

## [1.0.1] - 2026-02-10

### Fixed
- Bundle TypeScript correctly for extension distribution
- Add `vscode:prepublish` script for automated pre-publish builds

## [1.0.0] - 2026-02-08

### Added
- Initial release of Dead Code Detector
- Detect unused files, exports, and local variables/functions
- Support for TypeScript, JavaScript, Python, Go, and Java
- Confidence levels (high, medium, low) for all detections
- Tree view panel in VS Code Explorer sidebar
- Inline diagnostics with squiggly underlines
- Export reports in HTML, JSON, Markdown, and CSV formats
- Configurable include/exclude patterns, entry points, and confidence threshold
- Analyze on save with debouncing
- Multi-language dependency graph analysis

### Security
- Bump esbuild from 0.20.2 to 0.25.0
- Update vitest to v4.0.18 to fix esbuild vulnerability
- Fix all lint errors and warnings
