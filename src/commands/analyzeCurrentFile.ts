import * as vscode from 'vscode';
import * as path from 'path';
import { runProjectAnalysis } from './runAnalysis';
import { log, logError } from '../utils/logger';
import { filterByConfidence } from '../utils/filterByConfidence';
import { detectLanguage } from '../analyzer/languages';
import type { AnalysisResult } from '../types';
import type { CommandDeps } from './index';

/**
 * Filters a full-project analysis result down to a single file.
 */
function filterResultToFile(result: AnalysisResult, filePath: string): AnalysisResult {
  return {
    ...result,
    unusedFiles: result.unusedFiles.filter((r) => r.filePath === filePath),
    unusedExports: result.unusedExports.filter((r) => r.filePath === filePath),
    unusedLocals: result.unusedLocals.filter((r) => r.filePath === filePath),
  };
}

/**
 * Module-level in-flight guard.
 *
 * `analyzeOnSave` calls this command for every save behind a 1-second debounce,
 * but a debounce bounds how often a run *starts*, not how long one takes: a
 * full-project analysis is measured in seconds, so on a real project saves
 * overlap. Two concurrent runs share the module-global source cache and clear
 * it in their `finally`, so each can observe a torn mix of pre- and post-save
 * file contents while both pay the full re-read cost.
 *
 * A boolean is enough because every run analyses the whole project: while one is
 * in flight, a second request has nothing extra to compute. Requests arriving
 * during a run are therefore dropped, not queued and not joined to the in-flight
 * promise — joining would resolve the caller against a result filtered to
 * whichever file was active when the *first* run started, which is the wrong
 * answer for the second caller. The next save (or a manual invocation) starts a
 * fresh, correct run.
 *
 * The flag is set and cleared without an intervening `await`-free window at the
 * top of the handler, so the check is atomic with respect to the event loop.
 */
let analysisInFlight = false;

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
          `File type ${ext} is not supported. Supported: TypeScript, JavaScript, Vue, Svelte, Python, Go, Java, Dart, PHP.`
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

      if (analysisInFlight) {
        log(`Analysis already in progress — skipping request for ${fileName}`);
        return;
      }
      analysisInFlight = true;

      try {
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

              // Run a full-project analysis, then filter results to this file so
              // that cross-file usage is correctly accounted for (see full-project
              // analysis requirement — a single-file graph incorrectly reports the
              // active file's own exports as unused).
              const { result: fullResult, analyzedFiles } = await runProjectAnalysis(rootDir, config);

              // The active file's extension may be recognized by `detectLanguage`
              // but still be excluded from this run by `include`/`exclude` globs
              // or a disabled `enabledLanguages` entry. In that case the file was
              // never analyzed, so an empty filtered result would misleadingly
              // read as "no dead code found" (a false all-clear). Detect that
              // case explicitly and tell the user the file was skipped instead.
              const normalizedFilePath = path.normalize(filePath);
              if (!analyzedFiles.includes(normalizedFilePath)) {
                statusBar.showIdle();
                vscode.window.showWarningMessage(
                  `${fileName} was skipped by the current configuration ` +
                  `(excluded by include/exclude patterns or a disabled language) ` +
                  `and was not analyzed.`
                );
                return;
              }

              const result = filterResultToFile(fullResult, normalizedFilePath);

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
      } finally {
        analysisInFlight = false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError('Failed to start file analysis', error);
      vscode.window.showErrorMessage(`Failed to start file analysis: ${errorMsg}`);
    }
  };
}
