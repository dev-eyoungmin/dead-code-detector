import type { AnalysisResult, ReportFormat } from '../types';
import { toReportData } from './reportModel';
import { formatHtml } from './formatters/htmlFormatter';
import { formatJson } from './formatters/jsonFormatter';
import { formatMarkdown } from './formatters/markdownFormatter';
import { formatCsv } from './formatters/csvFormatter';

/**
 * Generates a report from analysis results in the specified format.
 *
 * @param result - The analysis result to generate a report from
 * @param rootDir - The root directory to make file paths relative to
 * @param format - The desired output format (html, json, markdown, or csv)
 * @returns The formatted report as a string
 * @throws Error if an unsupported format is provided
 */
export function generateReport(
  result: AnalysisResult,
  rootDir: string,
  format: ReportFormat
): string {
  const reportData = toReportData(result, rootDir);

  switch (format) {
    case 'html':
      return formatHtml(reportData);
    case 'json':
      return formatJson(reportData);
    case 'markdown':
      return formatMarkdown(reportData);
    case 'csv':
      return formatCsv(reportData);
    default:
      // TypeScript exhaustiveness check
      const exhaustiveCheck: never = format;
      throw new Error(`Unsupported report format: ${exhaustiveCheck}`);
  }
}

// Re-export types for convenience
export type { ReportData, ReportSummary, ReportItem } from './reportModel';
