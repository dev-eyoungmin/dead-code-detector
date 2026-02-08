import * as vscode from 'vscode';
import { AnalysisResult } from '../../types';
import { COMMANDS } from '../../constants';

/**
 * Manages the status bar item for the dead code detector
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = COMMANDS.ANALYZE_PROJECT;
    this.showIdle();
    this.item.show();
  }

  /**
   * Show analyzing state
   */
  showAnalyzing(): void {
    this.item.text = '$(loading~spin) Analyzing...';
    this.item.tooltip = 'Dead Code Detector is analyzing the workspace';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /**
   * Show results state
   */
  showResults(result: AnalysisResult): void {
    const totalIssues =
      result.unusedFiles.length +
      result.unusedExports.length +
      result.unusedLocals.length;

    if (totalIssues === 0) {
      this.item.text = '$(check) Dead Code: Clean';
      this.item.tooltip = this.createResultsTooltip(result);
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(warning) Dead: ${result.unusedFiles.length}F, ${result.unusedExports.length}E, ${result.unusedLocals.length}L`;
      this.item.tooltip = this.createResultsTooltip(result);
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.item.show();
  }

  /**
   * Show error state
   */
  showError(message: string): void {
    this.item.text = '$(error) Dead Code: Error';
    this.item.tooltip = `Dead Code Detector Error: ${message}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.show();
  }

  /**
   * Show idle state
   */
  showIdle(): void {
    this.item.text = '$(circle-outline) Dead Code';
    this.item.tooltip = 'Click to analyze workspace for dead code';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  /**
   * Clear and hide the status bar item
   */
  clear(): void {
    this.item.hide();
  }

  /**
   * Dispose of the status bar item
   */
  dispose(): void {
    this.item.dispose();
  }

  /**
   * Create detailed tooltip for results
   */
  private createResultsTooltip(result: AnalysisResult): string {
    const lines: string[] = [
      'Dead Code Analysis Results',
      '',
      `Unused Files: ${result.unusedFiles.length}`,
      `Unused Exports: ${result.unusedExports.length}`,
      `Unused Locals: ${result.unusedLocals.length}`,
      '',
      `Analyzed: ${result.analyzedFileCount} files`,
      `Total Exports: ${result.totalExportCount}`,
      `Total Locals: ${result.totalLocalCount}`,
      '',
      `Duration: ${result.durationMs}ms`,
      `Last Analysis: ${new Date(result.timestamp).toLocaleString()}`,
      '',
      'Click to run analysis again',
    ];

    return lines.join('\n');
  }
}
