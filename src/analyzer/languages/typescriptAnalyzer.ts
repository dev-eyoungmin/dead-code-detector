import * as path from 'path';
import * as fs from 'fs';
import type { LanguageAnalyzer, DependencyGraph } from '../../types';
import { createProgram, clearProgramCache } from '../programFactory';
import { buildDependencyGraph } from '../dependencyGraph';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
  readonly language = 'typescript' as const;
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx'];
  readonly vscodeLanguageIds = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const tsconfigPath = this.findTsConfig(rootDir);
    const program = createProgram(files, tsconfigPath);
    return buildDependencyGraph(files, program);
  }

  async findEntryPoints(rootDir: string): Promise<string[]> {
    const entryPoints: string[] = [];

    // Check package.json for main/module fields
    const packageJsonPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

        if (packageJson.main) {
          const mainPath = path.resolve(rootDir, packageJson.main);
          if (fs.existsSync(mainPath)) {
            entryPoints.push(mainPath);
          }
        }

        if (packageJson.module) {
          const modulePath = path.resolve(rootDir, packageJson.module);
          if (fs.existsSync(modulePath)) {
            entryPoints.push(modulePath);
          }
        }

        if (packageJson.exports) {
          const exportsValue = packageJson.exports;
          if (typeof exportsValue === 'string') {
            const exportPath = path.resolve(rootDir, exportsValue);
            if (fs.existsSync(exportPath)) {
              entryPoints.push(exportPath);
            }
          } else if (typeof exportsValue === 'object') {
            for (const exp of Object.values(exportsValue)) {
              if (typeof exp === 'string') {
                const exportPath = path.resolve(rootDir, exp);
                if (fs.existsSync(exportPath)) {
                  entryPoints.push(exportPath);
                }
              }
            }
          }
        }
      } catch {
        // Failed to parse package.json
      }
    }

    // Look for common entry point files
    const commonEntryPoints = [
      'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
      'src/main.ts', 'src/main.tsx', 'src/main.js', 'src/main.jsx',
      'index.ts', 'index.tsx', 'index.js', 'index.jsx',
    ];

    for (const entry of commonEntryPoints) {
      const entryPath = path.join(rootDir, entry);
      if (fs.existsSync(entryPath) && !entryPoints.includes(entryPath)) {
        entryPoints.push(entryPath);
      }
    }

    return entryPoints;
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
