import * as vscode from 'vscode';
import * as path from 'path';
import { analyzeFile } from '../analyzer';
import { log, logError } from '../utils/logger';
import { filterByConfidence } from '../utils/filterByConfidence';
import { detectLanguage } from '../analyzer/languages';
import type { CommandDeps } from './index';

/**
 * Create command handler for analyzing the current file
 */
export function createAnalyzeCurrentFileCommand(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const {
      configManager,
      treeProvider,
      diagnosticManager,
      statusBar,
      setLastResult,
    } = deps;

    try {
      // Get active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active file to analyze');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const fileName = path.basename(filePath);

      // Check if file is a supported type
      const language = detectLanguage(filePath);
      if (!language) {
        const ext = path.extname(filePath);
        vscode.window.showErrorMessage(
          `File type ${ext} is not supported. Supported: TypeScript, JavaScript, Python, Go, Java.`
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

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Dead Code Detector',
          cancellable: false,
        },
        async (progress) => {
          try {
            statusBar.showAnalyzing();
            progress.report({ message: `Analyzing ${fileName}...` });
            log(`Analyzing file: ${filePath}`);

            // Run analysis on the current file
            const result = await analyzeFile(filePath, {
              files: [filePath],
              rootDir,
              entryPoints: config.entryPoints,
            });

            log(
              `File analysis complete: ${result.unusedExports.length} unused exports, ` +
              `${result.unusedLocals.length} unused locals`
            );

            // Filter by confidence threshold
            const filteredResult = filterByConfidence(result, config.confidenceThreshold);

            // Update UI
            setLastResult(filteredResult);
            treeProvider.refresh(filteredResult);
            diagnosticManager.update(filteredResult);
            statusBar.showResults(filteredResult);

            // Show summary
            const totalIssues =
              filteredResult.unusedFiles.length +
              filteredResult.unusedExports.length +
              filteredResult.unusedLocals.length;

            if (totalIssues === 0) {
              vscode.window.showInformationMessage(
                `No dead code found in ${fileName}`
              );
            } else {
              vscode.window.showInformationMessage(
                `Found ${totalIssues} potential dead code issues in ${fileName}`
              );
            }

            log(`File analysis completed in ${result.durationMs}ms`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logError('File analysis failed', error);
            statusBar.showError(errorMsg);
            vscode.window.showErrorMessage(`File analysis failed: ${errorMsg}`);
          }
        }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError('Failed to start file analysis', error);
      vscode.window.showErrorMessage(`Failed to start file analysis: ${errorMsg}`);
    }
  };
}

