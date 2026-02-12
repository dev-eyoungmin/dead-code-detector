# Changelog

All notable changes to the **Dead Code Detector** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
