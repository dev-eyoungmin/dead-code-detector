import * as vscode from 'vscode';
import { AnalysisResult, UnusedFileResult, UnusedExportResult, UnusedLocalResult } from '../../types';

/**
 * Manages diagnostics for dead code in the Problems panel
 */
export class DiagnosticManager {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('deadCode');
  }

  /**
   * Update diagnostics based on analysis results
   */
  update(result: AnalysisResult): void {
    // Clear existing diagnostics
    this.collection.clear();

    // Group diagnostics by file
    const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

    // Process unused files
    for (const file of result.unusedFiles) {
      this.addFileDiagnostic(diagnosticsByFile, file);
    }

    // Process unused exports
    for (const exp of result.unusedExports) {
      this.addExportDiagnostic(diagnosticsByFile, exp);
    }

    // Process unused locals
    for (const local of result.unusedLocals) {
      this.addLocalDiagnostic(diagnosticsByFile, local);
    }

    // Set diagnostics for each file
    for (const [filePath, diagnostics] of diagnosticsByFile) {
      const uri = vscode.Uri.file(filePath);
      this.collection.set(uri, diagnostics);
    }
  }

  /**
   * Clear all diagnostics
   */
  clear(): void {
    this.collection.clear();
  }

  /**
   * Dispose of the diagnostic collection
   */
  dispose(): void {
    this.collection.dispose();
  }

  /**
   * Add diagnostic for an unused file
   */
  private addFileDiagnostic(
    diagnosticsByFile: Map<string, vscode.Diagnostic[]>,
    file: UnusedFileResult
  ): void {
    const diagnostics = this.getOrCreateDiagnosticArray(diagnosticsByFile, file.filePath);

    // Create diagnostic at line 0 for the entire file
    const range = new vscode.Range(0, 0, 0, 0);
    const message = `Unused file (confidence: ${file.confidence}): ${file.reason}`;
    const diagnostic = this.createDiagnostic(range, message, file.confidence);
    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    diagnostic.code = 'unused-file';

    diagnostics.push(diagnostic);
  }

  /**
   * Add diagnostic for an unused export
   */
  private addExportDiagnostic(
    diagnosticsByFile: Map<string, vscode.Diagnostic[]>,
    exp: UnusedExportResult
  ): void {
    const diagnostics = this.getOrCreateDiagnosticArray(diagnosticsByFile, exp.filePath);

    // Create diagnostic at the export location
    const line = Math.max(0, exp.line - 1);
    const col = Math.max(0, exp.column);
    const range = new vscode.Range(
      line,
      col,
      line,
      col + exp.exportName.length
    );
    const message = `Unused export: ${exp.exportName} (${exp.kind}, confidence: ${exp.confidence})`;
    const diagnostic = this.createDiagnostic(range, message, exp.confidence);
    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    diagnostic.code = 'unused-export';

    diagnostics.push(diagnostic);
  }

  /**
   * Add diagnostic for an unused local
   */
  private addLocalDiagnostic(
    diagnosticsByFile: Map<string, vscode.Diagnostic[]>,
    local: UnusedLocalResult
  ): void {
    const diagnostics = this.getOrCreateDiagnosticArray(diagnosticsByFile, local.filePath);

    // Create diagnostic at the local symbol location
    const line = Math.max(0, local.line - 1);
    const col = Math.max(0, local.column);
    const range = new vscode.Range(
      line,
      col,
      line,
      col + local.symbolName.length
    );
    const message = `Unused local: ${local.symbolName} (${local.kind}, confidence: ${local.confidence})`;
    const diagnostic = this.createDiagnostic(range, message, local.confidence);
    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    diagnostic.code = 'unused-local';

    diagnostics.push(diagnostic);
  }

  /**
   * Get or create diagnostic array for a file
   */
  private getOrCreateDiagnosticArray(
    diagnosticsByFile: Map<string, vscode.Diagnostic[]>,
    filePath: string
  ): vscode.Diagnostic[] {
    let diagnostics = diagnosticsByFile.get(filePath);
    if (!diagnostics) {
      diagnostics = [];
      diagnosticsByFile.set(filePath, diagnostics);
    }
    return diagnostics;
  }

  /**
   * Create a diagnostic with appropriate severity based on confidence
   */
  private createDiagnostic(
    range: vscode.Range,
    message: string,
    confidence: 'high' | 'medium' | 'low'
  ): vscode.Diagnostic {
    const severity = this.getSeverity(confidence);
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'Dead Code Detector';
    return diagnostic;
  }

  /**
   * Get diagnostic severity based on confidence level
   */
  private getSeverity(confidence: 'high' | 'medium' | 'low'): vscode.DiagnosticSeverity {
    switch (confidence) {
      case 'high':
        return vscode.DiagnosticSeverity.Warning;
      case 'medium':
        return vscode.DiagnosticSeverity.Information;
      case 'low':
        return vscode.DiagnosticSeverity.Hint;
      default:
        return vscode.DiagnosticSeverity.Information;
    }
  }
}
