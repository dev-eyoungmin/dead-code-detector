import * as vscode from 'vscode';
import { DeadCodeItem, ConfidenceLevel } from '../../types';

/**
 * Base tree item class
 */
export abstract class TreeItemBase extends vscode.TreeItem {
  constructor(label: string, collapsibleState?: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
  }
}

/**
 * Category item for grouping dead code results
 */
export class CategoryItem extends TreeItemBase {
  constructor(
    public readonly label: string,
    public readonly count: number,
    public readonly type: 'file' | 'export' | 'local'
  ) {
    super(label, count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.description = `${count} item${count !== 1 ? 's' : ''}`;
    this.contextValue = 'category';
    this.iconPath = new vscode.ThemeIcon(this.getIconName());
  }

  private getIconName(): string {
    switch (this.type) {
      case 'file':
        return 'file';
      case 'export':
        return 'symbol-method';
      case 'local':
        return 'symbol-variable';
      default:
        return 'circle-outline';
    }
  }
}

/**
 * Tree item for individual dead code items
 */
export class DeadCodeTreeItem extends TreeItemBase {
  constructor(
    public readonly item: DeadCodeItem,
    public readonly workspaceRoot: string
  ) {
    super(DeadCodeTreeItem.getLabel(item));

    this.tooltip = this.createTooltip();
    this.description = this.createDescription();
    this.iconPath = this.getIconPath();
    this.contextValue = `deadCode.${item.type}`;
    this.resourceUri = vscode.Uri.file(item.filePath);

    // Command to open file at the specified location
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [
        vscode.Uri.file(item.filePath),
        {
          selection: item.line !== undefined && item.column !== undefined
            ? new vscode.Range(
                new vscode.Position(Math.max(0, item.line - 1), Math.max(0, item.column)),
                new vscode.Position(Math.max(0, item.line - 1), Math.max(0, item.column))
              )
            : undefined,
        } as vscode.TextDocumentShowOptions,
      ],
    };
  }

  private static getLabel(item: DeadCodeItem): string {
    if (item.type === 'file') {
      // Show just the file name for file items
      const fileName = item.filePath.split('/').pop() || item.filePath;
      return fileName;
    } else {
      // Show symbol name for exports and locals
      return item.symbolName || 'unknown';
    }
  }

  private createDescription(): string {
    const parts: string[] = [];

    // Add confidence badge
    parts.push(`(${this.getConfidenceBadge(this.item.confidence)})`);

    // Add location for exports and locals
    if (this.item.type !== 'file' && this.item.line !== undefined) {
      parts.push(`Line ${this.item.line}`);
    }

    return parts.join(' ');
  }

  private createTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;

    tooltip.appendMarkdown(`**${this.item.type === 'file' ? 'Unused File' : this.item.type === 'export' ? 'Unused Export' : 'Unused Local'}**\n\n`);

    if (this.item.symbolName) {
      tooltip.appendMarkdown(`**Symbol:** \`${this.item.symbolName}\`\n\n`);
    }

    tooltip.appendMarkdown(`**File:** \`${this.getRelativePath()}\`\n\n`);

    if (this.item.line !== undefined) {
      tooltip.appendMarkdown(`**Location:** Line ${this.item.line}${this.item.column !== undefined ? `, Column ${this.item.column}` : ''}\n\n`);
    }

    tooltip.appendMarkdown(`**Confidence:** ${this.item.confidence}\n\n`);

    if (this.item.kind) {
      tooltip.appendMarkdown(`**Kind:** ${this.item.kind}\n\n`);
    }

    if (this.item.reason) {
      tooltip.appendMarkdown(`**Reason:** ${this.item.reason}\n\n`);
    }

    return tooltip;
  }

  private getRelativePath(): string {
    if (this.item.filePath.startsWith(this.workspaceRoot)) {
      return this.item.filePath.substring(this.workspaceRoot.length + 1);
    }
    return this.item.filePath;
  }

  private getConfidenceBadge(confidence: ConfidenceLevel): string {
    switch (confidence) {
      case 'high':
        return '🔴 high';
      case 'medium':
        return '🟡 medium';
      case 'low':
        return '🟢 low';
      default:
        return confidence;
    }
  }

  private getIconPath(): vscode.ThemeIcon {
    let iconName: string;

    switch (this.item.type) {
      case 'file':
        iconName = 'file';
        break;
      case 'export':
        iconName = this.getExportIcon();
        break;
      case 'local':
        iconName = this.getLocalIcon();
        break;
      default:
        iconName = 'circle-outline';
    }

    // Add color based on confidence
    const color = this.getConfidenceColor();
    return new vscode.ThemeIcon(iconName, color);
  }

  private getExportIcon(): string {
    switch (this.item.kind) {
      case 'function':
        return 'symbol-method';
      case 'class':
        return 'symbol-class';
      case 'variable':
        return 'symbol-variable';
      case 'type':
      case 'interface':
        return 'symbol-interface';
      case 'enum':
        return 'symbol-enum';
      default:
        return 'symbol-misc';
    }
  }

  private getLocalIcon(): string {
    switch (this.item.kind) {
      case 'variable':
        return 'symbol-variable';
      case 'function':
        return 'symbol-method';
      case 'class':
        return 'symbol-class';
      case 'parameter':
        return 'symbol-parameter';
      default:
        return 'symbol-misc';
    }
  }

  private getConfidenceColor(): vscode.ThemeColor | undefined {
    switch (this.item.confidence) {
      case 'high':
        return new vscode.ThemeColor('errorForeground');
      case 'medium':
        return new vscode.ThemeColor('warningForeground');
      case 'low':
        return new vscode.ThemeColor('descriptionForeground');
      default:
        return undefined;
    }
  }
}
