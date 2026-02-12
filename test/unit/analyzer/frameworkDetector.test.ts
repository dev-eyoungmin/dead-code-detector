import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectFramework,
  detectFrameworks,
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

    it('should detect Vue from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { vue: '^3.4.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('vue');
      expect(result?.entryPatterns).toContain('src/App.vue');
      expect(result?.conventionalExports).toContain('setup');
      expect(result?.conventionalExports).toContain('defineComponent');
    });

    it('should detect Svelte from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { svelte: '^4.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('svelte');
      expect(result?.entryPatterns).toContain('src/App.svelte');
      expect(result?.entryPatterns).toContain('src/routes/**/*.svelte');
    });

    it('should detect Express from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { express: '^4.18.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('express');
      expect(result?.entryPatterns).toContain('src/server.{ts,js}');
      expect(result?.entryPatterns).toContain('app.{ts,js}');
    });

    it('should detect Gatsby from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { gatsby: '^5.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('gatsby');
      expect(result?.conventionalExports).toContain('createPages');
      expect(result?.conventionalExports).toContain('wrapRootElement');
    });

    it('should detect Storybook from @storybook/react dependency', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        devDependencies: { '@storybook/react': '^7.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('storybook');
      expect(result?.entryPatterns).toContain('**/*.stories.{ts,tsx,js,jsx}');
      expect(result?.conventionalExports).toContain('decorators');
      expect(result?.conventionalExports).toContain('play');
    });

    it('should detect Expo from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { expo: '^50.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFramework(tempDir);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('expo');
      expect(result?.conventionalExports).toContain('default');
    });

    it('should return null when no framework is detected', () => {
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

  describe('detectFrameworks (multi-framework)', () => {
    it('should detect multiple frameworks simultaneously (Next.js + Storybook)', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { next: '^14.0.0' },
        devDependencies: { '@storybook/react': '^7.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFrameworks(tempDir);

      expect(result.length).toBeGreaterThanOrEqual(2);
      const types = result.map((f) => f.type);
      expect(types).toContain('next');
      expect(types).toContain('storybook');
    });

    it('should return empty array when no framework is detected', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { lodash: '^4.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFrameworks(tempDir);
      expect(result).toEqual([]);
    });

    it('should not duplicate framework entries from multiple deps', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          '@remix-run/react': '^2.0.0',
          '@remix-run/node': '^2.0.0',
        },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = detectFrameworks(tempDir);
      const remixEntries = result.filter((f) => f.type === 'remix');
      expect(remixEntries).toHaveLength(1);
    });
  });

  describe('getFrameworkConventionalExports', () => {
    it('should return Next.js conventional exports including route handlers', () => {
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
      // Route handlers
      expect(result).toContain('GET');
      expect(result).toContain('POST');
      expect(result).toContain('PUT');
      expect(result).toContain('DELETE');
      expect(result).toContain('PATCH');
      // App Router
      expect(result).toContain('generateViewport');
      expect(result).toContain('viewport');
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

    it('should return React Native conventional exports', () => {
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

      expect(result).toContain('navigationOptions');
      expect(result).toContain('screenOptions');
      expect(result).toContain('displayName');
    });

    it('should return NestJS conventional exports including lifecycle hooks', () => {
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

      expect(result).toContain('AppModule');
      expect(result).toContain('onModuleInit');
      expect(result).toContain('onModuleDestroy');
      expect(result).toContain('canActivate');
    });

    it('should return Angular conventional exports including lifecycle hooks', () => {
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

      expect(result).toContain('AppModule');
      expect(result).toContain('AppComponent');
      expect(result).toContain('ngOnInit');
      expect(result).toContain('ngOnDestroy');
      expect(result).toContain('canActivate');
    });

    it('should return Gatsby conventional exports', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { gatsby: '^5.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      expect(result).toContain('createPages');
      expect(result).toContain('onCreateNode');
      expect(result).toContain('wrapRootElement');
    });

    it('should merge conventional exports from multiple frameworks', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { next: '^14.0.0' },
        devDependencies: { '@storybook/react': '^7.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const result = getFrameworkConventionalExports(tempDir);

      // Next.js exports
      expect(result).toContain('getServerSideProps');
      // Storybook exports
      expect(result).toContain('decorators');
      expect(result).toContain('play');
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

    it('should find Next.js app router template and default files', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { next: '^14.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const appDir = path.join(tempDir, 'app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'template.tsx'), 'export default function Template() {}');
      fs.writeFileSync(path.join(appDir, 'default.tsx'), 'export default function Default() {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('template.tsx'))).toBe(true);
      expect(result.some(file => file.includes('default.tsx'))).toBe(true);
    });

    it('should find Next.js API route handler files', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { next: '^14.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const apiDir = path.join(tempDir, 'app', 'api', 'users');
      fs.mkdirSync(apiDir, { recursive: true });
      fs.writeFileSync(path.join(apiDir, 'route.ts'), 'export async function GET() {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('route.ts'))).toBe(true);
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

    it('should find Vue entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { vue: '^3.4.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'App.vue'), '<template></template>');
      fs.writeFileSync(path.join(srcDir, 'main.ts'), 'createApp(App).mount("#app")');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('App.vue'))).toBe(true);
      expect(result.some(file => file.includes('main.ts'))).toBe(true);
    });

    it('should find Svelte entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { svelte: '^4.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'App.svelte'), '<h1>Hello</h1>');

      const routesDir = path.join(srcDir, 'routes');
      fs.mkdirSync(routesDir, { recursive: true });
      fs.writeFileSync(path.join(routesDir, '+page.svelte'), '<h1>Page</h1>');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('App.svelte'))).toBe(true);
      expect(result.some(file => file.includes('+page.svelte'))).toBe(true);
    });

    it('should find Express entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { express: '^4.18.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      fs.writeFileSync(path.join(tempDir, 'server.ts'), 'const app = express();');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('server.ts'))).toBe(true);
    });

    it('should find Storybook story file entry points', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        devDependencies: { '@storybook/react': '^7.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'Button.stories.tsx'), 'export default {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('Button.stories.tsx'))).toBe(true);
    });

    it('should find entry points from multiple frameworks', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: { next: '^14.0.0' },
        devDependencies: { '@storybook/react': '^7.0.0' },
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Next.js file
      const pagesDir = path.join(tempDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      fs.writeFileSync(path.join(pagesDir, 'index.tsx'), 'export default function Home() {}');

      // Storybook file
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'Button.stories.tsx'), 'export default {}');

      const result = await findFrameworkEntryPoints(tempDir);

      expect(result.some(file => file.includes('index.tsx'))).toBe(true);
      expect(result.some(file => file.includes('Button.stories.tsx'))).toBe(true);
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
