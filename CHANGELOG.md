# Changelog

All notable changes to the **Dead Code Detector** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
