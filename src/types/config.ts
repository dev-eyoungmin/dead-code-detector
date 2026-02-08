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
}

export type ReportFormat = 'html' | 'json' | 'markdown' | 'csv';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
