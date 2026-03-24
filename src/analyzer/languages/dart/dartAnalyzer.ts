import * as path from 'path';
import * as fs from 'fs';
import type { LanguageAnalyzer, DependencyGraph, FileNode } from '../../../types';
import { collectDartImports } from './dartImportCollector';
import { collectDartExports, isPartFile } from './dartExportCollector';
import { collectDartLocals } from './dartLocalCollector';
import { getPackageName } from './dartModuleResolver';
import { buildGraphFromFileNodes } from '../../graphBuilder';
import {
  detectDartFramework,
  findDartFrameworkEntryPoints,
} from './dartFrameworkDetector';

export class DartAnalyzer implements LanguageAnalyzer {
  readonly language = 'dart' as const;
  readonly extensions = ['.dart'];
  readonly vscodeLanguageIds = ['dart'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const packageName = getPackageName(rootDir) || '';
    const fileMap = new Map<string, FileNode>();

    // Classify files: separate part files from library files
    const partFiles = new Set<string>();
    const libraryFiles: string[] = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      if (isPartFile(content)) {
        partFiles.add(filePath);
      } else {
        libraryFiles.push(filePath);
      }
    }

    for (const filePath of libraryFiles) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const imports = collectDartImports(content, filePath, rootDir, packageName);
      const exports = collectDartExports(content, filePath, rootDir, packageName);
      const exportedNames = new Set(exports.map(e => e.name));
      const locals = collectDartLocals(content, exportedNames);

      // Merge part file symbols into this library
      const partDirectives = content.match(/^part\s+'([^']+)';/gm) || [];
      for (const directive of partDirectives) {
        const match = directive.match(/^part\s+'([^']+)';/);
        if (!match) continue;
        const partPath = path.resolve(path.dirname(filePath), match[1]);
        if (partFiles.has(partPath)) {
          try {
            const partContent = fs.readFileSync(partPath, 'utf-8');
            const partExports = collectDartExports(partContent, partPath, rootDir, packageName);
            const partLocals = collectDartLocals(partContent, new Set(partExports.map(e => e.name)));
            exports.push(...partExports.filter(e => !e.isReExport));
            locals.push(...partLocals);
          } catch {
            // skip unreadable part files
          }
        }
      }

      fileMap.set(filePath, {
        filePath,
        imports,
        exports,
        locals,
      });
    }

    return buildGraphFromFileNodes(fileMap);
  }

  async findEntryPoints(rootDir: string): Promise<string[]> {
    const entries: string[] = [];
    const framework = detectDartFramework(rootDir);

    if (framework) {
      const fwEntries = await findDartFrameworkEntryPoints(rootDir, framework);
      entries.push(...fwEntries);
    }

    // Common Dart entry points
    const mainDart = path.join(rootDir, 'lib', 'main.dart');
    if (fs.existsSync(mainDart) && !entries.includes(mainDart)) {
      entries.push(mainDart);
    }

    const binDir = path.join(rootDir, 'bin');
    if (fs.existsSync(binDir) && fs.statSync(binDir).isDirectory()) {
      try {
        const binFiles = fs.readdirSync(binDir).filter(f => f.endsWith('.dart'));
        for (const f of binFiles) {
          entries.push(path.join(binDir, f));
        }
      } catch {
        // ignore
      }
    }

    return entries;
  }

  dispose(): void {
    // No resources to clean up
  }
}
