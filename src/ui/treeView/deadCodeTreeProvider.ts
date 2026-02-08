import * as vscode from 'vscode';
import { AnalysisResult, DeadCodeItem } from '../../types';
import { TreeItemBase, CategoryItem, DeadCodeTreeItem } from './treeItems';

/**
 * Tree data provider for the dead code results view
 */
export class DeadCodeTreeProvider implements vscode.TreeDataProvider<TreeItemBase> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemBase | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private result: AnalysisResult | null = null;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Refresh the tree view with new analysis results
   */
  refresh(result: AnalysisResult | null): void {
    this.result = result;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Clear the tree view
   */
  clear(): void {
    this.result = null;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the tree item for a given element
   */
  getTreeItem(element: TreeItemBase): vscode.TreeItem {
    return element;
  }

  /**
   * Get the children for a given element
   */
  getChildren(element?: TreeItemBase): Thenable<TreeItemBase[]> {
    if (!this.result) {
      return Promise.resolve([]);
    }

    if (!element) {
      // Root level: return category items
      return Promise.resolve(this.getCategoryItems());
    }

    if (element instanceof CategoryItem) {
      // Category level: return dead code items for that category
      return Promise.resolve(this.getDeadCodeItems(element.type));
    }

    // Leaf level: no children
    return Promise.resolve([]);
  }

  /**
   * Get the parent of a given element
   */
  getParent(element: TreeItemBase): vscode.ProviderResult<TreeItemBase> {
    if (element instanceof DeadCodeTreeItem) {
      // Find the category this item belongs to
      const categories = this.getCategoryItems();
      return categories.find(cat => cat.type === element.item.type);
    }
    return undefined;
  }

  /**
   * Get category items for the root level
   */
  private getCategoryItems(): CategoryItem[] {
    if (!this.result) {
      return [];
    }

    return [
      new CategoryItem(
        'Unused Files',
        this.result.unusedFiles.length,
        'file'
      ),
      new CategoryItem(
        'Unused Exports',
        this.result.unusedExports.length,
        'export'
      ),
      new CategoryItem(
        'Unused Locals',
        this.result.unusedLocals.length,
        'local'
      ),
    ];
  }

  /**
   * Get dead code items for a specific category
   */
  private getDeadCodeItems(type: 'file' | 'export' | 'local'): DeadCodeTreeItem[] {
    if (!this.result) {
      return [];
    }

    const items: DeadCodeItem[] = [];

    switch (type) {
      case 'file':
        items.push(...this.result.unusedFiles.map(file => ({
          type: 'file' as const,
          filePath: file.filePath,
          confidence: file.confidence,
          reason: file.reason,
        })));
        break;

      case 'export':
        items.push(...this.result.unusedExports.map(exp => ({
          type: 'export' as const,
          filePath: exp.filePath,
          symbolName: exp.exportName,
          line: exp.line,
          column: exp.column,
          confidence: exp.confidence,
          kind: exp.kind,
        })));
        break;

      case 'local':
        items.push(...this.result.unusedLocals.map(local => ({
          type: 'local' as const,
          filePath: local.filePath,
          symbolName: local.symbolName,
          line: local.line,
          column: local.column,
          confidence: local.confidence,
          kind: local.kind,
        })));
        break;
    }

    return items.map(item => new DeadCodeTreeItem(item, this.workspaceRoot));
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
