import type { ReportData } from '../reportModel';

/**
 * Formats a ReportData as CSV with proper field escaping.
 */
export function formatCsv(data: ReportData): string {
  const { items } = data;

  const lines: string[] = [];

  // CSV Header
  lines.push('Type,File,Symbol,Line,Column,Confidence,Kind,Reason');

  // CSV Rows
  for (const item of items) {
    const row = [
      item.type,
      item.filePath,
      item.symbolName || '',
      item.line.toString(),
      item.column.toString(),
      item.confidence,
      item.kind,
      item.reason || '',
    ];

    // Escape and join fields
    const escapedRow = row.map(escapeCsvField).join(',');
    lines.push(escapedRow);
  }

  return lines.join('\n');
}

/**
 * Escapes a CSV field by always wrapping in quotes to prevent formula injection.
 * Fields starting with =, +, -, or @ could be interpreted as formulas by spreadsheet software.
 */
function escapeCsvField(field: string): string {
  return `"${field.replace(/"/g, '""')}"`;
}
