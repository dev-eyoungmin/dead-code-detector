import type { DependencyGraph } from './graph';

export type SupportedLanguage = 'typescript' | 'python' | 'go' | 'java';

export interface LanguageAnalyzer {
  readonly language: SupportedLanguage;
  readonly extensions: string[];
  readonly vscodeLanguageIds: string[];
  buildGraph(files: string[], rootDir: string): DependencyGraph;
  findEntryPoints(rootDir: string): Promise<string[]>;
  dispose(): void;
}
