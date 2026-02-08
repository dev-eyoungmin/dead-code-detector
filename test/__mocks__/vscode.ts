// Minimal vscode mock for unit tests
export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  parse: (str: string) => ({ fsPath: str, scheme: 'file', path: str }),
};

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string;
  collapsibleState?: TreeItemCollapsibleState;
  command?: unknown;
  iconPath?: unknown;
  contextValue?: string;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number,
  ) {}
}

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Diagnostic {
  constructor(
    public range: Range,
    public message: string,
    public severity?: DiagnosticSeverity,
  ) {}
  tags?: DiagnosticTag[];
  source?: string;
}

export const CodeActionKind = {
  QuickFix: 'quickfix',
};

export class CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  edit?: unknown;
  constructor(title: string, kind?: string) {
    this.title = title;
    this.kind = kind;
  }
}

export class WorkspaceEdit {
  private edits: unknown[] = [];
  replace(_uri: unknown, _range: unknown, _newText: string) {
    this.edits.push({ _uri, _range, _newText });
  }
  insert(_uri: unknown, _position: unknown, _newText: string) {
    this.edits.push({ _uri, _position, _newText });
  }
}

export const languages = {
  createDiagnosticCollection: (name: string) => ({
    name,
    set: () => {},
    delete: () => {},
    clear: () => {},
    dispose: () => {},
  }),
  registerCodeActionsProvider: () => ({ dispose: () => {} }),
};

export const window = {
  createOutputChannel: (name: string) => ({
    name,
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showSaveDialog: async () => undefined,
  createWebviewPanel: () => ({
    webview: { html: '', onDidReceiveMessage: () => ({ dispose: () => {} }) },
    reveal: () => {},
    dispose: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
  }),
  withProgress: async (_options: unknown, task: (progress: unknown) => Promise<unknown>) => {
    return task({ report: () => {} });
  },
  createTreeView: () => ({
    dispose: () => {},
  }),
  activeTextEditor: undefined,
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultValue: unknown) => defaultValue,
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  onDidSaveTextDocument: () => ({ dispose: () => {} }),
  workspaceFolders: [],
  fs: {
    writeFile: async () => {},
  },
};

export const commands = {
  registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown) => ({
    dispose: () => {},
  }),
};

export const ProgressLocation = {
  Notification: 15,
};

export const ViewColumn = {
  One: 1,
  Two: 2,
  Active: -1,
};

export const EventEmitter = class {
  event = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
};
