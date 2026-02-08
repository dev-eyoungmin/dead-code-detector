import * as ts from 'typescript';
import type { DependencyGraph, FileNode } from '../types';
import { collectImports } from './importCollector';
import { collectExports } from './exportCollector';
import { collectLocals } from './localSymbolCollector';

/**
 * Builds a dependency graph from the analyzed files
 */
export function buildDependencyGraph(
  files: string[],
  program: ts.Program
): DependencyGraph {
  const fileMap = new Map<string, FileNode>();
  const inboundEdges = new Map<string, Set<string>>();
  const outboundEdges = new Map<string, Set<string>>();
  const exportUsages = new Map<string, Set<string>>();
  const checker = program.getTypeChecker();

  // First pass: collect all file nodes
  for (const filePath of files) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      continue;
    }

    const imports = collectImports(sourceFile, program);
    const exports = collectExports(sourceFile);
    const locals = collectLocals(sourceFile, checker);

    const fileNode: FileNode = {
      filePath,
      imports,
      exports,
      locals,
    };

    fileMap.set(filePath, fileNode);

    // Initialize edge maps
    inboundEdges.set(filePath, new Set());
    outboundEdges.set(filePath, new Set());

    // Initialize export usages for this file
    for (const exp of exports) {
      const key = makeExportKey(filePath, exp.name);
      exportUsages.set(key, new Set());
    }
  }

  // Second pass: build edges and track export usages
  for (const [filePath, fileNode] of Array.from(fileMap.entries())) {
    for (const importInfo of fileNode.imports) {
      const resolvedPath = importInfo.resolvedPath;

      // Skip external modules
      if (!fileMap.has(resolvedPath)) {
        continue;
      }

      // Add edges
      outboundEdges.get(filePath)!.add(resolvedPath);
      inboundEdges.get(resolvedPath)!.add(filePath);

      // Track which exports are being imported
      const targetFile = fileMap.get(resolvedPath);
      if (!targetFile) {
        continue;
      }

      if (importInfo.isNamespaceImport) {
        // For namespace imports (import * as X), mark ALL exports as used
        for (const exp of targetFile.exports) {
          const key = makeExportKey(resolvedPath, exp.name);
          const usages = exportUsages.get(key);
          if (usages) {
            usages.add(filePath);
          }
        }
      } else {
        // For named imports, only mark the specific exports as used
        for (const specifier of importInfo.specifiers) {
          const importedName = specifier.name;
          const key = makeExportKey(resolvedPath, importedName);
          const usages = exportUsages.get(key);
          if (usages) {
            usages.add(filePath);
          }
        }
      }
    }
  }

  return {
    files: fileMap,
    inboundEdges,
    outboundEdges,
    exportUsages,
  };
}

/**
 * Creates a unique key for tracking export usage
 */
export function makeExportKey(filePath: string, exportName: string): string {
  return `${filePath}::${exportName}`;
}

/**
 * Parses an export key back into file path and export name
 */
export function parseExportKey(key: string): {
  filePath: string;
  exportName: string;
} {
  const lastIndex = key.lastIndexOf('::');
  if (lastIndex === -1) {
    throw new Error(`Invalid export key format (missing "::" separator): "${key}"`);
  }
  return {
    filePath: key.substring(0, lastIndex),
    exportName: key.substring(lastIndex + 2),
  };
}
