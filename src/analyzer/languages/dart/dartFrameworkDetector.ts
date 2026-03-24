import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

export type DartFrameworkType = 'flutter' | null;

/**
 * Detects if the Dart project uses Flutter by checking pubspec.yaml
 */
export function detectDartFramework(rootDir: string): DartFrameworkType {
  const pubspecPath = path.join(rootDir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) return null;

  try {
    const content = fs.readFileSync(pubspecPath, 'utf-8');
    if (/flutter:\s*\n\s+sdk:\s+flutter/m.test(content) || /^\s+flutter:\s*$/m.test(content)) {
      return 'flutter';
    }
  } catch {
    // ignore
  }

  return null;
}

const FLUTTER_ENTRY_PATTERNS = [
  'lib/main.dart',
  'lib/app.dart',
  'test/**/*_test.dart',
  'integration_test/**/*.dart',
  'lib/firebase_options.dart',
  'lib/generated/**/*.dart',
  'lib/l10n/*.dart',
];

const DART_COMMON_ENTRIES = [
  'bin/*.dart',
  'lib/main.dart',
  'tool/*.dart',
];

/**
 * Finds entry point files for a Dart/Flutter project
 */
export async function findDartFrameworkEntryPoints(
  rootDir: string,
  framework: DartFrameworkType
): Promise<string[]> {
  const patterns = framework === 'flutter'
    ? FLUTTER_ENTRY_PATTERNS
    : DART_COMMON_ENTRIES;

  const matched = await fg(patterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.dart_tool/**'],
  });

  return matched;
}

const FLUTTER_CONVENTIONAL_EXPORTS = [
  // Widget lifecycle
  'build', 'createState', 'dispose', 'initState',
  'didChangeDependencies', 'didUpdateWidget', 'deactivate', 'reassemble',
  // Serialization
  'toJson', 'fromJson', 'fromMap', 'toMap', 'copyWith',
  // Factory patterns
  'of', 'builder',
  // Routing
  'route', 'routeName',
  // State management
  'mapEventToState', 'watch', 'read', 'select',
  // Testing
  'setUp', 'tearDown', 'setUpAll', 'tearDownAll', 'main',
];

const DART_CONVENTIONAL_EXPORTS = [
  'main', 'toJson', 'fromJson',
];

/**
 * Returns conventional export names consumed by the Dart/Flutter framework
 */
export function getDartConventionalExports(framework: DartFrameworkType): string[] {
  return framework === 'flutter'
    ? FLUTTER_CONVENTIONAL_EXPORTS
    : DART_CONVENTIONAL_EXPORTS;
}

/**
 * Returns glob patterns for Dart generated files that should be ignored
 */
export function getDartIgnorePatterns(): string[] {
  return [
    '*.g.dart',
    '*.freezed.dart',
    '*.gr.dart',
    '*.config.dart',
    '*.mocks.dart',
  ];
}
