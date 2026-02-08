import * as path from 'path';
import * as fs from 'fs';
import type { LanguageAnalyzer, DependencyGraph, FileNode } from '../../../types';
import { collectPythonImports } from './pythonImportCollector';
import { collectPythonExports } from './pythonExportCollector';
import { collectPythonLocals } from './pythonLocalCollector';
import { buildGraphFromFileNodes } from '../../graphBuilder';

export class PythonAnalyzer implements LanguageAnalyzer {
  readonly language = 'python' as const;
  readonly extensions = ['.py'];
  readonly vscodeLanguageIds = ['python'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const fileMap = new Map<string, FileNode>();

    for (const filePath of files) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const imports = collectPythonImports(content, filePath, rootDir);
      const exports = collectPythonExports(content, filePath);
      const exportedNames = new Set(exports.map((e) => e.name));
      const locals = collectPythonLocals(content, exportedNames);

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
    const candidates = [
      'main.py',
      '__main__.py',
      'setup.py',
      'manage.py',
      'app.py',
      'wsgi.py',
      'asgi.py',
    ];

    for (const candidate of candidates) {
      const fullPath = path.join(rootDir, candidate);
      if (fs.existsSync(fullPath)) {
        entryPoints.push(fullPath);
      }
    }

    return entryPoints;
  }

  dispose(): void {
    // No resources to clean up
  }
}
