import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateReport } from '../reporter';
import { log, logError } from '../utils/logger';
import type { CommandDeps } from './index';
import type { ReportFormat } from '../types';

/**
 * Create command handler for exporting analysis report
 */
export function createExportReportCommand(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const { configManager, getLastResult, webviewPanel, extensionUri } = deps;

    try {
      // Check if there are results to export
      const result = getLastResult();
      if (!result) {
        vscode.window.showInformationMessage(
          'No analysis results available. Please run analysis first.'
        );
        return;
      }

      // Get workspace root
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootDir = workspaceFolders[0].uri.fsPath;
      const config = configManager.getConfig();

      // Show quick pick for format selection
      const formatOptions: Array<{ label: string; value: ReportFormat; description: string }> = [
        {
          label: 'HTML',
          value: 'html',
          description: 'Interactive HTML report (recommended)',
        },
        {
          label: 'Markdown',
          value: 'markdown',
          description: 'Markdown formatted report',
        },
        {
          label: 'JSON',
          value: 'json',
          description: 'Structured JSON data',
        },
        {
          label: 'CSV',
          value: 'csv',
          description: 'Comma-separated values',
        },
      ];

      // Sort to put default format first
      formatOptions.sort((a, b) => {
        if (a.value === config.reportFormat) return -1;
        if (b.value === config.reportFormat) return 1;
        return 0;
      });

      const selectedFormat = await vscode.window.showQuickPick(formatOptions, {
        placeHolder: 'Select report format',
        title: 'Export Dead Code Report',
      });

      if (!selectedFormat) {
        return; // User cancelled
      }

      const format = selectedFormat.value;

      // Generate report
      log(`Generating ${format} report...`);
      const reportContent = generateReport(result, rootDir, format);

      // For HTML format, offer to show in webview or save
      if (format === 'html') {
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Show in Editor', value: 'view' },
            { label: 'Save to File', value: 'save' },
            { label: 'Both', value: 'both' },
          ],
          {
            placeHolder: 'Choose action for HTML report',
          }
        );

        if (!action) {
          return; // User cancelled
        }

        if (action.value === 'view' || action.value === 'both') {
          webviewPanel.show(reportContent, extensionUri);
          log('Showing HTML report in webview');
        }

        if (action.value === 'save' || action.value === 'both') {
          await saveReportToFile(reportContent, format, rootDir);
        }
      } else {
        // For non-HTML formats, just save to file
        await saveReportToFile(reportContent, format, rootDir);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError('Failed to export report', error);
      vscode.window.showErrorMessage(`Failed to export report: ${errorMsg}`);
    }
  };
}

/**
 * Save report content to a file
 */
async function saveReportToFile(
  content: string,
  format: ReportFormat,
  defaultUri: string
): Promise<void> {
  const extension = getFileExtension(format);
  const defaultFileName = `dead-code-report-${getTimestamp()}.${extension}`;

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(defaultUri, defaultFileName)),
    filters: getFileFilters(format),
    saveLabel: 'Export Report',
  });

  if (!saveUri) {
    return; // User cancelled
  }

  try {
    fs.writeFileSync(saveUri.fsPath, content, 'utf-8');
    log(`Report saved to: ${saveUri.fsPath}`);

    const action = await vscode.window.showInformationMessage(
      `Report exported to ${path.basename(saveUri.fsPath)}`,
      'Open File',
      'Show in Folder'
    );

    if (action === 'Open File') {
      const doc = await vscode.workspace.openTextDocument(saveUri);
      await vscode.window.showTextDocument(doc);
    } else if (action === 'Show in Folder') {
      vscode.commands.executeCommand('revealFileInOS', saveUri);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logError('Failed to save report file', error);
    throw new Error(`Failed to save report: ${errorMsg}`);
  }
}

/**
 * Get file extension for the given format
 */
function getFileExtension(format: ReportFormat): string {
  switch (format) {
    case 'html':
      return 'html';
    case 'json':
      return 'json';
    case 'markdown':
      return 'md';
    case 'csv':
      return 'csv';
    default:
      return 'txt';
  }
}

/**
 * Get file filters for save dialog
 */
function getFileFilters(format: ReportFormat): Record<string, string[]> {
  switch (format) {
    case 'html':
      return { 'HTML Files': ['html'] };
    case 'json':
      return { 'JSON Files': ['json'] };
    case 'markdown':
      return { 'Markdown Files': ['md'] };
    case 'csv':
      return { 'CSV Files': ['csv'] };
    default:
      return { 'All Files': ['*'] };
  }
}

/**
 * Get current timestamp for filename
 */
function getTimestamp(): string {
  const now = new Date();
  return now
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\..+/, '')
    .replace('T', '_');
}
