# Dead Code Detector

A VS Code extension that detects unused files, exports, and local variables/functions in TypeScript and JavaScript projects.

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
| `deadCodeDetector.include` | `["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]` | File patterns to include |
| `deadCodeDetector.exclude` | `["**/node_modules/**", ...]` | File patterns to exclude |
| `deadCodeDetector.entryPoints` | `[]` | Entry point files (auto-detected if empty) |
| `deadCodeDetector.analyzeOnSave` | `true` | Auto-analyze on file save |
| `deadCodeDetector.reportFormat` | `"html"` | Default report format |
| `deadCodeDetector.confidenceThreshold` | `"medium"` | Minimum confidence level to report |

## Confidence Levels

Results are categorized by confidence:

- **High**: Local variables/functions with zero references (very reliable)
- **Medium**: Named exports with no external imports
- **Low**: Files with potential side effects, re-exports

## How It Works

1. **Scanning**: Uses `fast-glob` to collect all matching source files
2. **Parsing**: Uses the TypeScript Compiler API to parse and analyze ASTs
3. **Graph Building**: Constructs a dependency graph tracking imports, exports, and local symbols
4. **Detection**: Identifies unused code by checking the graph for unreferenced nodes
5. **Reporting**: Presents results via TreeView, Diagnostics (Problems panel), and exportable reports

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

## License

MIT
