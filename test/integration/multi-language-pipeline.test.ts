import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { PythonAnalyzer } from '../../src/analyzer/languages/python/pythonAnalyzer';
import { GoAnalyzer } from '../../src/analyzer/languages/go/goAnalyzer';
import { JavaAnalyzer } from '../../src/analyzer/languages/java/javaAnalyzer';
import { detectUnusedFiles } from '../../src/analyzer/unusedFileDetector';
import { detectUnusedExports } from '../../src/analyzer/unusedExportDetector';
import { detectUnusedLocals } from '../../src/analyzer/unusedLocalDetector';
import { detectLanguage, groupFilesByLanguage } from '../../src/analyzer/languages';

describe('Multi-Language Pipeline Integration', () => {
  describe('Language Detection', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguage('app.ts')).toBe('typescript');
      expect(detectLanguage('component.tsx')).toBe('typescript');
      expect(detectLanguage('utils.js')).toBe('typescript');
      expect(detectLanguage('app.jsx')).toBe('typescript');
    });

    it('should detect Python files', () => {
      expect(detectLanguage('main.py')).toBe('python');
    });

    it('should detect Go files', () => {
      expect(detectLanguage('main.go')).toBe('go');
    });

    it('should detect Java files', () => {
      expect(detectLanguage('Main.java')).toBe('java');
    });

    it('should return undefined for unsupported files', () => {
      expect(detectLanguage('main.rb')).toBeUndefined();
      expect(detectLanguage('style.css')).toBeUndefined();
    });
  });

  describe('File Grouping', () => {
    it('should group files by language correctly', () => {
      const files = [
        'src/app.ts',
        'src/utils.py',
        'cmd/main.go',
        'src/Main.java',
        'src/styles.css',
      ];
      const groups = groupFilesByLanguage(files);
      expect(groups.get('typescript')).toEqual(['src/app.ts']);
      expect(groups.get('python')).toEqual(['src/utils.py']);
      expect(groups.get('go')).toEqual(['cmd/main.go']);
      expect(groups.get('java')).toEqual(['src/Main.java']);
    });
  });

  describe('Python Pipeline', () => {
    const fixtureDir = path.resolve(__dirname, '../fixtures/python-project');

    it('should build graph and detect unused files', () => {
      const analyzer = new PythonAnalyzer();
      const files = [
        path.join(fixtureDir, 'main.py'),
        path.join(fixtureDir, 'utils.py'),
        path.join(fixtureDir, 'models/__init__.py'),
        path.join(fixtureDir, 'models/user.py'),
        path.join(fixtureDir, 'unused_module.py'),
      ];

      const graph = analyzer.buildGraph(files, fixtureDir);
      const entryPoints = [path.join(fixtureDir, 'main.py')];
      const unusedFiles = detectUnusedFiles(graph, entryPoints);

      const unusedPaths = unusedFiles.map((f) => path.basename(f.filePath));
      expect(unusedPaths).toContain('unused_module.py');
      expect(unusedPaths).not.toContain('main.py');
    });

    it('should detect unused exports in Python', () => {
      const analyzer = new PythonAnalyzer();
      const files = [
        path.join(fixtureDir, 'main.py'),
        path.join(fixtureDir, 'utils.py'),
        path.join(fixtureDir, 'models/__init__.py'),
        path.join(fixtureDir, 'models/user.py'),
        path.join(fixtureDir, 'unused_module.py'),
      ];

      const graph = analyzer.buildGraph(files, fixtureDir);
      const entryPoints = [path.join(fixtureDir, 'main.py')];
      const unusedExports = detectUnusedExports(graph, entryPoints);
      const unusedNames = unusedExports.map((e) => e.exportName);

      // unused_helper and UNUSED_CONSTANT from utils.py should be unused
      expect(unusedNames).toContain('unused_helper');
      expect(unusedNames).toContain('UNUSED_CONSTANT');
    });

    it('should find Python entry points', async () => {
      const analyzer = new PythonAnalyzer();
      const entryPoints = await analyzer.findEntryPoints(fixtureDir);
      expect(entryPoints.some((e) => e.endsWith('main.py'))).toBe(true);
    });
  });

  describe('Go Pipeline', () => {
    const fixtureDir = path.resolve(__dirname, '../fixtures/go-project');

    it('should build graph from Go files', () => {
      const analyzer = new GoAnalyzer();
      const files = [
        path.join(fixtureDir, 'main.go'),
        path.join(fixtureDir, 'pkg/utils/utils.go'),
      ];

      const graph = analyzer.buildGraph(files, fixtureDir);
      expect(graph.files.size).toBe(2);
    });

    it('should detect exported/unexported symbols', () => {
      const analyzer = new GoAnalyzer();
      const files = [
        path.join(fixtureDir, 'pkg/utils/utils.go'),
      ];

      const graph = analyzer.buildGraph(files, fixtureDir);
      const utilsFile = graph.files.get(path.join(fixtureDir, 'pkg/utils/utils.go'));
      expect(utilsFile).toBeDefined();

      const exportNames = utilsFile!.exports.map((e) => e.name);
      expect(exportNames).toContain('FormatName');
      expect(exportNames).toContain('UnusedFunc');
      expect(exportNames).toContain('AppVersion');
      expect(exportNames).toContain('UnusedConst');
      expect(exportNames).not.toContain('capitalize');
      expect(exportNames).not.toContain('internalState');

      const localNames = utilsFile!.locals.map((l) => l.name);
      expect(localNames).toContain('capitalize');
      expect(localNames).toContain('internalState');
    });

    it('should find Go entry points', async () => {
      const analyzer = new GoAnalyzer();
      const entryPoints = await analyzer.findEntryPoints(fixtureDir);
      expect(entryPoints.some((e) => e.endsWith('main.go'))).toBe(true);
    });
  });

  describe('Java Pipeline', () => {
    const fixtureDir = path.resolve(__dirname, '../fixtures/java-project');

    it('should build graph from Java files', () => {
      const analyzer = new JavaAnalyzer();
      const files = [
        path.join(fixtureDir, 'src/com/example/Main.java'),
        path.join(fixtureDir, 'src/com/example/util/StringHelper.java'),
        path.join(fixtureDir, 'src/com/example/UnusedService.java'),
      ];

      const graph = analyzer.buildGraph(files, fixtureDir);
      expect(graph.files.size).toBe(3);
    });

    it('should detect public vs private symbols', () => {
      const analyzer = new JavaAnalyzer();
      const files = [
        path.join(fixtureDir, 'src/com/example/util/StringHelper.java'),
      ];

      const graph = analyzer.buildGraph(files, fixtureDir);
      const helperFile = graph.files.get(
        path.join(fixtureDir, 'src/com/example/util/StringHelper.java')
      );
      expect(helperFile).toBeDefined();

      const exportNames = helperFile!.exports.map((e) => e.name);
      expect(exportNames).toContain('StringHelper');
      expect(exportNames).toContain('capitalize');
      expect(exportNames).toContain('APP_NAME');
      expect(exportNames).toContain('unusedPublicMethod');

      const localNames = helperFile!.locals.map((l) => l.name);
      expect(localNames).toContain('internalCapitalize');
      expect(localNames).toContain('unusedPrivateMethod');
      expect(localNames).toContain('UNUSED_SECRET');
    });

    it('should find Java entry points', async () => {
      const analyzer = new JavaAnalyzer();
      const entryPoints = await analyzer.findEntryPoints(fixtureDir);
      expect(entryPoints.some((e) => e.endsWith('Main.java'))).toBe(true);
    });
  });
});
