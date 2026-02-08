import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';
import { DeadCodeTreeProvider } from './ui/treeView/deadCodeTreeProvider';
import { DiagnosticManager } from './ui/diagnostics/diagnosticManager';
import { DeadCodeActionProvider } from './ui/diagnostics/codeActionProvider';
import { StatusBarManager } from './ui/statusBar/statusBarManager';
import { ReportWebviewPanel } from './ui/webview/webviewPanel';
import {
  createAnalyzeProjectCommand,
  createAnalyzeCurrentFileCommand,
  createExportReportCommand,
  createClearResultsCommand,
  type CommandDeps,
} from './commands';
import { COMMANDS, VIEWS, DEBOUNCE_DELAY_MS } from './constants';
import { log, disposeLogger } from './utils/logger';
import { debounce } from './utils/debounce';
import { disposeAllAnalyzers } from './analyzer/languages';
import type { AnalysisResult } from './types';

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext): void {
  try {
    log('Activating Dead Code Detector extension...');

    // Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || '';

    // Create all managers and providers
    const configManager = new ConfigManager();
    const treeProvider = new DeadCodeTreeProvider(workspaceRoot);
    const diagnosticManager = new DiagnosticManager();
    const statusBar = new StatusBarManager();
    const webviewPanel = new ReportWebviewPanel();
    const actionProvider = new DeadCodeActionProvider();

    // Store last analysis result
    let lastResult: AnalysisResult | null = null;

    // Create command dependencies
    const deps: CommandDeps = {
      configManager,
      treeProvider,
      diagnosticManager,
      statusBar,
      webviewPanel,
      getLastResult: () => lastResult,
      setLastResult: (result) => {
        lastResult = result;
      },
      extensionUri: context.extensionUri,
    };

    // Register tree view
    const treeView = vscode.window.createTreeView(VIEWS.RESULTS, {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Register diagnostics
    context.subscriptions.push(diagnosticManager);

    // Register code action provider for all supported languages
    const selector: vscode.DocumentSelector = [
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'typescriptreact' },
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'javascriptreact' },
      { scheme: 'file', language: 'python' },
      { scheme: 'file', language: 'go' },
      { scheme: 'file', language: 'java' },
    ];

    const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
      selector,
      actionProvider,
      {
        providedCodeActionKinds: DeadCodeActionProvider.providedCodeActionKinds,
      }
    );
    context.subscriptions.push(codeActionDisposable);

    // Register commands
    const analyzeProjectCommand = vscode.commands.registerCommand(
      COMMANDS.ANALYZE_PROJECT,
      createAnalyzeProjectCommand(deps)
    );
    context.subscriptions.push(analyzeProjectCommand);

    const analyzeCurrentFileCommand = vscode.commands.registerCommand(
      COMMANDS.ANALYZE_CURRENT_FILE,
      createAnalyzeCurrentFileCommand(deps)
    );
    context.subscriptions.push(analyzeCurrentFileCommand);

    const exportReportCommand = vscode.commands.registerCommand(
      COMMANDS.EXPORT_REPORT,
      createExportReportCommand(deps)
    );
    context.subscriptions.push(exportReportCommand);

    const clearResultsCommand = vscode.commands.registerCommand(
      COMMANDS.CLEAR_RESULTS,
      createClearResultsCommand(deps)
    );
    context.subscriptions.push(clearResultsCommand);

    // Register status bar
    context.subscriptions.push(statusBar);

    // Set up file save listener with debounce for auto-analysis
    const analyzeOnSave = (...args: unknown[]): void => {
      const document = args[0] as vscode.TextDocument;
      // Only analyze supported language files
      const supportedLanguages = [
        'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
        'python', 'go', 'java',
      ];
      if (!supportedLanguages.includes(document.languageId)) {
        return;
      }

      // Run analysis on the current file (fire and forget)
      const command = createAnalyzeCurrentFileCommand(deps);
      void command();
    };

    let saveListenerDisposable: vscode.Disposable | undefined;
    let debouncedAnalyze = debounce(analyzeOnSave, DEBOUNCE_DELAY_MS);

    const registerSaveListener = (): void => {
      saveListenerDisposable = vscode.workspace.onDidSaveTextDocument(debouncedAnalyze);
    };

    const disposeSaveListener = (): void => {
      debouncedAnalyze.cancel();
      saveListenerDisposable?.dispose();
      saveListenerDisposable = undefined;
    };

    const config = configManager.getConfig();
    if (config.analyzeOnSave) {
      registerSaveListener();
    }

    // Set up config change listener
    configManager.onChange((newConfig) => {
      log(`Configuration changed: analyzeOnSave=${newConfig.analyzeOnSave}`);

      // Dispose existing save listener
      disposeSaveListener();

      // Re-register if analyzeOnSave is enabled
      if (newConfig.analyzeOnSave) {
        debouncedAnalyze = debounce(analyzeOnSave, DEBOUNCE_DELAY_MS);
        registerSaveListener();
        log('Auto-analysis on save is now enabled');
      } else {
        log('Auto-analysis on save is now disabled');
      }
    });

    // Ensure save listener is cleaned up on deactivation
    context.subscriptions.push({ dispose: disposeSaveListener });
    context.subscriptions.push(configManager);

    // Register webview panel
    context.subscriptions.push(webviewPanel);

    // Register tree provider
    context.subscriptions.push(treeProvider);

    // Show idle status
    statusBar.showIdle();

    log('Dead Code Detector extension activated successfully');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to activate Dead Code Detector: ${errorMsg}`);
    throw error;
  }
}

/**
 * Deactivate the extension
 */
export function deactivate(): void {
  log('Deactivating Dead Code Detector extension...');
  disposeAllAnalyzers();
  disposeLogger();
}
