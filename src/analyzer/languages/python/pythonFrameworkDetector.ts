import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

export type PythonFrameworkType = 'django' | 'flask' | 'fastapi' | null;

export interface PythonFrameworkInfo {
  type: PythonFrameworkType;
  entryPatterns: string[];
}

const DJANGO_ENTRY_PATTERNS = [
  'manage.py',
  '**/settings.py',
  '**/urls.py',
  '**/wsgi.py',
  '**/asgi.py',
  '**/admin.py',
  '**/apps.py',
  '**/models.py',
  '**/views.py',
  '**/forms.py',
  '**/serializers.py',
  '**/signals.py',
  '**/middleware.py',
  '**/templatetags/**/*.py',
  '**/management/commands/**/*.py',
];

const FLASK_ENTRY_PATTERNS = [
  'app.py',
  'wsgi.py',
  'application.py',
  'src/app.py',
  'src/wsgi.py',
];

const FASTAPI_ENTRY_PATTERNS = [
  'main.py',
  'app.py',
  'src/main.py',
  'src/app.py',
  '**/routers/**/*.py',
  '**/endpoints/**/*.py',
];

/**
 * Reads a dependency file and returns its content, or null if it doesn't exist
 */
function readFileIfExists(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Detects the Python framework used in a project
 */
export function detectPythonFramework(
  rootDir: string
): PythonFrameworkInfo | null {
  // Check requirements.txt
  const requirements = readFileIfExists(path.join(rootDir, 'requirements.txt'));
  if (requirements) {
    const detected = detectFromRequirements(requirements);
    if (detected) return detected;
  }

  // Check Pipfile
  const pipfile = readFileIfExists(path.join(rootDir, 'Pipfile'));
  if (pipfile) {
    const detected = detectFromPipfile(pipfile);
    if (detected) return detected;
  }

  // Check pyproject.toml
  const pyproject = readFileIfExists(path.join(rootDir, 'pyproject.toml'));
  if (pyproject) {
    const detected = detectFromPyproject(pyproject);
    if (detected) return detected;
  }

  // Fallback: manage.py → Django
  if (fs.existsSync(path.join(rootDir, 'manage.py'))) {
    return { type: 'django', entryPatterns: DJANGO_ENTRY_PATTERNS };
  }

  return null;
}

function detectFromRequirements(content: string): PythonFrameworkInfo | null {
  const lines = content.toLowerCase();
  if (/^django[=<>~!\s]/m.test(lines) || /^django$/m.test(lines)) {
    return { type: 'django', entryPatterns: DJANGO_ENTRY_PATTERNS };
  }
  if (/^flask[=<>~!\s]/m.test(lines) || /^flask$/m.test(lines)) {
    return { type: 'flask', entryPatterns: FLASK_ENTRY_PATTERNS };
  }
  if (/^fastapi[=<>~!\s]/m.test(lines) || /^fastapi$/m.test(lines)) {
    return { type: 'fastapi', entryPatterns: FASTAPI_ENTRY_PATTERNS };
  }
  return null;
}

function detectFromPipfile(content: string): PythonFrameworkInfo | null {
  const lower = content.toLowerCase();
  if (lower.includes('django')) {
    return { type: 'django', entryPatterns: DJANGO_ENTRY_PATTERNS };
  }
  if (lower.includes('flask')) {
    return { type: 'flask', entryPatterns: FLASK_ENTRY_PATTERNS };
  }
  if (lower.includes('fastapi')) {
    return { type: 'fastapi', entryPatterns: FASTAPI_ENTRY_PATTERNS };
  }
  return null;
}

function detectFromPyproject(content: string): PythonFrameworkInfo | null {
  const lower = content.toLowerCase();
  if (lower.includes('django')) {
    return { type: 'django', entryPatterns: DJANGO_ENTRY_PATTERNS };
  }
  if (lower.includes('flask')) {
    return { type: 'flask', entryPatterns: FLASK_ENTRY_PATTERNS };
  }
  if (lower.includes('fastapi')) {
    return { type: 'fastapi', entryPatterns: FASTAPI_ENTRY_PATTERNS };
  }
  return null;
}

/**
 * Finds Python framework entry point files using fast-glob
 */
export async function findPythonFrameworkEntryPoints(
  rootDir: string
): Promise<string[]> {
  const framework = detectPythonFramework(rootDir);
  if (!framework) {
    return [];
  }

  const matched = await fg(framework.entryPatterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/__pycache__/**', '**/venv/**', '**/.venv/**'],
  });

  return matched;
}
