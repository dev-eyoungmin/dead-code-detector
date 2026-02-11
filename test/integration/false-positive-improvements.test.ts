import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { analyze } from '../../src/analyzer';

describe('False Positive Improvements - Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'false-positive-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper: write file and return its absolute path */
  function writeFile(relativePath: string, content: string): string {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return fullPath;
  }

  function writeTsConfig(config: object): string {
    return writeFile('tsconfig.json', JSON.stringify(config, null, 2));
  }

  function writePackageJson(deps: Record<string, string> = {}): string {
    return writeFile(
      'package.json',
      JSON.stringify({ name: 'test', version: '1.0.0', dependencies: deps }, null, 2)
    );
  }

  // ─────────────────────────────────────────────────────
  // 1. Path Alias Resolution
  // ─────────────────────────────────────────────────────
  describe('path alias resolution', () => {
    it('should not report aliased imports as unused exports', async () => {
      writeTsConfig({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      });
      writePackageJson();

      const utilsFile = writeFile(
        'src/utils.ts',
        'export function helper() { return 42; }\nexport function unused() { return 0; }'
      );
      const indexFile = writeFile(
        'src/index.ts',
        "import { helper } from '@/utils';\nconsole.log(helper());"
      );

      const result = await analyze({
        files: [indexFile, utilsFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      // helper is imported via @/utils → should NOT be reported as unused
      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      expect(unusedExportNames).not.toContain('helper');
      // unused is genuinely unused → should be reported
      expect(unusedExportNames).toContain('unused');
    });

    it('should not report file as unused when imported via path alias', async () => {
      writeTsConfig({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          baseUrl: '.',
          paths: { '~/*': ['src/*'] },
        },
      });
      writePackageJson();

      const componentFile = writeFile(
        'src/components/Button.ts',
        'export default function Button() { return "button"; }'
      );
      const indexFile = writeFile(
        'src/index.ts',
        "import Button from '~/components/Button';\nconsole.log(Button());"
      );

      const result = await analyze({
        files: [indexFile, componentFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      // Button.ts is imported via ~/components/Button → should NOT be unused file
      const unusedFilePaths = result.unusedFiles.map((f) => f.filePath);
      expect(unusedFilePaths.some((f) => f.includes('Button.ts'))).toBe(false);
    });

    it('should resolve baseUrl-only imports correctly', async () => {
      writeTsConfig({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          baseUrl: 'src',
        },
      });
      writePackageJson();

      const libFile = writeFile(
        'src/lib/math.ts',
        'export function add(a: number, b: number) { return a + b; }'
      );
      const indexFile = writeFile(
        'src/index.ts',
        "import { add } from 'lib/math';\nconsole.log(add(1, 2));"
      );

      const result = await analyze({
        files: [indexFile, libFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      expect(unusedExportNames).not.toContain('add');

      const unusedFilePaths = result.unusedFiles.map((f) => f.filePath);
      expect(unusedFilePaths.some((f) => f.includes('math.ts'))).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────
  // 2. @dead-code-ignore comments
  // ─────────────────────────────────────────────────────
  describe('@dead-code-ignore comments', () => {
    it('should suppress unused export when preceding line has @dead-code-ignore', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson();

      const utilsFile = writeFile(
        'src/utils.ts',
        [
          '// Utility functions file',
          '// This file has some exports',
          '// Some are intentionally unused for testing',
          '',
          '// @dead-code-ignore',
          'export function intentionallyUnused() { return 1; }',
          '',
          'export function alsoUnused() { return 2; }',
        ].join('\n')
      );
      const indexFile = writeFile('src/index.ts', 'console.log("hello");');

      const result = await analyze({
        files: [indexFile, utilsFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      // intentionallyUnused has @dead-code-ignore → should NOT be reported
      expect(unusedExportNames).not.toContain('intentionallyUnused');
      // alsoUnused has no ignore → should be reported
      expect(unusedExportNames).toContain('alsoUnused');
    });

    it('should suppress unused local when line has @dead-code-ignore', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson();

      const mainFile = writeFile(
        'src/main.ts',
        [
          '// Prevent file-level ignore',
          '',
          'export function work() {',
          '  // @dead-code-ignore',
          '  const debugFlag = true;',
          '  const reallyUnused = false;',
          '  return 42;',
          '}',
        ].join('\n')
      );
      const indexFile = writeFile(
        'src/index.ts',
        "import { work } from './main';\nconsole.log(work());"
      );

      const result = await analyze({
        files: [indexFile, mainFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      const unusedLocalNames = result.unusedLocals.map((l) => l.symbolName);
      // debugFlag has @dead-code-ignore on preceding line → should NOT be reported
      expect(unusedLocalNames).not.toContain('debugFlag');
      // reallyUnused has no ignore → should be reported
      expect(unusedLocalNames).toContain('reallyUnused');
    });

    it('should suppress entire file when file-level @dead-code-ignore is present', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson();

      const ignoredFile = writeFile(
        'src/ignored.ts',
        [
          '// @dead-code-ignore',
          'export function notReported() { return 1; }',
          'export function alsoNotReported() { return 2; }',
        ].join('\n')
      );
      const regularFile = writeFile(
        'src/regular.ts',
        'export function shouldBeReported() { return 3; }'
      );
      const indexFile = writeFile('src/index.ts', 'console.log("hello");');

      const result = await analyze({
        files: [indexFile, ignoredFile, regularFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      // File-level ignore should suppress ALL exports from ignored.ts
      expect(unusedExportNames).not.toContain('notReported');
      expect(unusedExportNames).not.toContain('alsoNotReported');
      // regular.ts exports should still be reported
      expect(unusedExportNames).toContain('shouldBeReported');

      // ignored.ts should also not appear in unused files
      const unusedFileNames = result.unusedFiles.map((f) => path.basename(f.filePath));
      expect(unusedFileNames).not.toContain('ignored.ts');
      // regular.ts should still appear in unused files
      expect(unusedFileNames).toContain('regular.ts');
    });
  });

  // ─────────────────────────────────────────────────────
  // 3. ignorePatterns config filtering
  // ─────────────────────────────────────────────────────
  describe('ignorePatterns config', () => {
    it('should filter results matching ignorePatterns', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson();

      const generatedFile = writeFile(
        'src/generated/api.ts',
        'export function generatedEndpoint() { return "/api"; }'
      );
      const regularFile = writeFile(
        'src/manual.ts',
        'export function manualCode() { return "manual"; }'
      );
      const indexFile = writeFile('src/index.ts', 'console.log("app");');

      const result = await analyze({
        files: [indexFile, generatedFile, regularFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
        ignorePatterns: ['**/generated/**'],
      });

      // generated/api.ts should be filtered out by ignorePatterns
      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      expect(unusedExportNames).not.toContain('generatedEndpoint');

      const unusedFilePaths = result.unusedFiles.map((f) => f.filePath);
      expect(unusedFilePaths.some((f) => f.includes('generated'))).toBe(false);

      // manual.ts should still be reported
      expect(unusedExportNames).toContain('manualCode');
    });

    it('should support multiple ignorePatterns', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson();

      const storyFile = writeFile(
        'src/Button.stories.ts',
        'export const Primary = {};'
      );
      const testHelper = writeFile(
        'src/testUtils.ts',
        'export function renderWith() { return null; }'
      );
      const realFile = writeFile(
        'src/real.ts',
        'export function realFunction() { return 1; }'
      );
      const indexFile = writeFile('src/index.ts', 'console.log("app");');

      const result = await analyze({
        files: [indexFile, storyFile, testHelper, realFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
        ignorePatterns: ['**/*.stories.*', '**/testUtils.*'],
      });

      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      expect(unusedExportNames).not.toContain('Primary');
      expect(unusedExportNames).not.toContain('renderWith');
      expect(unusedExportNames).toContain('realFunction');
    });

    it('should not filter anything when ignorePatterns is empty', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson();

      const utilsFile = writeFile(
        'src/utils.ts',
        'export function unused() { return 0; }'
      );
      const indexFile = writeFile('src/index.ts', 'console.log("app");');

      const result = await analyze({
        files: [indexFile, utilsFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
        ignorePatterns: [],
      });

      const unusedExportNames = result.unusedExports.map((e) => e.exportName);
      expect(unusedExportNames).toContain('unused');
    });
  });

  // ─────────────────────────────────────────────────────
  // 4. Framework conventional exports confidence
  // ─────────────────────────────────────────────────────
  describe('framework conventional export confidence', () => {
    it('should give low confidence to Next.js conventional exports', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson({ next: '^14.0.0', react: '^18.0.0' });

      const pageFile = writeFile(
        'src/page.ts',
        [
          'export default function Page() { return "page"; }',
          'export function getServerSideProps() { return { props: {} }; }',
          'export function totallyUnused() { return null; }',
        ].join('\n')
      );
      const indexFile = writeFile('src/index.ts', 'console.log("app");');

      const result = await analyze({
        files: [indexFile, pageFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      const gssp = result.unusedExports.find(
        (e) => e.exportName === 'getServerSideProps'
      );
      const regular = result.unusedExports.find(
        (e) => e.exportName === 'totallyUnused'
      );

      // getServerSideProps is a Next.js conventional export → low confidence
      if (gssp) {
        expect(gssp.confidence).toBe('low');
      }

      // totallyUnused is a regular named export → medium confidence
      if (regular) {
        expect(regular.confidence).toBe('medium');
      }
    });

    it('should give low confidence to Remix conventional exports', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson({ '@remix-run/react': '^2.0.0', react: '^18.0.0' });

      const routeFile = writeFile(
        'src/route.ts',
        [
          'export default function Route() { return "route"; }',
          'export function loader() { return { data: {} }; }',
          'export function action() { return null; }',
          'export function regularExport() { return 1; }',
        ].join('\n')
      );
      const indexFile = writeFile('src/index.ts', 'console.log("app");');

      const result = await analyze({
        files: [indexFile, routeFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      const loader = result.unusedExports.find(
        (e) => e.exportName === 'loader'
      );
      const action = result.unusedExports.find(
        (e) => e.exportName === 'action'
      );
      const regular = result.unusedExports.find(
        (e) => e.exportName === 'regularExport'
      );

      if (loader) {
        expect(loader.confidence).toBe('low');
      }
      if (action) {
        expect(action.confidence).toBe('low');
      }
      if (regular) {
        expect(regular.confidence).toBe('medium');
      }
    });

    it('should not change confidence for non-framework projects', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson({ lodash: '^4.17.21' });

      const utilsFile = writeFile(
        'src/utils.ts',
        [
          'export function getServerSideProps() { return {}; }',
          'export function loader() { return {}; }',
        ].join('\n')
      );
      const indexFile = writeFile('src/index.ts', 'console.log("app");');

      const result = await analyze({
        files: [indexFile, utilsFile],
        rootDir: tempDir,
        entryPoints: [indexFile],
        tsconfigPath: path.join(tempDir, 'tsconfig.json'),
      });

      // Without a framework, these names shouldn't get special treatment
      const gssp = result.unusedExports.find(
        (e) => e.exportName === 'getServerSideProps'
      );
      const loader = result.unusedExports.find(
        (e) => e.exportName === 'loader'
      );

      if (gssp) {
        expect(gssp.confidence).toBe('medium');
      }
      if (loader) {
        expect(loader.confidence).toBe('medium');
      }
    });
  });

  // ─────────────────────────────────────────────────────
  // 5. Framework entry point auto-detection
  // ─────────────────────────────────────────────────────
  describe('framework entry point detection', () => {
    it('should auto-detect Next.js pages as entry points via findEntryPoints', async () => {
      writeTsConfig({
        compilerOptions: { target: 'ES2020', module: 'commonjs' },
      });
      writePackageJson({ next: '^14.0.0', react: '^18.0.0' });

      // Next.js pages directory — should be detected as entry points
      const homePage = writeFile(
        'pages/index.tsx',
        'export default function Home() { return "home"; }'
      );
      const aboutPage = writeFile(
        'pages/about.tsx',
        'export default function About() { return "about"; }'
      );

      // Import the TypeScript analyzer to test findEntryPoints
      const { TypeScriptAnalyzer } = await import(
        '../../src/analyzer/languages/typescriptAnalyzer'
      );
      const analyzer = new TypeScriptAnalyzer();
      const entryPoints = await analyzer.findEntryPoints(tempDir);

      // pages/*.tsx should be detected as entry points
      expect(entryPoints.some((ep) => ep.includes('index.tsx'))).toBe(true);
      expect(entryPoints.some((ep) => ep.includes('about.tsx'))).toBe(true);

      analyzer.dispose();
    });
  });
});
