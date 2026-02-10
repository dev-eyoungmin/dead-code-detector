import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

interface ProgramCache {
  program: ts.Program;
  files: Set<string>;
}

let cachedProgram: ProgramCache | null = null;

/**
 * Creates a TypeScript program for analysis.
 * Attempts to find and use tsconfig.json for compiler options.
 * Caches the program for incremental reuse.
 */
export function createProgram(
  files: string[],
  tsconfigPath?: string
): ts.Program {
  const filesSet = new Set(files);

  const { options, configFilePath } = getCompilerOptions(
    files,
    tsconfigPath
  );

  // Create program with oldProgram for incremental analysis
  const program = ts.createProgram({
    rootNames: files,
    options,
    oldProgram: cachedProgram?.program,
    configFileParsingDiagnostics: configFilePath
      ? ts.getConfigFileParsingDiagnostics(
          ts.getParsedCommandLineOfConfigFile(
            configFilePath,
            {},
            ts.sys as unknown as ts.ParseConfigFileHost
          )!
        )
      : undefined,
  });

  // Cache the new program
  cachedProgram = {
    program,
    files: filesSet,
  };

  return program;
}

/**
 * Clears the cached program, forcing a fresh analysis next time
 */
export function clearProgramCache(): void {
  cachedProgram = null;
}

/**
 * Gets compiler options by attempting to find tsconfig.json or using defaults
 */
function getCompilerOptions(
  files: string[],
  tsconfigPath?: string
): { options: ts.CompilerOptions; configFilePath?: string } {
  let configFilePath: string | undefined;

  // If tsconfig path explicitly provided, use it
  if (tsconfigPath && fs.existsSync(tsconfigPath)) {
    configFilePath = tsconfigPath;
  } else if (files.length > 0) {
    // Try to find tsconfig.json in the directory of the first file
    const firstFileDir = path.dirname(files[0]);
    configFilePath = findTsConfig(firstFileDir);
  }

  if (configFilePath) {
    const configFile = ts.readConfigFile(configFilePath, ts.sys.readFile);
    if (!configFile.error) {
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configFilePath)
      );
      return {
        options: {
          ...parsedConfig.options,
          noEmit: true, // We're only analyzing, not emitting
        },
        configFilePath,
      };
    }
  }

  // Default compiler options that support both JS and TS
  return {
    options: {
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
      noEmit: true,
    },
  };
}

/**
 * Recursively searches for tsconfig.json starting from the given directory
 */
function findTsConfig(startDir: string): string | undefined {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const tsconfigPath = path.join(currentDir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
    currentDir = path.dirname(currentDir);
  }

  return undefined;
}
