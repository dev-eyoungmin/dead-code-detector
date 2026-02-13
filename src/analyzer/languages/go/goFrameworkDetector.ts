import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

export type GoFrameworkType = 'gin' | 'echo' | 'fiber' | 'chi' | null;

export interface GoFrameworkInfo {
  type: GoFrameworkType;
  entryPatterns: string[];
  conventionalExports: string[];
}

/** Module paths that identify Go web frameworks in go.mod */
const GO_FRAMEWORK_MODULES: Record<string, GoFrameworkType> = {
  'github.com/gin-gonic/gin': 'gin',
  'github.com/labstack/echo': 'echo',
  'github.com/gofiber/fiber': 'fiber',
  'github.com/go-chi/chi': 'chi',
};

const GO_WEB_CONVENTIONAL_EXPORTS = [
  // HTTP handlers
  'Handler', 'Middleware', 'Router',
  // Common handler patterns
  'ServeHTTP',
  // Common interface implementations
  'String', 'Error', 'MarshalJSON', 'UnmarshalJSON',
  'Scan', 'Value',  // sql.Scanner / driver.Valuer
];

const GO_WEB_ENTRY_PATTERNS = [
  'main.go',
  'cmd/*/main.go',
  '**/handler/**/*.go',
  '**/handlers/**/*.go',
  '**/middleware/**/*.go',
  '**/routes/**/*.go',
  '**/router/**/*.go',
];

/**
 * Detects Go web framework from go.mod
 */
export function detectGoFramework(rootDir: string): GoFrameworkInfo | null {
  const goModPath = path.join(rootDir, 'go.mod');
  if (!fs.existsSync(goModPath)) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(goModPath, 'utf-8');
  } catch {
    return null;
  }

  for (const [modulePath, frameworkType] of Object.entries(GO_FRAMEWORK_MODULES)) {
    if (content.includes(modulePath)) {
      return {
        type: frameworkType,
        entryPatterns: GO_WEB_ENTRY_PATTERNS,
        conventionalExports: GO_WEB_CONVENTIONAL_EXPORTS,
      };
    }
  }

  return null;
}

/**
 * Finds Go framework entry point files using fast-glob
 */
export async function findGoFrameworkEntryPoints(
  rootDir: string
): Promise<string[]> {
  const framework = detectGoFramework(rootDir);
  if (!framework) {
    return [];
  }

  const matched = await fg(framework.entryPatterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/vendor/**', '**/*_test.go'],
  });

  return matched;
}

/**
 * Returns conventional export names for the detected Go framework
 */
export function getGoConventionalExports(rootDir: string): string[] {
  const framework = detectGoFramework(rootDir);
  if (!framework) return [];
  return framework.conventionalExports;
}
