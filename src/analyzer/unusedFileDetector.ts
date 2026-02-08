import * as ts from 'typescript';
import type { DependencyGraph } from '../types';
import type { UnusedFileResult } from '../types/analysis';

/**
 * Detects unused files in the dependency graph
 */
export function detectUnusedFiles(
  graph: DependencyGraph,
  entryPoints: string[]
): UnusedFileResult[] {
  const entryPointSet = new Set(entryPoints);
  const unusedFiles: UnusedFileResult[] = [];

  for (const [filePath, fileNode] of Array.from(graph.files.entries())) {
    // Entry points are always considered used
    if (entryPointSet.has(filePath)) {
      continue;
    }

    const inboundCount = graph.inboundEdges.get(filePath)?.size || 0;

    // File is unused if no other file imports it
    if (inboundCount === 0) {
      const hasSideEffects = checkForSideEffects(filePath, fileNode);

      unusedFiles.push({
        filePath,
        confidence: hasSideEffects ? 'low' : 'medium',
        reason: hasSideEffects
          ? 'No imports found, but file may have side effects'
          : 'No imports found',
      });
    }
  }

  return unusedFiles;
}

/**
 * Checks if a file has side effects (statements beyond imports/exports)
 * This is a heuristic - files with side effects might still be unused,
 * but we mark them as low confidence
 */
function checkForSideEffects(
  filePath: string,
  fileNode: { imports: any[]; exports: any[]; locals: any[] }
): boolean {
  // If there are local symbols (non-exported declarations), the file likely has code
  if (fileNode.locals.length > 0) {
    return true;
  }

  // If there are exports that are not re-exports, the file has meaningful code
  const hasNonReExports = fileNode.exports.some((exp) => !exp.isReExport);
  if (hasNonReExports) {
    return true;
  }

  // Files with only imports and re-exports might just be barrel files
  // which are less likely to have side effects
  return false;
}
