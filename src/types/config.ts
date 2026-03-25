import type { SupportedLanguage } from './language';

export interface ExtensionConfig {
  include: string[];
  exclude: string[];
  entryPoints: string[];
  analyzeOnSave: boolean;
  reportFormat: ReportFormat;
  confidenceThreshold: ConfidenceLevel;
  ignorePatterns: string[];
  enabledLanguages: SupportedLanguage[];
  /** Decorator/annotation names that mark a class/function as a DI entry point */
  entryPointDecorators: string[];
  /** Files whose all imports are treated as used (e.g., DI container registration files) */
  containerFiles: string[];
  /** Export name glob patterns that are always considered used */
  alwaysUsedPatterns: string[];
}

export type ReportFormat = 'html' | 'json' | 'markdown' | 'csv';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
