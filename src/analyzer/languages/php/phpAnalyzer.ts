import type { LanguageAnalyzer, DependencyGraph, FileNode } from '../../../types';
import { readSource } from '../../sourceCache';
import { buildGraphFromFileNodes } from '../../graphBuilder';
import { collectPhpImports } from './phpImportCollector';
import { collectPhpExports } from './phpExportCollector';
import { collectPhpLocals } from './phpLocalCollector';
import { buildClassIndex, loadComposerAutoload, type PhpResolverContext } from './phpModuleResolver';
import { detectPhpFrameworks, findPhpFrameworkEntryPoints } from './phpFrameworkDetector';

/**
 * PHP language analyzer.
 *
 * Mirrors `JavaAnalyzer`: a first pass builds the FQCN -> file index and reads
 * composer's autoload configuration, a second pass collects imports/exports/locals
 * per file, and `buildGraphFromFileNodes` turns the file nodes into a graph.
 */
export class PhpAnalyzer implements LanguageAnalyzer {
  readonly language = 'php' as const;
  readonly extensions = ['.php'];
  readonly vscodeLanguageIds = ['php'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const ctx: PhpResolverContext = {
      index: buildClassIndex(files),
      autoload: loadComposerAutoload(rootDir),
    };

    const fileMap = new Map<string, FileNode>();

    for (const filePath of files) {
      const content = readSource(filePath);
      if (content === null) {
        continue;
      }

      const imports = collectPhpImports(content, filePath, ctx);
      const exports = collectPhpExports(content, filePath);
      const exportedNames = new Set(exports.map((e) => e.name));
      const locals = collectPhpLocals(content, exportedNames);

      fileMap.set(filePath, { filePath, imports, exports, locals });
    }

    return buildGraphFromFileNodes(fileMap);
  }

  async findEntryPoints(rootDir: string): Promise<string[]> {
    return findPhpFrameworkEntryPoints(rootDir, detectPhpFrameworks(rootDir));
  }

  dispose(): void {
    // No resources to clean up
  }
}
