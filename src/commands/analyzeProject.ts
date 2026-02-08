import * as vscode from 'vscode';
import { scanFiles } from '../scanner';
import { analyze } from '../analyzer';
import { log, logError } from '../utils/logger';
import { filterByConfidence } from '../utils/filterByConfidence';
import { getAllAnalyzers } from '../analyzer/languages';
import type { CommandDeps } from './index';

/**
 * Create command handler for analyzing the entire project
 */
export function createAnalyzeProjectCommand(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const {
      configManager,
      treeProvider,
      diagnosticManager,
      statusBar,
      setLastResult,
    } = deps;

    try {
      // Get workspace root folder
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
            // Step 1: Update status and scan files
            statusBar.showAnalyzing();
            progress.report({ message: 'Scanning files...' });
            log('Starting project analysis...');

            const scanResult = await scanFiles({
              rootDir,
              include: config.include,
              exclude: config.exclude,
            });

            log(`Scanned ${scanResult.files.length} files in ${scanResult.durationMs}ms`);

            if (scanResult.files.length === 0) {
              vscode.window.showInformationMessage('No files found to analyze');
              statusBar.showIdle();
              return;
            }

            // Step 2: Find entry points
            progress.report({ message: 'Finding entry points...' });
            let entryPoints = config.entryPoints;

            if (entryPoints.length === 0) {
              entryPoints = await findEntryPoints(rootDir);
              log(`Auto-detected entry points: ${entryPoints.join(', ')}`);
            } else {
              log(`Using configured entry points: ${entryPoints.join(', ')}`);
            }

            // Step 3: Run analysis
            progress.report({ message: 'Analyzing code...' });
            const result = await analyze({
              files: scanResult.files,
              rootDir,
              entryPoints,
            });

            log(
              `Analysis complete: ${result.unusedFiles.length} unused files, ` +
              `${result.unusedExports.length} unused exports, ` +
              `${result.unusedLocals.length} unused locals`
            );

            // Step 4: Filter by confidence threshold
            progress.report({ message: 'Filtering results...' });
            const filteredResult = filterByConfidence(result, config.confidenceThreshold);

            // Step 5: Update UI
            progress.report({ message: 'Updating UI...' });
            setLastResult(filteredResult);
            treeProvider.refresh(filteredResult);
            diagnosticManager.update(filteredResult);
            statusBar.showResults(filteredResult);

            // Step 6: Show summary
            const totalIssues =
              filteredResult.unusedFiles.length +
              filteredResult.unusedExports.length +
              filteredResult.unusedLocals.length;

            if (totalIssues === 0) {
              vscode.window.showInformationMessage(
                `No dead code found! Analyzed ${result.analyzedFileCount} files.`
              );
            } else {
              vscode.window.showInformationMessage(
                `Found ${totalIssues} potential dead code issues. ` +
                `Check the Dead Code Detector view for details.`
              );
            }

            log(`Analysis completed in ${result.durationMs}ms`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logError('Analysis failed', error);
            statusBar.showError(errorMsg);
            vscode.window.showErrorMessage(`Dead Code Analysis failed: ${errorMsg}`);
          }
        }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError('Failed to start analysis', error);
      vscode.window.showErrorMessage(`Failed to start analysis: ${errorMsg}`);
    }
  };
}

/**
 * Find entry points automatically by collecting from all registered language analyzers
 */
async function findEntryPoints(rootDir: string): Promise<string[]> {
  const entryPoints: string[] = [];
  const analyzers = getAllAnalyzers();

  for (const analyzer of analyzers) {
    const points = await analyzer.findEntryPoints(rootDir);
    for (const point of points) {
      if (!entryPoints.includes(point)) {
        entryPoints.push(point);
      }
    }
  }

  return entryPoints;
}

