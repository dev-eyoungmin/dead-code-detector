import * as vscode from 'vscode';

/**
 * Provides code actions (quick fixes) for dead code diagnostics
 */
export class DeadCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  /**
   * Provide code actions for the given document and range
   */
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Filter for dead code diagnostics
    const deadCodeDiagnostics = context.diagnostics.filter(
      diagnostic => diagnostic.source === 'Dead Code Detector'
    );

    for (const diagnostic of deadCodeDiagnostics) {
      const code = typeof diagnostic.code === 'object'
        ? String((diagnostic.code as { value: string | number }).value)
        : String(diagnostic.code ?? '');

      if (code === 'unused-export') {
        actions.push(...this.createExportActions(document, diagnostic));
      } else if (code === 'unused-local') {
        actions.push(...this.createLocalActions(document, diagnostic));
      } else if (code === 'unused-file') {
        actions.push(...this.createFileActions(document, diagnostic));
      }

      // Add ignore action for all types
      actions.push(this.createIgnoreAction(document, diagnostic));
    }

    return actions;
  }

  /**
   * Create actions for unused exports
   */
  private createExportActions(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Action: Remove export keyword
    const removeExportAction = new vscode.CodeAction(
      'Remove export keyword',
      vscode.CodeActionKind.QuickFix
    );
    removeExportAction.diagnostics = [diagnostic];
    removeExportAction.edit = this.createRemoveExportEdit(document, diagnostic.range);
    removeExportAction.isPreferred = true;
    actions.push(removeExportAction);

    return actions;
  }

  /**
   * Create actions for unused locals
   */
  private createLocalActions(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Action: Prefix with underscore
    const prefixAction = new vscode.CodeAction(
      'Prefix with underscore',
      vscode.CodeActionKind.QuickFix
    );
    prefixAction.diagnostics = [diagnostic];
    prefixAction.edit = this.createPrefixUnderscoreEdit(document, diagnostic.range);
    prefixAction.isPreferred = true;
    actions.push(prefixAction);

    return actions;
  }

  /**
   * Create actions for unused files
   */
  private createFileActions(
    _document: vscode.TextDocument,
    _diagnostic: vscode.Diagnostic
  ): vscode.CodeAction[] {
    // For unused files, we only provide the ignore action
    return [];
  }

  /**
   * Create action to add ignore comment
   */
  private createIgnoreAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Add // @dead-code-ignore',
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.edit = this.createIgnoreCommentEdit(document, diagnostic.range);
    return action;
  }

  /**
   * Create edit to remove export keyword
   */
  private createRemoveExportEdit(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    const line = document.lineAt(range.start.line);
    const lineText = line.text;

    // Find and remove 'export' keyword
    const exportMatch = lineText.match(/\bexport\s+/);
    if (exportMatch && exportMatch.index !== undefined) {
      const exportRange = new vscode.Range(
        range.start.line,
        exportMatch.index,
        range.start.line,
        exportMatch.index + exportMatch[0].length
      );
      edit.delete(document.uri, exportRange);
    }

    return edit;
  }

  /**
   * Create edit to prefix symbol with underscore
   */
  private createPrefixUnderscoreEdit(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    const symbolName = document.getText(range);

    // Don't add underscore if it already starts with one
    if (!symbolName.startsWith('_')) {
      edit.insert(document.uri, range.start, '_');
    }

    return edit;
  }

  /**
   * Create edit to add ignore comment
   */
  private createIgnoreCommentEdit(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    const line = document.lineAt(range.start.line);
    const indent = line.text.match(/^\s*/)?.[0] || '';

    // Insert comment on the line before
    const commentLine = `${indent}// @dead-code-ignore\n`;
    const insertPosition = new vscode.Position(range.start.line, 0);
    edit.insert(document.uri, insertPosition, commentLine);

    return edit;
  }
}
