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
          } else {
            // If named import not found in direct exports, check star re-exports
            const resolved = resolveStarReExport(resolvedPath, importedName, fileMap, exportUsages);
            if (resolved) {
              resolved.add(filePath);
            }
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
 * Resolves a named import through star re-export chains.
 * When a file does `export * from './other'`, named imports from that file
 * need to be traced to the actual source module.
 */
function resolveStarReExport(
  filePath: string,
  exportName: string,
  fileMap: Map<string, FileNode>,
  exportUsages: Map<string, Set<string>>,
  visited?: Set<string>
): Set<string> | undefined {
  // Prevent infinite loops in circular re-exports
  if (!visited) {
    visited = new Set();
  }
  if (visited.has(filePath)) {
    return undefined;
  }
  visited.add(filePath);

  const file = fileMap.get(filePath);
  if (!file) {
    return undefined;
  }

  for (const exp of file.exports) {
    if (exp.name === '*' && exp.isReExport && exp.reExportSource) {
      // Find the resolved path for this re-export source via the file's imports
      for (const imp of file.imports) {
        if (imp.source === exp.reExportSource && fileMap.has(imp.resolvedPath)) {
          const key = makeExportKey(imp.resolvedPath, exportName);
          const usages = exportUsages.get(key);
          if (usages) {
            return usages;
          }
          // Recursively follow the chain
          const deeper = resolveStarReExport(imp.resolvedPath, exportName, fileMap, exportUsages, visited);
          if (deeper) {
            return deeper;
          }
        }
      }
    }
  }
  return undefined;
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
