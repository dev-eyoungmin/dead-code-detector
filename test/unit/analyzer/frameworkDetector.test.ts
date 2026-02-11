import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectFramework,
  findFrameworkEntryPoints,
  getFrameworkConventionalExports,
} from '../../../src/analyzer/frameworkDetector';

describe('frameworkDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-detector-test-'));
  });

  afterEach(() => {
    // Clean up the temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('detectFramework', () => {
    it('should detect Next.js from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          next: '^14.0.0',
          react: '^18.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('next');
      expect(result?.conventionalExports).toContain('getServerSideProps');
      expect(result?.conventionalExports).toContain('getStaticProps');
      expect(result?.conventionalExports).toContain('generateMetadata');
    });

    it('should detect NestJS from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@nestjs/core': '^10.0.0',
          '@nestjs/common': '^10.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('nestjs');
      expect(result?.entryPatterns).toContain('src/**/*.module.{ts,js}');
      expect(result?.entryPatterns).toContain('src/**/*.controller.{ts,js}');
    });

    it('should detect React Native from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'react-native': '^0.73.0',
          react: '^18.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('react-native');
      expect(result?.entryPatterns).toContain('App.{tsx,ts,jsx,js}');
      expect(result?.conventionalExports).toEqual([]);
    });

    it('should detect Angular from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@angular/core': '^17.0.0',
          '@angular/common': '^17.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('angular');
      expect(result?.entryPatterns).toContain('src/**/*.component.ts');
      expect(result?.entryPatterns).toContain('src/**/*.module.ts');
    });

    it('should detect Remix from @remix-run/react dependency', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@remix-run/react': '^2.0.0',
          react: '^18.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('remix');
      expect(result?.conventionalExports).toContain('loader');
      expect(result?.conventionalExports).toContain('action');
      expect(result?.conventionalExports).toContain('meta');
    });

    it('should detect Remix from @remix-run/node dependency', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@remix-run/node': '^2.0.0',
          react: '^18.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('remix');
    });

    it('should return null when no framework is detected', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.21',
          express: '^4.18.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).toBeNull();
    });

    it('should return null when package.json does not exist', () => {
      // Don't create package.json
      const result = detectFramework(tempDir);

      expect(result).toBeNull();
    });

    it('should return null when package.json is invalid JSON', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        'this is not valid json {'
      );

      const result = detectFramework(tempDir);

      expect(result).toBeNull();
    });

    it('should detect framework from devDependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {},
        devDependencies: {
          next: '^14.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('next');
    });

    it('should handle package.json with no dependencies field', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).toBeNull();
    });
  });

  describe('getFrameworkConventionalExports', () => {
    it('should return Next.js conventional exports including getServerSideProps, getStaticProps, and generateMetadata', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          next: '^14.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toBeInstanceOf(Array);
      expect(result).toContain('getServerSideProps');
      expect(result).toContain('getStaticProps');
      expect(result).toContain('getStaticPaths');
      expect(result).toContain('generateMetadata');
      expect(result).toContain('generateStaticParams');
      expect(result).toContain('metadata');
      expect(result).toContain('dynamic');
      expect(result).toContain('revalidate');
      expect(result).toContain('runtime');
      expect(result).toContain('preferredRegion');
      expect(result).toContain('fetchCache');
      expect(result).toContain('dynamicParams');
    });

    it('should return Remix conventional exports including loader, action, and meta', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@remix-run/react': '^2.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toBeInstanceOf(Array);
      expect(result).toContain('loader');
      expect(result).toContain('action');
      expect(result).toContain('meta');
      expect(result).toContain('links');
      expect(result).toContain('headers');
      expect(result).toContain('handle');
      expect(result).toContain('ErrorBoundary');
      expect(result).toContain('CatchBoundary');
      expect(result).toContain('shouldRevalidate');
    });

    it('should return empty array when no framework is detected', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.21',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toEqual([]);
    });

    it('should return empty array for React Native framework', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'react-native': '^0.73.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toEqual([]);
    });

    it('should return empty array for NestJS framework', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@nestjs/core': '^10.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toEqual([]);
    });

    it('should return empty array for Angular framework', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@angular/core': '^17.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toEqual([]);
    });
  });

  describe('findFrameworkEntryPoints', () => {
    it('should return empty array for no framework project', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.21',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result).toEqual([]);
    });

    it('should return empty array when no entry files exist for detected framework', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          next: '^14.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Don't create any Next.js entry files
      const result = await findFrameworkEntryPoints(tempDir);

      expect(result).toEqual([]);
    });

    it('should find Next.js pages directory entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          next: '^14.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create Next.js pages directory structure
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'index.tsx'), 'export default function Home() {}');
      fs.writeFileSync(path.join(pagesDir, 'about.tsx'), 'export default function About() {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(file => file.includes('index.tsx'))).toBe(true);
      expect(result.some(file => file.includes('about.tsx'))).toBe(true);
    });

    it('should find Next.js app directory entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          next: '^14.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create Next.js app directory structure
      const appDir = path.join(tempDir, 'app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'page.tsx'), 'export default function Page() {}');
      fs.writeFileSync(path.join(appDir, 'layout.tsx'), 'export default function Layout() {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(file => file.includes('page.tsx'))).toBe(true);
      expect(result.some(file => file.includes('layout.tsx'))).toBe(true);
    });

    it('should find Remix route entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@remix-run/react': '^2.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create Remix routes directory structure
      const routesDir = path.join(tempDir, 'app', 'routes');
      fs.mkdirSync(routesDir, { recursive: true });
      fs.writeFileSync(path.join(routesDir, 'index.tsx'), 'export default function Index() {}');
      fs.writeFileSync(path.join(routesDir, '_index.tsx'), 'export default function Index() {}');

      const appDir = path.join(tempDir, 'app');
      fs.writeFileSync(path.join(appDir, 'root.tsx'), 'export default function Root() {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(file => file.includes('root.tsx'))).toBe(true);
    });

    it('should find NestJS entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@nestjs/core': '^10.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create NestJS structure
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'main.ts'), 'async function bootstrap() {}');
      fs.writeFileSync(path.join(srcDir, 'app.module.ts'), '@Module({}) export class AppModule {}');
      fs.writeFileSync(path.join(srcDir, 'app.controller.ts'), '@Controller() export class AppController {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(file => file.includes('main.ts'))).toBe(true);
      expect(result.some(file => file.includes('app.module.ts'))).toBe(true);
      expect(result.some(file => file.includes('app.controller.ts'))).toBe(true);
    });

    it('should ignore node_modules directory', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          next: '^14.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create a file in node_modules
      const nodeModulesDir = path.join(tempDir, 'node_modules', 'some-package', 'pages');
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      fs.writeFileSync(path.join(nodeModulesDir, 'index.tsx'), 'export default function Page() {}');

      // Create a legitimate pages file
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'index.tsx'), 'export default function Home() {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.length).toBe(1);
      expect(result[0]).not.toContain('node_modules');
      expect(result[0]).toContain(path.join('pages', 'index.tsx'));
    });
  });
});
