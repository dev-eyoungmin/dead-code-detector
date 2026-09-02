import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { isSfcFile, sfcExtension, extractSfcScript } from './sfc';

/** One TypeScript program plus the files it was created for. */
export interface ProgramGroup {
  program: ts.Program;
  files: string[];
  /** tsconfig.json the group's compiler options came from, if any */
  configPath?: string;
}

interface ProgramCache {
  program: ts.Program;
  files: Set<string>;
}

/** Keyed by tsconfig path, or by `<default>:<rootDir>` for the config-less group. */
const programCache = new Map<string, ProgramCache>();

const DEFAULT_GROUP_PREFIX = '<default>:';

/**
 * Creates one TypeScript program per tsconfig.json that governs the given files.
 *
 * A monorepo usually has a tsconfig per package, each with its own `paths`
 * mapping. A single program can only apply one of them, so files are grouped by
 * the nearest tsconfig.json found by walking up from the file's directory to
 * `rootDir` (inclusive). Files with no tsconfig between them and `rootDir` share
 * one default-options group.
 *
 * When `tsconfigPath` is given explicitly it wins and a single group is created.
 */
export function createPrograms(
  files: string[],
  rootDir: string,
  tsconfigPath?: string
): ProgramGroup[] {
  const explicitConfig =
    tsconfigPath && fs.existsSync(tsconfigPath) ? tsconfigPath : undefined;

  // Preserve input order so groups are stable between runs.
  const groups = new Map<string, { configPath?: string; files: string[] }>();

  if (explicitConfig || files.length === 0) {
    groups.set(explicitConfig ?? DEFAULT_GROUP_PREFIX + rootDir, {
      configPath: explicitConfig,
      files: [...files],
    });
  } else {
    for (const file of files) {
      const configPath = findNearestTsConfig(path.dirname(file), rootDir);
      const key = configPath ?? DEFAULT_GROUP_PREFIX + rootDir;
      const group = groups.get(key);
      if (group) {
        group.files.push(file);
      } else {
        groups.set(key, { configPath, files: [file] });
      }
    }
  }

  const result: ProgramGroup[] = [];
  for (const [key, group] of groups) {
    const options = resolveCompilerOptions(group.configPath);
    const host = createSfcAwareHost(options);
    const program = ts.createProgram({
      rootNames: group.files,
      options,
      host,
      oldProgram: programCache.get(key)?.program,
    });
    programCache.set(key, { program, files: new Set(group.files) });
    result.push({ program, files: group.files, configPath: group.configPath });
  }

  return result;
}

/**
 * Creates a single TypeScript program for one self-contained set of files.
 * Prefer createPrograms() for whole projects.
 *
 * Without an explicit `tsconfigPath` this looks for a tsconfig.json in
 * `path.dirname(files[0])` and nowhere else: that directory doubles as the
 * rootDir, and the search stops at rootDir. It does not walk up towards the
 * filesystem root. Callers that need a config from an ancestor directory must
 * pass `tsconfigPath`, or use createPrograms() with the real workspace root.
 */
export function createProgram(files: string[], tsconfigPath?: string): ts.Program {
  const rootDir = path.dirname(files[0] ?? '.');
  return createPrograms(files, rootDir, tsconfigPath)[0].program;
}

/** Clears every cached program, forcing a fresh analysis next time. */
export function clearProgramCache(): void {
  programCache.clear();
}

/**
 * Walks up from `startDir` towards `rootDir` (inclusive) looking for a
 * tsconfig.json. Never leaves the workspace: a config above `rootDir` belongs to
 * a different project and must not shape this analysis.
 */
function findNearestTsConfig(startDir: string, rootDir: string): string | undefined {
  const root = path.normalize(rootDir).replace(/[/\\]+$/, '');
  let current = path.normalize(startDir);

  while (current === root || current.startsWith(root + path.sep)) {
    const candidate = path.join(current, 'tsconfig.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (current === root) {
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }

  return undefined;
}

/**
 * Reads the group's compiler options from its tsconfig.json, falling back to
 * defaults that accept both JS and TS. SFC files carry a non-TS extension, so
 * `allowNonTsExtensions` is always required.
 */
function resolveCompilerOptions(configPath?: string): ts.CompilerOptions {
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );
      return {
        ...parsed.options,
        allowJs: parsed.options.allowJs ?? true,
        allowNonTsExtensions: true,
        noEmit: true,
      };
    }
  }

  return {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.React,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    allowNonTsExtensions: true,
    noEmit: true,
  };
}

/**
 * A compiler host that presents `.vue`/`.svelte` files as TypeScript: their
 * script blocks are lifted out and everything else is blanked, so positions
 * reported by the compiler still match the original file.
 *
 * Only `readFile` and `getSourceFile` are overridden. `fileExists` deliberately
 * is not: SFCs keep their real on-disk paths here (nothing is rewritten to a
 * virtual `App.vue.ts`), so the default host already answers correctly for them
 * and an override would be an identity wrapper. If SFCs are ever mapped to
 * synthetic paths, `fileExists` — and `realpath`/`getCanonicalFileName` with it —
 * must be overridden at the same time.
 */
function createSfcAwareHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const baseReadFile = host.readFile.bind(host);
  const baseGetSourceFile = host.getSourceFile.bind(host);

  host.readFile = (fileName: string): string | undefined => {
    const content = baseReadFile(fileName);
    const ext = sfcExtension(fileName);
    if (content === undefined || ext === undefined) {
      return content;
    }
    return extractSfcScript(content, ext);
  };

  host.getSourceFile = (
    fileName: string,
    languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
    onError?: (message: string) => void,
    shouldCreateNewSourceFile?: boolean
  ): ts.SourceFile | undefined => {
    if (!isSfcFile(fileName)) {
      return baseGetSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile
      );
    }
    const text = host.readFile(fileName);
    if (text === undefined) {
      return undefined;
    }
    return ts.createSourceFile(
      fileName,
      text,
      languageVersionOrOptions,
      /* setParentNodes */ true,
      ts.ScriptKind.TS
    );
  };

  return host;
}
