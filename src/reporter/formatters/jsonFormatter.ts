import type { ReportData } from '../reportModel';

/**
 * Formats a ReportData as pretty-printed JSON with 2-space indentation.
 */
export function formatJson(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}
