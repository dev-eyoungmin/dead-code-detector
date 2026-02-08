import type { AnalysisResult } from '../types';
import path from 'path';

export interface ReportData {
  summary: ReportSummary;
  items: ReportItem[];
  generatedAt: string;
}

export interface ReportSummary {
  unusedFileCount: number;
  unusedExportCount: number;
  unusedLocalCount: number;
  analyzedFileCount: number;
  totalExportCount: number;
  totalLocalCount: number;
  durationMs: number;
}

export interface ReportItem {
  type: 'file' | 'export' | 'local';
  filePath: string;
  symbolName: string;
  line: number;
  column: number;
  confidence: string;
  kind: string;
  reason: string;
}

/**
 * Converts an AnalysisResult into a normalized ReportData structure.
 * Makes file paths relative to rootDir and sorts items by type and path.
 */
export function toReportData(result: AnalysisResult, rootDir: string): ReportData {
  const items: ReportItem[] = [];

  // Convert unused files to report items
  for (const file of result.unusedFiles) {
    items.push({
      type: 'file',
      filePath: makeRelativePath(file.filePath, rootDir),
      symbolName: '',
      line: 0,
      column: 0,
      confidence: file.confidence,
      kind: 'file',
      reason: file.reason,
    });
  }

  // Convert unused exports to report items
  for (const exp of result.unusedExports) {
    items.push({
      type: 'export',
      filePath: makeRelativePath(exp.filePath, rootDir),
      symbolName: exp.exportName,
      line: exp.line,
      column: exp.column,
      confidence: exp.confidence,
      kind: exp.kind,
      reason: '',
    });
  }

  // Convert unused locals to report items
  for (const local of result.unusedLocals) {
    items.push({
      type: 'local',
      filePath: makeRelativePath(local.filePath, rootDir),
      symbolName: local.symbolName,
      line: local.line,
      column: local.column,
      confidence: local.confidence,
      kind: local.kind,
      reason: '',
    });
  }

  // Sort items: files first, then exports, then locals; within each group sort by filePath
  const typeOrder: Record<string, number> = { file: 0, export: 1, local: 2 };
  items.sort((a, b) => {
    const typeComparison = typeOrder[a.type] - typeOrder[b.type];

    if (typeComparison !== 0) {
      return typeComparison;
    }

    // Within same type, sort by filePath
    const pathComparison = a.filePath.localeCompare(b.filePath);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    // Within same file, sort by line number
    return a.line - b.line;
  });

  return {
    summary: {
      unusedFileCount: result.unusedFiles.length,
      unusedExportCount: result.unusedExports.length,
      unusedLocalCount: result.unusedLocals.length,
      analyzedFileCount: result.analyzedFileCount,
      totalExportCount: result.totalExportCount,
      totalLocalCount: result.totalLocalCount,
      durationMs: result.durationMs,
    },
    items,
    generatedAt: new Date(result.timestamp).toISOString(),
  };
}

/**
 * Makes a file path relative to the root directory for display purposes.
 */
function makeRelativePath(filePath: string, rootDir: string): string {
  try {
    const relativePath = path.relative(rootDir, filePath);
    // If the path is not under rootDir, return the absolute path
    if (relativePath.startsWith('..')) {
      return filePath;
    }
    return relativePath;
  } catch {
    return filePath;
  }
}
