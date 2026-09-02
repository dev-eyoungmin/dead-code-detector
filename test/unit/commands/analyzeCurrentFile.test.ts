import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AnalysisResult } from '../../../src/types';
import type { CommandDeps } from '../../../src/commands';

vi.mock('../../../src/commands/runAnalysis', () => ({
  runProjectAnalysis: vi.fn(),
}));

import { runProjectAnalysis } from '../../../src/commands/runAnalysis';
import { createAnalyzeCurrentFileCommand } from '../../../src/commands/analyzeCurrentFile';

const filePath = path.join(path.sep, 'workspace', 'src', 'index.ts');

const emptyResult: AnalysisResult = {
  unusedFiles: [],
  unusedExports: [],
  unusedLocals: [],
  analyzedFileCount: 1,
  totalExportCount: 0,
  totalLocalCount: 0,
  durationMs: 1,
  timestamp: 0,
};

function createDeps(): CommandDeps {
  return {
    configManager: {
      getConfig: () => ({ confidenceThreshold: 'medium' }),
    },
    treeProvider: { refresh: () => {} },
    diagnosticManager: { update: () => {} },
    statusBar: {
      showAnalyzing: () => {},
      showResults: () => {},
      showIdle: () => {},
      showError: () => {},
    },
    setLastResult: () => {},
  } as unknown as CommandDeps;
}

describe('analyzeCurrentFile in-flight guard', () => {
  const mocked = vi.mocked(runProjectAnalysis);

  beforeEach(() => {
    mocked.mockReset();
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { uri: { fsPath: filePath } },
    };
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { fsPath: path.join(path.sep, 'workspace') } },
    ];
  });

  afterEach(() => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [];
  });

  it('does not start a second analysis while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocked.mockImplementation(async () => {
      await gate;
      return { result: emptyResult, fileCount: 1, entryPoints: [], analyzedFiles: [filePath] };
    });

    const command = createAnalyzeCurrentFileCommand(createDeps());
    const first = command();
    // A second save arrives (each save builds a fresh command closure, so the
    // guard has to live at module level).
    const second = createAnalyzeCurrentFileCommand(createDeps())();

    expect(mocked).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('allows a new analysis once the previous one finished', async () => {
    mocked.mockResolvedValue({
      result: emptyResult,
      fileCount: 1,
      entryPoints: [],
      analyzedFiles: [filePath],
    });

    await createAnalyzeCurrentFileCommand(createDeps())();
    await createAnalyzeCurrentFileCommand(createDeps())();

    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when the analysis throws', async () => {
    mocked.mockRejectedValueOnce(new Error('boom'));
    await createAnalyzeCurrentFileCommand(createDeps())();

    mocked.mockResolvedValue({
      result: emptyResult,
      fileCount: 1,
      entryPoints: [],
      analyzedFiles: [filePath],
    });
    await createAnalyzeCurrentFileCommand(createDeps())();

    expect(mocked).toHaveBeenCalledTimes(2);
  });
});
