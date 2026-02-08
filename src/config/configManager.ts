import * as vscode from 'vscode';
import type { ExtensionConfig, SupportedLanguage } from '../types';
import { EXTENSION_ID, DEFAULT_INCLUDE_PATTERNS, DEFAULT_EXCLUDE_PATTERNS } from '../constants';

/**
 * Manages VS Code configuration for the extension
 */
export class ConfigManager {
  private disposable: vscode.Disposable;
  private changeListeners: Array<(config: ExtensionConfig) => void> = [];

  constructor() {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(EXTENSION_ID)) {
        const config = this.getConfig();
        this.changeListeners.forEach((listener) => listener(config));
      }
    });
  }

  /**
   * Get the current extension configuration
   */
  getConfig(): ExtensionConfig {
    const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
    return {
      include: cfg.get<string[]>('include', DEFAULT_INCLUDE_PATTERNS),
      exclude: cfg.get<string[]>('exclude', DEFAULT_EXCLUDE_PATTERNS),
      entryPoints: cfg.get<string[]>('entryPoints', []),
      analyzeOnSave: cfg.get<boolean>('analyzeOnSave', true),
      reportFormat: cfg.get<'html' | 'json' | 'markdown' | 'csv'>('reportFormat', 'html'),
      confidenceThreshold: cfg.get<'high' | 'medium' | 'low'>('confidenceThreshold', 'medium'),
      ignorePatterns: cfg.get<string[]>('ignorePatterns', []),
      enabledLanguages: cfg.get<SupportedLanguage[]>('enabledLanguages', ['typescript', 'python', 'go', 'java']),
    };
  }

  /**
   * Register a listener for configuration changes
   */
  onChange(listener: (config: ExtensionConfig) => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.disposable.dispose();
    this.changeListeners = [];
  }
}
