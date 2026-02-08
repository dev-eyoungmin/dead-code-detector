import * as vscode from 'vscode';
import { log } from '../utils/logger';
import type { CommandDeps } from './index';

/**
 * Create command handler for clearing analysis results
 */
export function createClearResultsCommand(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const { treeProvider, diagnosticManager, statusBar, setLastResult } = deps;

    try {
      // Clear all UI components
      treeProvider.clear();
      diagnosticManager.clear();
      statusBar.showIdle();
      setLastResult(null);

      log('Analysis results cleared');

      vscode.window.showInformationMessage('Dead code analysis results cleared');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to clear results: ${errorMsg}`);
    }
  };
}
