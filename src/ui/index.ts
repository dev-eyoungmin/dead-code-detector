/**
 * UI Module
 *
 * Provides all UI components for the VS Code extension including:
 * - Tree view for displaying dead code results
 * - Diagnostics for the Problems panel
 * - Code actions for quick fixes
 * - Status bar integration
 * - Webview panel for HTML reports
 */

// Tree View
export { DeadCodeTreeProvider } from './treeView/deadCodeTreeProvider';
export { TreeItemBase, CategoryItem, DeadCodeTreeItem } from './treeView/treeItems';

// Diagnostics
export { DiagnosticManager } from './diagnostics/diagnosticManager';
export { DeadCodeActionProvider } from './diagnostics/codeActionProvider';

// Status Bar
export { StatusBarManager } from './statusBar/statusBarManager';

// Webview
export { ReportWebviewPanel } from './webview/webviewPanel';
export { handleWebviewMessage, WebviewMessage } from './webview/messageHandler';
