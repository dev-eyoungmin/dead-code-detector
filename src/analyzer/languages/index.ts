import * as path from 'path';
import type { SupportedLanguage, LanguageAnalyzer } from '../../types';
import { TypeScriptAnalyzer } from './typescriptAnalyzer';
import { PythonAnalyzer } from './python/pythonAnalyzer';
import { GoAnalyzer } from './go/goAnalyzer';
import { JavaAnalyzer } from './java/javaAnalyzer';

const analyzers = new Map<SupportedLanguage, LanguageAnalyzer>();

function ensureInitialized(): void {
  if (analyzers.size === 0) {
    analyzers.set('typescript', new TypeScriptAnalyzer());
    analyzers.set('python', new PythonAnalyzer());
    analyzers.set('go', new GoAnalyzer());
    analyzers.set('java', new JavaAnalyzer());
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

const extensionToLanguage = new Map<string, SupportedLanguage>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'typescript'],
  ['.jsx', 'typescript'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.java', 'java'],
]);

export function detectLanguage(filePath: string): SupportedLanguage | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return extensionToLanguage.get(ext);
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
