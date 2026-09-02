import * as path from 'path';
import * as fs from 'fs';
import type { LanguageAnalyzer, DependencyGraph, FileNode } from '../../types';
import { createPrograms, clearProgramCache } from '../programFactory';
import { collectFileNodes } from '../dependencyGraph';
import { buildGraphFromFileNodes } from '../graphBuilder';
import { findFrameworkEntryPoints } from '../frameworkDetector';
import {
  resolvePackageJsonEntries,
  findWorkspacePackageDirs,
  findConventionalEntries,
  findHtmlScriptEntries,
  findServerlessEntries,
} from '../entryPointResolver';
import { TS_FAMILY_EXTENSIONS } from './index';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
  readonly language = 'typescript' as const;
  readonly extensions = TS_FAMILY_EXTENSIONS;
  readonly vscodeLanguageIds = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const tsconfigPath = this.findTsConfig(rootDir);
    const groups = createPrograms(files, rootDir, tsconfigPath);
    const fileNodes = new Map<string, FileNode>();
    for (const group of groups) {
      collectFileNodes(group.files, group.program, { rootDir }, fileNodes);
    }
    return buildGraphFromFileNodes(fileNodes);
  }

  async findEntryPoints(rootDir: string): Promise<string[]> {
    const dirs = [rootDir, ...(await findWorkspacePackageDirs(rootDir))];
    const entries = new Set<string>();

    for (const d of dirs) {
      for (const e of resolvePackageJsonEntries(d)) entries.add(e);
      for (const e of await findConventionalEntries(d)) entries.add(e);
    }

    for (const e of await findFrameworkEntryPoints(rootDir)) entries.add(e);
    for (const e of await findHtmlScriptEntries(rootDir)) entries.add(e);
    for (const e of await findServerlessEntries(rootDir)) entries.add(e);

    return Array.from(entries).map((p) => path.normalize(p));
  }

  dispose(): void {
    clearProgramCache();
  }

  private findTsConfig(rootDir: string): string | undefined {
    const tsconfigPath = path.join(rootDir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
    return undefined;
  }
}
