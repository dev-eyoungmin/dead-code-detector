export interface FileNode {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  locals: LocalSymbolInfo[];
}

export interface ImportInfo {
  source: string;
  resolvedPath: string;
  specifiers: ImportSpecifier[];
  isNamespaceImport: boolean;
  isDynamicImport: boolean;
  isTypeOnly: boolean;
}

export interface ImportSpecifier {
  name: string;
  alias?: string;
  isDefault: boolean;
  isNamespace: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  reExportSource?: string;
  line: number;
  column: number;
  kind: string;
  isTypeOnly: boolean;
}

export interface LocalSymbolInfo {
  name: string;
  line: number;
  column: number;
  kind: string;
  references: number;
}

export interface DependencyGraph {
  files: Map<string, FileNode>;
  /** Maps a file path to the set of files that import it */
  inboundEdges: Map<string, Set<string>>;
  /** Maps a file path to the set of files it imports */
  outboundEdges: Map<string, Set<string>>;
  /** Maps "filePath::exportName" to set of files that import that export */
  exportUsages: Map<string, Set<string>>;
}
