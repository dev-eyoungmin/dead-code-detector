import * as path from 'path';
import * as fs from 'fs';
import type { LanguageAnalyzer, DependencyGraph, FileNode } from '../../../types';
import { collectJavaImports } from './javaImportCollector';
import { collectJavaExports } from './javaExportCollector';
import { collectJavaLocals } from './javaLocalCollector';
import { detectSourceRoots } from './javaModuleResolver';
import { buildGraphFromFileNodes } from '../../graphBuilder';
import {
  detectJavaFramework,
  findSpringAnnotatedFiles,
  findAndroidComponentFiles,
} from './javaFrameworkDetector';

export class JavaAnalyzer implements LanguageAnalyzer {
  readonly language = 'java' as const;
  readonly extensions = ['.java'];
  readonly vscodeLanguageIds = ['java'];

  buildGraph(files: string[], rootDir: string): DependencyGraph {
    const sourceRoots = detectSourceRoots(rootDir);
    const fileMap = new Map<string, FileNode>();

    for (const filePath of files) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const imports = collectJavaImports(content, filePath, rootDir, sourceRoots);
      const exports = collectJavaExports(content, filePath);
      const exportedNames = new Set(exports.map((e) => e.name));
      const locals = collectJavaLocals(content, exportedNames);

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

    // Look for build tool config files
    const buildFiles = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
    for (const buildFile of buildFiles) {
      const buildPath = path.join(rootDir, buildFile);
      if (fs.existsSync(buildPath)) {
        // Don't add the build file itself, but note that the project is managed
        break;
      }
    }

    // Look for files containing `public static void main`
    const sourceRoots = detectSourceRoots(rootDir);
    for (const sourceRoot of sourceRoots) {
      const mainFiles = findMainClasses(sourceRoot);
      entryPoints.push(...mainFiles);
    }

    // Framework-specific entry points
    const framework = detectJavaFramework(rootDir);
    if (framework?.type === 'spring') {
      const annotatedFiles = findSpringAnnotatedFiles(rootDir);
      entryPoints.push(...annotatedFiles);
    }
    if (framework?.type === 'android') {
      const androidFiles = findAndroidComponentFiles(rootDir);
      entryPoints.push(...androidFiles);
    }

    // Deduplicate
    return [...new Set(entryPoints)];
  }

  dispose(): void {
    // No resources to clean up
  }
}

function findMainClasses(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return results;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMainClasses(fullPath));
      } else if (entry.name.endsWith('.java')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes('public static void main')) {
            results.push(fullPath);
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return results;
}
