import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';
import fg from 'fast-glob';

/**
 * Directory names commonly used for compiled/build output.
 */
const BUILD_DIRS = ['dist', 'build', 'out', 'lib', '.next', '.output', 'esm', 'cjs'];

/**
 * Source extensions tried (in order) when mapping a build output path back to source.
 */
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Reads `compilerOptions.rootDir` from a `tsconfig.json` at `rootDir`, if present.
 */
function readTsConfigRootDir(rootDir: string): string | undefined {
  const tsconfigPath = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return undefined;
  }
  try {
    const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const rootDirValue = config?.compilerOptions?.rootDir;
    return typeof rootDirValue === 'string' ? rootDirValue : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Strips a trailing `.d.ts`/`.js`/`.mjs`/`.cjs` extension from a relative path,
 * returning the path without extension so alternative source extensions can be tried.
 */
function stripCompiledExtension(rel: string): string {
  const dtsMatch = rel.match(/\.d\.ts$/);
  if (dtsMatch) {
    return rel.slice(0, -dtsMatch[0].length);
  }
  const ext = path.extname(rel);
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return rel.slice(0, -ext.length);
  }
  return rel;
}

/**
 * Maps a (possibly compiled) build output path to its likely TypeScript/JavaScript
 * source file, using the project's `tsconfig.json` `rootDir` (if any) and a `src/`
 * fallback. Returns the file unchanged if it already exists on disk.
 */
export function mapBuildPathToSource(rootDir: string, filePath: string): string | undefined {
  const abs = path.resolve(rootDir, filePath);

  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    return path.normalize(abs);
  }

  const rel = path.relative(rootDir, abs);
  const [first, ...rest] = rel.split(path.sep);

  if (!BUILD_DIRS.includes(first)) {
    return undefined;
  }

  const restRel = path.join(...rest);
  const strippedRestRel = stripCompiledExtension(restRel);

  const tsconfigRootDir = readTsConfigRootDir(rootDir);
  const candidateRoots = Array.from(new Set([tsconfigRootDir, 'src', ''].filter((r): r is string => r !== undefined)));

  for (const root of candidateRoots) {
    const base = path.join(rootDir, root, strippedRestRel);
    for (const ext of SOURCE_EXTS) {
      const candidate = base + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.normalize(candidate);
      }
    }
  }

  return undefined;
}

/**
 * Recursively collects every string leaf value found within an `exports` field
 * (which may nest conditional export maps like `{ import, require, default }`).
 */
function collectExportsStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectExportsStrings(item, out);
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectExportsStrings(item, out);
    }
  }
}

const SCRIPT_TOKEN_RE = /(?:^|[\s"'=])((?:\.{1,2}\/)?[\w@./-]+\.(?:[mc]?[jt]sx?))\b/g;

/**
 * Reads `package.json` at `pkgDir` and resolves every referenced entry file
 * (`main`, `module`, `types`, `typings`, `browser`, `bin`, `exports`, `scripts`)
 * to its source file via `mapBuildPathToSource`.
 */
export function resolvePackageJsonEntries(pkgDir: string): string[] {
  const packageJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return [];
  }

  const candidates: string[] = [];

  for (const field of ['main', 'module', 'types', 'typings', 'browser'] as const) {
    const value = packageJson[field];
    if (typeof value === 'string') {
      candidates.push(value);
    }
  }

  const bin = packageJson.bin;
  if (typeof bin === 'string') {
    candidates.push(bin);
  } else if (bin && typeof bin === 'object') {
    for (const value of Object.values(bin as Record<string, unknown>)) {
      if (typeof value === 'string') {
        candidates.push(value);
      }
    }
  }

  if (packageJson.exports) {
    collectExportsStrings(packageJson.exports, candidates);
  }

  const scripts = packageJson.scripts;
  if (scripts && typeof scripts === 'object') {
    for (const script of Object.values(scripts as Record<string, unknown>)) {
      if (typeof script !== 'string') continue;
      SCRIPT_TOKEN_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SCRIPT_TOKEN_RE.exec(script)) !== null) {
        candidates.push(match[1]);
      }
    }
  }

  const resolved = new Set<string>();
  for (const candidate of candidates) {
    const mapped = mapBuildPathToSource(pkgDir, candidate);
    if (mapped) {
      resolved.add(mapped);
    }
  }

  return Array.from(resolved);
}

/**
 * Parses `pnpm-workspace.yaml` for a top-level `packages:` list, without a full
 * YAML parser (only simple `- 'glob'` list items are supported).
 */
function parsePnpmWorkspaceGlobs(rootDir: string): string[] {
  const yamlPath = path.join(rootDir, 'pnpm-workspace.yaml');
  if (!fs.existsSync(yamlPath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(yamlPath, 'utf-8');
    const globs: string[] = [];
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)/);
      if (match) {
        globs.push(match[1]);
      }
    }
    return globs;
  } catch {
    return [];
  }
}

/**
 * Finds workspace package directories declared via `package.json#workspaces`,
 * `pnpm-workspace.yaml`, or `lerna.json#packages`.
 */
export async function findWorkspacePackageDirs(rootDir: string): Promise<string[]> {
  const patterns: string[] = [];

  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const workspaces = packageJson.workspaces;
      if (Array.isArray(workspaces)) {
        patterns.push(...workspaces.filter((w): w is string => typeof w === 'string'));
      } else if (workspaces && typeof workspaces === 'object' && Array.isArray(workspaces.packages)) {
        patterns.push(...workspaces.packages.filter((w: unknown): w is string => typeof w === 'string'));
      }
    } catch {
      // ignore invalid package.json
    }
  }

  patterns.push(...parsePnpmWorkspaceGlobs(rootDir));

  const lernaJsonPath = path.join(rootDir, 'lerna.json');
  if (fs.existsSync(lernaJsonPath)) {
    try {
      const lernaJson = JSON.parse(fs.readFileSync(lernaJsonPath, 'utf-8'));
      if (Array.isArray(lernaJson.packages)) {
        patterns.push(...lernaJson.packages.filter((p: unknown): p is string => typeof p === 'string'));
      }
    } catch {
      // ignore invalid lerna.json
    }
  }

  if (patterns.length === 0) {
    return [];
  }

  const matched = await fg(patterns, {
    cwd: rootDir,
    onlyDirectories: true,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });

  return matched.filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

/**
 * Finds conventional entry files within a package directory:
 * `{src/,}{index,main,cli,server,app}.<ext>`, `bin/*.<ext>`, `scripts/*.<ext>`.
 */
export async function findConventionalEntries(pkgDir: string): Promise<string[]> {
  return fg(
    [
      '{src/,}{index,main,cli,server,app}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
      'bin/*.{ts,js,mjs,cjs}',
      'scripts/*.{ts,js,mjs,cjs}',
    ],
    {
      cwd: pkgDir,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**'],
    }
  );
}

const SCRIPT_SRC_RE = /<script[^>]*\ssrc=["']([^"']+)["']/g;

/**
 * Finds `<script src="...">` targets referenced from root/`src`/`public` HTML files,
 * resolving them to existing files on disk.
 */
export async function findHtmlScriptEntries(rootDir: string): Promise<string[]> {
  const htmlFiles = await fg(['*.html', 'src/**/*.html', 'public/**/*.html'], {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/dist/**'],
  });

  const entries = new Set<string>();

  for (const htmlFile of htmlFiles) {
    let content: string;
    try {
      content = fs.readFileSync(htmlFile, 'utf-8');
    } catch {
      continue;
    }

    SCRIPT_SRC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SCRIPT_SRC_RE.exec(content)) !== null) {
      const src = match[1];
      if (src.startsWith('http') || src.startsWith('//')) {
        continue;
      }
      const resolved = src.startsWith('/')
        ? path.resolve(path.join(rootDir, src))
        : path.resolve(path.dirname(htmlFile), src);

      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        entries.add(path.normalize(resolved));
      }
    }
  }

  return Array.from(entries);
}

const SERVERLESS_HANDLER_RE = /^\s*handler:\s*([\w./-]+)\.\w+\s*$/gm;
const HANDLER_EXTS = ['.ts', '.js', '.mjs', '.cjs'];

/**
 * Finds serverless-function entry points: Vercel `api/**` (only when `vercel.json`
 * exists), Netlify functions, Firebase functions, Supabase functions, and
 * `serverless.yml`/`.yaml` `handler:` targets.
 */
export async function findServerlessEntries(rootDir: string): Promise<string[]> {
  const patterns: string[] = [
    'netlify/functions/**/*.{ts,js}',
    'functions/src/index.{ts,js}',
    'supabase/functions/*/index.ts',
  ];

  if (fs.existsSync(path.join(rootDir, 'vercel.json'))) {
    patterns.push('api/**/*.{ts,js}');
  }

  const matched = await fg(patterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**'],
  });

  const entries = new Set<string>(matched.map((p) => path.normalize(p)));

  for (const name of ['serverless.yml', 'serverless.yaml']) {
    const slsPath = path.join(rootDir, name);
    if (!fs.existsSync(slsPath)) continue;
    let content: string;
    try {
      content = fs.readFileSync(slsPath, 'utf-8');
    } catch {
      continue;
    }

    SERVERLESS_HANDLER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SERVERLESS_HANDLER_RE.exec(content)) !== null) {
      const base = path.resolve(rootDir, match[1]);
      for (const ext of HANDLER_EXTS) {
        const candidate = base + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          entries.add(path.normalize(candidate));
          break;
        }
      }
    }
  }

  return Array.from(entries);
}
