import * as path from 'path';
import type { SupportedLanguage, LanguageAnalyzer } from '../../types';
import { TypeScriptAnalyzer } from './typescriptAnalyzer';
import { PythonAnalyzer } from './python/pythonAnalyzer';
import { GoAnalyzer } from './go/goAnalyzer';
import { JavaAnalyzer } from './java/javaAnalyzer';
import { DartAnalyzer } from './dart/dartAnalyzer';
import { PhpAnalyzer } from './php/phpAnalyzer';

const analyzers = new Map<SupportedLanguage, LanguageAnalyzer>();

function ensureInitialized(): void {
  if (analyzers.size === 0) {
    analyzers.set('typescript', new TypeScriptAnalyzer());
    analyzers.set('python', new PythonAnalyzer());
    analyzers.set('go', new GoAnalyzer());
    analyzers.set('java', new JavaAnalyzer());
    analyzers.set('dart', new DartAnalyzer());
    analyzers.set('php', new PhpAnalyzer());
  }
}

export function registerAnalyzer(analyzer: LanguageAnalyzer): void {
  analyzers.set(analyzer.language, analyzer);
}

export function getAnalyzer(language: SupportedLanguage): LanguageAnalyzer | undefined {
  ensureInitialized();
  return analyzers.get(language);
}

export function getAllAnalyzers(): LanguageAnalyzer[] {
  ensureInitialized();
  return Array.from(analyzers.values());
}

/** Extensions handled by the TypeScript compiler pipeline (incl. SFCs whose scripts are extracted). */
export const TS_FAMILY_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx',
  '.mts', '.cts', '.mjs', '.cjs',
  '.vue', '.svelte',
];

const extensionToLanguage = new Map<string, SupportedLanguage>([
  ...TS_FAMILY_EXTENSIONS.map((ext) => [ext, 'typescript'] as [string, SupportedLanguage]),
  ['.py', 'python'],
  ['.go', 'go'],
  ['.java', 'java'],
  ['.dart', 'dart'],
  ['.php', 'php'],
]);

export function detectLanguage(filePath: string): SupportedLanguage | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return extensionToLanguage.get(ext);
}

/** True when the file is analysed through the TypeScript compiler (.ts/.js family, SFCs). */
export function isTypeScriptFamily(filePath: string): boolean {
  return TS_FAMILY_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export function groupFilesByLanguage(files: string[]): Map<SupportedLanguage, string[]> {
  const groups = new Map<SupportedLanguage, string[]>();

  for (const file of files) {
    const lang = detectLanguage(file);
    if (!lang) {
      continue;
    }
    let group = groups.get(lang);
    if (!group) {
      group = [];
      groups.set(lang, group);
    }
    group.push(file);
  }

  return groups;
}

export function disposeAllAnalyzers(): void {
  for (const analyzer of analyzers.values()) {
    analyzer.dispose();
  }
  analyzers.clear();
}
