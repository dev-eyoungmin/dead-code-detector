import * as vscode from 'vscode';
import { handleWebviewMessage } from './messageHandler';

/**
 * Manages the webview panel for displaying HTML reports
 */
export class ReportWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  /**
   * Show the webview panel with the given HTML content
   */
  show(htmlContent: string, extensionUri: vscode.Uri): void {
    if (this.panel) {
      // Panel already exists, just reveal it
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      // Create new panel
      this.panel = vscode.window.createWebviewPanel(
        'deadCodeReport',
        'Dead Code Report',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [extensionUri],
        }
      );

      // Handle panel disposal
      this.panel.onDidDispose(
        () => {
          this.panel = undefined;
          this.disposeDisposables();
        },
        null,
        this.disposables
      );

      // Handle messages from the webview
      this.panel.webview.onDidReceiveMessage(
        async (message) => {
          await handleWebviewMessage(message);
        },
        null,
        this.disposables
      );
    }

    // Set or update the HTML content
    this.panel.webview.html = this.getWebviewContent(htmlContent, this.panel.webview, extensionUri);
  }

  /**
   * Dispose of the webview panel
   */
  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
    this.disposeDisposables();
  }

  /**
   * Dispose of all disposables
   */
  private disposeDisposables(): void {
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  /**
   * Get the webview HTML content with proper CSP and resource URIs
   */
  private getWebviewContent(
    htmlContent: string,
    webview: vscode.Webview,
    extensionUri: vscode.Uri
  ): string {
    // If the HTML content is already a complete document, use it as-is
    if (htmlContent.trim().toLowerCase().startsWith('<!doctype') ||
        htmlContent.trim().toLowerCase().startsWith('<html')) {
      return this.injectWebviewHelpers(htmlContent, webview, extensionUri);
    }

    // Otherwise, wrap it in a basic HTML template
    return this.createHtmlWrapper(htmlContent, webview, extensionUri);
  }

  /**
   * Inject webview helper scripts and update resource URIs
   */
  private injectWebviewHelpers(
    html: string,
    _webview: vscode.Webview,
    _extensionUri: vscode.Uri
  ): string {
    // Add script to handle communication with the extension
    const script = `
      <script>
        const vscode = acquireVsCodeApi();

        function openFile(filePath, line) {
          vscode.postMessage({
            command: 'openFile',
            filePath: filePath,
            line: line
          });
        }

        function exportData(format) {
          vscode.postMessage({
            command: 'export',
            format: format
          });
        }
      </script>
    `;

    // Inject script before closing body tag, or before closing html tag if no body
    if (html.includes('</body>')) {
      return html.replace('</body>', `${script}</body>`);
    } else if (html.includes('</html>')) {
      return html.replace('</html>', `${script}</html>`);
    } else {
      return html + script;
    }
  }

  /**
   * Create a complete HTML wrapper for content
   */
  private createHtmlWrapper(
    content: string,
    webview: vscode.Webview,
    _extensionUri: vscode.Uri
  ): string {
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Dead Code Report</title>
      <style>
        body {
          padding: 20px;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          line-height: 1.6;
        }

        h1, h2, h3 {
          color: var(--vscode-editor-foreground);
        }

        a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }

        a:hover {
          text-decoration: underline;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }

        th, td {
          padding: 8px 12px;
          text-align: left;
          border: 1px solid var(--vscode-panel-border);
        }

        th {
          background-color: var(--vscode-editor-lineHighlightBackground);
          font-weight: bold;
        }

        tr:hover {
          background-color: var(--vscode-list-hoverBackground);
        }

        .badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 0.85em;
          font-weight: bold;
        }

        .badge-high {
          background-color: var(--vscode-errorForeground);
          color: white;
        }

        .badge-medium {
          background-color: var(--vscode-warningForeground);
          color: black;
        }

        .badge-low {
          background-color: var(--vscode-descriptionForeground);
          color: white;
        }
      </style>
    </head>
    <body>
      ${content}

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function openFile(filePath, line) {
          vscode.postMessage({
            command: 'openFile',
            filePath: filePath,
            line: line
          });
        }

        function exportData(format) {
          vscode.postMessage({
            command: 'export',
            format: format
          });
        }

        // Add click handlers to file links
        document.addEventListener('DOMContentLoaded', () => {
          const fileLinks = document.querySelectorAll('[data-file-path]');
          fileLinks.forEach(link => {
            link.style.cursor = 'pointer';
            link.addEventListener('click', (e) => {
              e.preventDefault();
              const filePath = link.getAttribute('data-file-path');
              const line = link.getAttribute('data-line');
              openFile(filePath, line ? parseInt(line) : undefined);
            });
          });
        });
      </script>
    </body>
    </html>`;
  }

  /**
   * Generate a nonce for CSP
   */
  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
