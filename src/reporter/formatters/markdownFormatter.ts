import type { ReportData } from '../reportModel';

/**
 * Formats a ReportData as a Markdown document with tables and sections.
 */
export function formatMarkdown(data: ReportData): string {
  const { summary, items, generatedAt } = data;

  const lines: string[] = [];

  // Title
  lines.push('# Dead Code Detection Report');
  lines.push('');
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push('');

  // Summary Section
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Unused Files | ${summary.unusedFileCount} |`);
  lines.push(`| Unused Exports | ${summary.unusedExportCount} |`);
  lines.push(`| Unused Locals | ${summary.unusedLocalCount} |`);
  lines.push(`| Analyzed Files | ${summary.analyzedFileCount} |`);
  lines.push(`| Total Exports | ${summary.totalExportCount} |`);
  lines.push(`| Total Locals | ${summary.totalLocalCount} |`);
  lines.push(`| Analysis Duration | ${summary.durationMs}ms |`);
  lines.push('');

  // Unused Files Section
  const unusedFiles = items.filter(item => item.type === 'file');
  if (unusedFiles.length > 0) {
    lines.push('## Unused Files');
    lines.push('');
    lines.push('| File | Confidence | Reason |');
    lines.push('|------|------------|--------|');
    for (const item of unusedFiles) {
      lines.push(
        `| \`${escapeMarkdown(item.filePath)}\` | ${item.confidence} | ${escapeMarkdown(item.reason)} |`
      );
    }
    lines.push('');
  }

  // Unused Exports Section
  const unusedExports = items.filter(item => item.type === 'export');
  if (unusedExports.length > 0) {
    lines.push('## Unused Exports');
    lines.push('');
    lines.push('| File | Symbol | Location | Confidence | Kind |');
    lines.push('|------|--------|----------|------------|------|');
    for (const item of unusedExports) {
      const location = item.line > 0 ? `${item.line}:${item.column}` : '-';
      lines.push(
        `| \`${escapeMarkdown(item.filePath)}\` | \`${escapeMarkdown(item.symbolName)}\` | ${location} | ${item.confidence} | ${item.kind} |`
      );
    }
    lines.push('');
  }

  // Unused Locals Section
  const unusedLocals = items.filter(item => item.type === 'local');
  if (unusedLocals.length > 0) {
    lines.push('## Unused Locals');
    lines.push('');
    lines.push('| File | Symbol | Location | Confidence | Kind |');
    lines.push('|------|--------|----------|------------|------|');
    for (const item of unusedLocals) {
      const location = item.line > 0 ? `${item.line}:${item.column}` : '-';
      lines.push(
        `| \`${escapeMarkdown(item.filePath)}\` | \`${escapeMarkdown(item.symbolName)}\` | ${location} | ${item.confidence} | ${item.kind} |`
      );
    }
    lines.push('');
  }

  // Empty state
  if (items.length === 0) {
    lines.push('## Results');
    lines.push('');
    lines.push('✨ No dead code detected!');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Escapes special Markdown characters in text.
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`');
}
