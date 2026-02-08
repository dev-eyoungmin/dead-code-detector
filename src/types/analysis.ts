import type { ConfidenceLevel } from './config';

export interface AnalysisResult {
  unusedFiles: UnusedFileResult[];
  unusedExports: UnusedExportResult[];
  unusedLocals: UnusedLocalResult[];
  analyzedFileCount: number;
  totalExportCount: number;
  totalLocalCount: number;
  durationMs: number;
  timestamp: number;
}

export interface UnusedFileResult {
  filePath: string;
  confidence: ConfidenceLevel;
  reason: string;
}

export interface UnusedExportResult {
  filePath: string;
  exportName: string;
  line: number;
  column: number;
  confidence: ConfidenceLevel;
  kind: ExportKind;
}

export type ExportKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'default'
  | 'method'
  | 'constant'
  | 'struct'
  | 'module'
  | 'unknown';

export interface UnusedLocalResult {
  filePath: string;
  symbolName: string;
  line: number;
  column: number;
  confidence: ConfidenceLevel;
  kind: LocalKind;
}

export type LocalKind = 'variable' | 'function' | 'class' | 'parameter' | 'method' | 'constant' | 'field' | 'unknown';

export interface DeadCodeItem {
  type: 'file' | 'export' | 'local';
  filePath: string;
  symbolName?: string;
  line?: number;
  column?: number;
  confidence: ConfidenceLevel;
  kind?: string;
  reason?: string;
}
