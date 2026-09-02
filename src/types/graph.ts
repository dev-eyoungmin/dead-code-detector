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
  /** True for `export * from` / `export * as X from` (creates an edge; marks no export used) */
  isStarReExport?: boolean;
  /**
   * True for `export { x } from './y'` — the record comes from an
   * ExportDeclaration that forwards names rather than consuming them.
   * Distinguishes a forward from an ImportDeclaration of the same specifier.
   */
  isNamedReExport?: boolean;
  /** Absolute minimatch pattern for glob-like imports (template-literal import(), import.meta.glob, require.context) */
  globPattern?: string;
}

export interface ImportSpecifier {
  name: string;
  alias?: string;
  isDefault: boolean;
  isNamespace: boolean;
}

export interface ExportInfo {
  name: string;
  originalName?: string;
  isDefault: boolean;
  isReExport: boolean;
  reExportSource?: string;
  line: number;
  column: number;
  kind: string;
  isTypeOnly: boolean;
  /** True when the export is decorated with a DI framework decorator (e.g. @injectable) */
  isEntryPointDecorated?: boolean;
}

export interface LocalSymbolInfo {
  name: string;
  line: number;
  column: number;
  kind: string;
  references: number;
  /** True for constructor parameter properties (`constructor(private x: T)`) */
  isParameterProperty?: boolean;
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
