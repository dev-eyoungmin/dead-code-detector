import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from '../constants';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return outputChannel;
}

export function log(message: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const errMsg = error instanceof Error ? error.message : String(error ?? '');
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ERROR: ${message} ${errMsg}`);
}

export function disposeLogger(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
