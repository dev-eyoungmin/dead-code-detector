import * as vscode from 'vscode';

/**
 * Message types that can be sent from the webview
 */
export interface WebviewMessage {
  command: string;
  [key: string]: unknown;
}

/**
 * Message to open a file at a specific location
 */
export interface OpenFileMessage extends WebviewMessage {
  command: 'openFile';
  filePath: string;
  line?: number;
}

/**
 * Message to export data in a specific format
 */
export interface ExportMessage extends WebviewMessage {
  command: 'export';
  format: string;
}

/**
 * Handle messages received from the webview
 */
export async function handleWebviewMessage(message: WebviewMessage): Promise<void> {
  switch (message.command) {
    case 'openFile':
      await handleOpenFile(message as OpenFileMessage);
      break;

    case 'export':
      await handleExport(message as ExportMessage);
      break;

    default:
      void vscode.window.showWarningMessage(`Unknown webview message command: ${message.command}`);
  }
}

/**
 * Handle request to open a file
 */
async function handleOpenFile(message: OpenFileMessage): Promise<void> {
  try {
    const uri = vscode.Uri.file(message.filePath);
    const options: vscode.TextDocumentShowOptions = {};

    if (message.line !== undefined) {
      // Convert to 0-based line number
      const line = Math.max(0, message.line - 1);
      options.selection = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(line, 0)
      );
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, options);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open file: ${message.filePath}. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle request to export data
 */
async function handleExport(message: ExportMessage): Promise<void> {
  try {
    const format = message.format.toLowerCase();

    // Show save dialog
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`dead-code-report.${format}`),
      filters: getExportFilters(format),
    });

    if (!uri) {
      // User cancelled
      return;
    }

    // The export logic would be implemented here
    // For now, just show a message
    vscode.window.showInformationMessage(
      `Export to ${format} format would be saved to ${uri.fsPath}`
    );

    // TODO: Implement actual export logic based on format
    // This would involve getting the current analysis results
    // and formatting them according to the requested format
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export data: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get file filters for save dialog based on export format
 */
function getExportFilters(format: string): Record<string, string[]> {
  switch (format) {
    case 'json':
      return { 'JSON': ['json'] };
    case 'csv':
      return { 'CSV': ['csv'] };
    case 'html':
      return { 'HTML': ['html'] };
    case 'markdown':
    case 'md':
      return { 'Markdown': ['md'] };
    default:
      return { 'All Files': ['*'] };
  }
}
