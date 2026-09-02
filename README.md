# Dead Code Detector

A VS Code extension that detects unused files, exports, and local variables/functions across TypeScript, JavaScript, Vue, Svelte, Python, Go, Java, Dart/Flutter, and PHP/Laravel projects.

## Supported Languages

- TypeScript / JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`)
- Vue (`.vue` single-file components)
- Svelte (`.svelte` components)
- Python (`.py`)
- Go (`.go`)
- Java (`.java`)
- Dart / Flutter (`.dart`)
- PHP / Laravel (`.php`)

## Features

- **Unused File Detection** (F-01): Finds files that are not imported by any other file in the project
- **Unused Export Detection** (F-02): Finds exported symbols that are never imported elsewhere
- **Unused Local Detection** (F-03): Finds local variables and functions that are declared but never referenced
- **Report Generation** (F-04): Export analysis results as HTML, JSON, Markdown, or CSV

## Quick Start

1. Install the extension
2. Open a TypeScript/JavaScript project
3. Run `Dead Code: Analyze Project` from the Command Palette (`Ctrl+Shift+P`)
4. View results in the **Dead Code** panel in the Explorer sidebar

## Commands

| Command | Description |
|---------|-------------|
| `Dead Code: Analyze Project` | Analyze all files in the workspace |
| `Dead Code: Analyze Current File` | Analyze the currently active file |
| `Dead Code: Export Report` | Export results as HTML/JSON/Markdown/CSV |
| `Dead Code: Clear Results` | Clear all analysis results |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `deadCodeDetector.include` | `["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mts", "**/*.cts", "**/*.mjs", "**/*.cjs", "**/*.vue", "**/*.svelte", "**/*.py", "**/*.go", "**/*.java", "**/*.dart", "**/*.php"]` | Glob patterns for files to include in analysis |
| `deadCodeDetector.exclude` | `["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/.next/**", "**/.nuxt/**", "**/.output/**", "**/.svelte-kit/**", "**/.claude/**", "**/*.d.ts", "**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/__pycache__/**", "**/.venv/**", "**/venv/**", "**/vendor/**", "**/*_test.go", "**/target/**", "**/Test*.java", "**/*Test.java", "**/*Test.php", "**/*.spec.php", "**/tests/**"]` | Glob patterns for files to exclude from analysis |
| `deadCodeDetector.entryPoints` | `[]` | Entry point files (their exports are always considered used). Auto-detected from `package.json`, `pubspec.yaml`, `composer.json`, and framework conventions if empty |
| `deadCodeDetector.analyzeOnSave` | `true` | Automatically analyze the current file on save |
| `deadCodeDetector.reportFormat` | `"html"` | Default report export format (`html`, `json`, `markdown`, `csv`) |
| `deadCodeDetector.confidenceThreshold` | `"medium"` | Minimum confidence level to report (`high` = only certain dead code, `low` = include possible false positives) |
| `deadCodeDetector.ignorePatterns` | `[]` | Additional glob patterns to exclude from reported results (e.g., generated files or files with specific decorators) |
| `deadCodeDetector.enabledLanguages` | `["typescript", "python", "go", "java", "dart", "php"]` | Languages to include in dead code analysis |
| `deadCodeDetector.entryPointDecorators` | `[]` | Additional decorator/annotation names (without `@`) that mark a class or function as a DI entry point (e.g. `["MyCustomDecorator"]`). Built-in DI decorators (`Injectable`, `Component`, `Service`, etc.) are recognized automatically |
| `deadCodeDetector.containerFiles` | `[]` | Glob patterns for DI container registration files. All imports in these files are treated as used (e.g. `["**/container.ts", "**/di.ts"]`) |
| `deadCodeDetector.alwaysUsedPatterns` | `[]` | Export name glob patterns that are always considered used and never reported as dead code (e.g. `["*Repository", "*Service"]`) |

## Confidence Levels

Results are categorized by confidence:

- **High**: Local variables/functions with zero references (very reliable)
- **Medium**: Named exports with no external imports
- **Low**: Files with potential side effects or re-exports, framework conventional exports/entry points, DI-decorated symbols, findings that are part of a mutually-referencing dead cluster (files/exports only reachable from each other, never from a real entry point), and unused function parameters — all of these are more prone to false positives, so they ship at `low`/`medium` confidence rather than `high`

## How It Works

1. **Scanning**: Uses `fast-glob` to collect all matching source files
2. **Parsing**: Uses the TypeScript Compiler API (and language-specific parsers for Python/Go/Java/Dart/PHP) to parse and analyze ASTs
3. **Graph Building**: Constructs a dependency graph tracking imports, exports, and local symbols
4. **Reachability**: Walks the graph from auto-detected or configured entry points to determine which files and exports are actually reachable, rather than relying on import counts alone
5. **Member Matching**: Falls back to name-based member matching (e.g., matching a method name across a namespace/wildcard import) when static resolution of the exact declaration is not possible
6. **Detection**: Identifies unused code by checking the graph for unreferenced or unreachable nodes
7. **Reporting**: Presents results via TreeView, Diagnostics (Problems panel), and exportable reports

## Namespace Import Handling

For conservative analysis, `import * as X from './module'` marks ALL exports of `./module` as used, since static analysis cannot determine which properties are accessed at runtime.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm watch

# Run tests
pnpm test

# Type check
pnpm type-check

# Lint
pnpm lint
```

## Requirements

- VS Code 1.85.0 or later
- TypeScript/JavaScript project with `tsconfig.json` or `jsconfig.json`

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full list of changes in each release.

## License

MIT
