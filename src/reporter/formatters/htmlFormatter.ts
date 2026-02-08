import type { ReportData } from '../reportModel';

/**
 * Formats a ReportData as a self-contained HTML document with embedded CSS and JavaScript.
 * Uses VS Code theme CSS variables for integration with webview panels.
 */
export function formatHtml(data: ReportData): string {
  const { summary, items, generatedAt } = data;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dead Code Detection Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 14px);
      color: var(--vscode-editor-foreground, #333);
      background-color: var(--vscode-editor-background, #fff);
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      color: var(--vscode-titleBar-activeForeground, #333);
    }

    .timestamp {
      color: var(--vscode-descriptionForeground, #666);
      font-size: 13px;
      margin-bottom: 24px;
    }

    .summary {
      background-color: var(--vscode-editor-inactiveSelectionBackground, #f5f5f5);
      border: 1px solid var(--vscode-panel-border, #ddd);
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .summary h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: var(--vscode-titleBar-activeForeground, #333);
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .summary-item {
      display: flex;
      flex-direction: column;
    }

    .summary-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #666);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-value {
      font-size: 24px;
      font-weight: 600;
      color: var(--vscode-editor-foreground, #333);
    }

    .summary-value.warning {
      color: var(--vscode-editorWarning-foreground, #f59e0b);
    }

    .filters {
      margin-bottom: 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }

    .filter-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .filter-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--vscode-foreground, #333);
    }

    .filter-button {
      padding: 6px 12px;
      background-color: var(--vscode-button-secondaryBackground, #e0e0e0);
      color: var(--vscode-button-secondaryForeground, #333);
      border: 1px solid var(--vscode-panel-border, #ddd);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }

    .filter-button:hover {
      background-color: var(--vscode-button-secondaryHoverBackground, #d0d0d0);
    }

    .filter-button.active {
      background-color: var(--vscode-button-background, #0066cc);
      color: var(--vscode-button-foreground, #fff);
      border-color: var(--vscode-button-background, #0066cc);
    }

    .table-container {
      overflow-x: auto;
      border: 1px solid var(--vscode-panel-border, #ddd);
      border-radius: 6px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background-color: var(--vscode-editor-background, #fff);
    }

    th {
      background-color: var(--vscode-editor-inactiveSelectionBackground, #f5f5f5);
      color: var(--vscode-foreground, #333);
      font-weight: 600;
      text-align: left;
      padding: 12px;
      border-bottom: 2px solid var(--vscode-panel-border, #ddd);
      font-size: 13px;
      position: sticky;
      top: 0;
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #e5e5e5);
      font-size: 13px;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover {
      background-color: var(--vscode-list-hoverBackground, #f0f0f0);
    }

    .file-path {
      color: var(--vscode-textLink-foreground, #0066cc);
      cursor: pointer;
      text-decoration: none;
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: 12px;
    }

    .file-path:hover {
      text-decoration: underline;
    }

    .symbol-name {
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: 12px;
      color: var(--vscode-editor-foreground, #333);
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .badge.file {
      background-color: #dbeafe;
      color: #1e40af;
    }

    .badge.export {
      background-color: #fef3c7;
      color: #92400e;
    }

    .badge.local {
      background-color: #ddd6fe;
      color: #5b21b6;
    }

    .badge.high {
      background-color: #fee2e2;
      color: #991b1b;
    }

    .badge.medium {
      background-color: #fed7aa;
      color: #9a3412;
    }

    .badge.low {
      background-color: #fef9c3;
      color: #854d0e;
    }

    .location {
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #666);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground, #666);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 16px;
    }

    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Dead Code Detection Report</h1>
    <div class="timestamp">Generated at ${generatedAt}</div>

    <div class="summary">
      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">Unused Files</span>
          <span class="summary-value warning">${summary.unusedFileCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Unused Exports</span>
          <span class="summary-value warning">${summary.unusedExportCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Unused Locals</span>
          <span class="summary-value warning">${summary.unusedLocalCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Analyzed Files</span>
          <span class="summary-value">${summary.analyzedFileCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Exports</span>
          <span class="summary-value">${summary.totalExportCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Total Locals</span>
          <span class="summary-value">${summary.totalLocalCount}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Analysis Duration</span>
          <span class="summary-value">${summary.durationMs}ms</span>
        </div>
      </div>
    </div>

    <div class="filters">
      <div class="filter-group">
        <span class="filter-label">Type:</span>
        <button class="filter-button active" data-filter-type="all">All</button>
        <button class="filter-button" data-filter-type="file">Files</button>
        <button class="filter-button" data-filter-type="export">Exports</button>
        <button class="filter-button" data-filter-type="local">Locals</button>
      </div>
      <div class="filter-group">
        <span class="filter-label">Confidence:</span>
        <button class="filter-button active" data-filter-confidence="all">All</button>
        <button class="filter-button" data-filter-confidence="high">High</button>
        <button class="filter-button" data-filter-confidence="medium">Medium</button>
        <button class="filter-button" data-filter-confidence="low">Low</button>
      </div>
    </div>

    ${items.length === 0 ? `
    <div class="empty-state">
      <div class="empty-state-icon">✨</div>
      <div class="empty-state-text">No dead code detected!</div>
    </div>
    ` : `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>File</th>
            <th>Symbol</th>
            <th>Location</th>
            <th>Confidence</th>
            <th>Kind</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
          <tr data-type="${item.type}" data-confidence="${item.confidence}">
            <td><span class="badge ${item.type}">${item.type}</span></td>
            <td>
              <a class="file-path"
                 data-file="${escapeHtml(item.filePath)}"
                 data-line="${item.line}"
                 data-column="${item.column}"
                 href="#"
                 onclick="handleFileClick(event, this)">${escapeHtml(item.filePath)}</a>
            </td>
            <td><span class="symbol-name">${escapeHtml(item.symbolName || '-')}</span></td>
            <td>${item.line > 0 ? `<span class="location">${item.line}:${item.column}</span>` : '-'}</td>
            <td><span class="badge ${item.confidence}">${item.confidence}</span></td>
            <td>${escapeHtml(item.kind)}</td>
            <td>${escapeHtml(item.reason || '-')}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `}
  </div>

  <script>
    // Filter functionality
    let currentTypeFilter = 'all';
    let currentConfidenceFilter = 'all';

    function applyFilters() {
      const rows = document.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const type = row.getAttribute('data-type');
        const confidence = row.getAttribute('data-confidence');

        const typeMatch = currentTypeFilter === 'all' || type === currentTypeFilter;
        const confidenceMatch = currentConfidenceFilter === 'all' || confidence === currentConfidenceFilter;

        if (typeMatch && confidenceMatch) {
          row.classList.remove('hidden');
        } else {
          row.classList.add('hidden');
        }
      });
    }

    // Type filter buttons
    document.querySelectorAll('[data-filter-type]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-filter-type]').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        currentTypeFilter = button.getAttribute('data-filter-type');
        applyFilters();
      });
    });

    // Confidence filter buttons
    document.querySelectorAll('[data-filter-confidence]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-filter-confidence]').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        currentConfidenceFilter = button.getAttribute('data-filter-confidence');
        applyFilters();
      });
    });

    // Handle file path clicks - send message to VS Code extension
    function handleFileClick(event, element) {
      event.preventDefault();

      const file = element.getAttribute('data-file');
      const line = parseInt(element.getAttribute('data-line'), 10);
      const column = parseInt(element.getAttribute('data-column'), 10);

      // Post message to VS Code webview handler
      if (window.acquireVsCodeApi) {
        const vscode = window.acquireVsCodeApi();
        vscode.postMessage({
          command: 'openFile',
          file: file,
          line: line,
          column: column
        });
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
