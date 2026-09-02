import * as ts from 'typescript';
import type { DependencyGraph, ExportInfo, FileNode } from '../types';
import { collectImports } from './importCollector';
import { collectExports } from './exportCollector';
import { collectLocals } from './localSymbolCollector';
import { buildGraphFromFileNodes } from './graphBuilder';
import { readSource } from './sourceCache';
import { sfcExtension, extractSfcTemplate, countTemplateReferences } from './sfc';

export { makeExportKey, parseExportKey } from './exportKey';

export interface CollectFileNodesOptions {
  /** Additional DI decorator names from user configuration. */
  userDecorators?: string[];
  /** Workspace root; enables symlinked-workspace-package import resolution. */
  rootDir?: string;
}

/**
 * Collects the FileNode (imports/exports/locals) of every file the given program
 * knows about, adding them to `into`. Splitting this out from graph building
 * lets a multi-tsconfig project contribute several programs to one graph, so
 * imports that cross package boundaries still become edges.
 */
export function collectFileNodes(
  files: string[],
  program: ts.Program,
  options: CollectFileNodesOptions = {},
  into: Map<string, FileNode> = new Map()
): Map<string, FileNode> {
  const checker = program.getTypeChecker();

  for (const filePath of files) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      continue;
    }

    const imports = collectImports(sourceFile, program, options.rootDir);
    const exports = collectExports(sourceFile, program, options.userDecorators ?? []);
    const locals = collectLocals(sourceFile, checker);

    applySfcAdjustments(filePath, exports, locals);

    into.set(filePath, {
      filePath,
      imports,
      exports,
      locals,
    });
  }

  return into;
}

/**
 * Builds a dependency graph from the analyzed files.
 * @param userDecorators - Additional DI decorator names from user configuration.
 * @param containerFilePaths - Absolute paths of DI container files whose imports
 *   should all be treated as "used" (marks all exports of imported modules as used).
 * @param rootDir - Workspace root, used to resolve symlinked workspace packages.
 */
export function buildDependencyGraph(
  files: string[],
  program: ts.Program,
  userDecorators: string[] = [],
  containerFilePaths: Set<string> = new Set(),
  rootDir?: string
): DependencyGraph {
  const fileMap = collectFileNodes(files, program, { userDecorators, rootDir });
  return buildGraphFromFileNodes(fileMap, { containerFilePaths });
}

/**
 * Applies the two SFC-specific corrections:
 *  - a `.vue`/`.svelte` file is imported as a component, so it always has a
 *    default export even when its script block declares none;
 *  - script-level symbols referenced from the template are not visible to the
 *    compiler. Template hits only ever raise a reference count, so this can
 *    suppress a false positive but never create one.
 */
function applySfcAdjustments(
  filePath: string,
  exports: ExportInfo[],
  locals: FileNode['locals']
): void {
  const ext = sfcExtension(filePath);
  if (!ext) {
    return;
  }

  if (!exports.some((exp) => exp.name === 'default')) {
    exports.push({
      name: 'default',
      isDefault: true,
      isReExport: false,
      line: 1,
      column: 0,
      kind: 'default',
      isTypeOnly: false,
    });
  }

  const content = readSource(filePath);
  if (content === null) {
    return;
  }
  const template = extractSfcTemplate(content, ext);
  for (const local of locals) {
    if (local.references === 0) {
      local.references = Math.max(
        local.references,
        countTemplateReferences(template, local.name)
      );
    }
  }
}
