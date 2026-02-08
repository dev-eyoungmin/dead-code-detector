import type { AnalysisResult } from '../types';
import type { ConfigManager } from '../config/configManager';
import type { DeadCodeTreeProvider } from '../ui/treeView/deadCodeTreeProvider';
import type { DiagnosticManager } from '../ui/diagnostics/diagnosticManager';
import type { StatusBarManager } from '../ui/statusBar/statusBarManager';
import type { ReportWebviewPanel } from '../ui/webview/webviewPanel';

/**
 * Dependencies required by command handlers
 */
export interface CommandDeps {
  configManager: ConfigManager;
  treeProvider: DeadCodeTreeProvider;
  diagnosticManager: DiagnosticManager;
  statusBar: StatusBarManager;
  webviewPanel: ReportWebviewPanel;
  getLastResult: () => AnalysisResult | null;
  setLastResult: (result: AnalysisResult | null) => void;
  extensionUri: import('vscode').Uri;
}

export { createAnalyzeProjectCommand } from './analyzeProject';
export { createAnalyzeCurrentFileCommand } from './analyzeCurrentFile';
export { createExportReportCommand } from './exportReport';
export { createClearResultsCommand } from './clearResults';
