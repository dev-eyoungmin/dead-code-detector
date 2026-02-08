import * as path from 'path';
import * as fs from 'fs';
import type { LanguageAnalyzer, DependencyGraph, FileNode } from '../../../types';
import { collectGoImports } from './goImportCollector';
import { collectGoExports } from './goExportCollector';
import { collectGoLocals } from './goLocalCollector';
import { readModulePath } from './goModuleResolver';
import { buildGraphFromFileNodes } from '../../graphBuilder';

export class GoAnalyzer implements LanguageAnalyzer {
  readonly language = 'go' as const;
  readonly extensions = ['.go'];
  readonly vscodeLanguageIds = ['go'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const modulePath = readModulePath(rootDir);
    const fileMap = new Map<string, FileNode>();

    for (const filePath of files) {
      // Skip test files
      if (filePath.endsWith('_test.go')) {
        continue;
      }

      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const imports = collectGoImports(content, filePath, rootDir, modulePath);
      const exports = collectGoExports(content, filePath);
      const exportedNames = new Set(exports.map((e) => e.name));
      const locals = collectGoLocals(content, exportedNames);

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
    const entryPoints: string[] = [];

    // Look for main.go in root
    const mainGo = path.join(rootDir, 'main.go');
    if (fs.existsSync(mainGo)) {
      entryPoints.push(mainGo);
    }

    // Look for cmd/*/main.go pattern
    const cmdDir = path.join(rootDir, 'cmd');
    if (fs.existsSync(cmdDir) && fs.statSync(cmdDir).isDirectory()) {
      try {
        const entries = fs.readdirSync(cmdDir);
        for (const entry of entries) {
          const entryPath = path.join(cmdDir, entry);
          if (fs.statSync(entryPath).isDirectory()) {
            const cmdMain = path.join(entryPath, 'main.go');
            if (fs.existsSync(cmdMain)) {
              entryPoints.push(cmdMain);
            }
          }
        }
      } catch {
        // Failed to read cmd directory
      }
    }

    return entryPoints;
  }

  dispose(): void {
    // No resources to clean up
  }
}
