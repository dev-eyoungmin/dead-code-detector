import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

export type FrameworkType =
  | 'next'
  | 'react-native'
  | 'nestjs'
  | 'angular'
  | 'remix'
  | 'vue'
  | 'svelte'
  | 'express'
  | 'gatsby'
  | 'storybook'
  | 'expo'
  | null;

export interface FrameworkInfo {
  type: FrameworkType;
  entryPatterns: string[];
  conventionalExports: string[];
}

const FRAMEWORK_CONFIGS: Record<string, FrameworkInfo> = {
  next: {
    type: 'next',
    entryPatterns: [
      'pages/**/*.{ts,tsx,js,jsx}',
      'src/pages/**/*.{ts,tsx,js,jsx}',
      'app/**/page.{ts,tsx,js,jsx}',
      'src/app/**/page.{ts,tsx,js,jsx}',
      'app/**/layout.{ts,tsx,js,jsx}',
      'src/app/**/layout.{ts,tsx,js,jsx}',
      'app/**/loading.{ts,tsx,js,jsx}',
      'src/app/**/loading.{ts,tsx,js,jsx}',
      'app/**/error.{ts,tsx,js,jsx}',
      'src/app/**/error.{ts,tsx,js,jsx}',
      'app/**/not-found.{ts,tsx,js,jsx}',
      'src/app/**/not-found.{ts,tsx,js,jsx}',
      'app/**/template.{ts,tsx,js,jsx}',
      'src/app/**/template.{ts,tsx,js,jsx}',
      'app/**/default.{ts,tsx,js,jsx}',
      'src/app/**/default.{ts,tsx,js,jsx}',
      'app/api/**/*.{ts,js}',
      'src/app/api/**/*.{ts,js}',
      'middleware.{ts,js}',
      'src/middleware.{ts,js}',
    ],
    conventionalExports: [
      'getServerSideProps',
      'getStaticProps',
      'getStaticPaths',
      'generateMetadata',
      'generateStaticParams',
      'metadata',
      'dynamic',
      'revalidate',
      'runtime',
      'preferredRegion',
      'fetchCache',
      'dynamicParams',
      // Route Handlers
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'HEAD',
      'OPTIONS',
      // App Router
      'generateViewport',
      'viewport',
      'default',
    ],
  },
  'react-native': {
    type: 'react-native',
    entryPatterns: [
      'App.{tsx,ts,jsx,js}',
      'app.{tsx,ts,jsx,js}',
      'index.{tsx,ts,jsx,js}',
      'src/App.{tsx,ts,jsx,js}',
    ],
    conventionalExports: [
      'navigationOptions',
      'screenOptions',
      'defaultProps',
      'propTypes',
      'contextTypes',
      'childContextTypes',
      'displayName',
      'NavigationContainer',
    ],
  },
  nestjs: {
    type: 'nestjs',
    entryPatterns: [
      'src/**/*.module.{ts,js}',
      'src/**/*.controller.{ts,js}',
      'src/**/*.service.{ts,js}',
      'src/**/*.guard.{ts,js}',
      'src/**/*.interceptor.{ts,js}',
      'src/**/*.pipe.{ts,js}',
      'src/**/*.filter.{ts,js}',
      'src/main.{ts,js}',
    ],
    conventionalExports: [
      'AppModule',
      'AppController',
      'AppService',
      // Lifecycle hooks
      'onModuleInit',
      'onModuleDestroy',
      'onApplicationBootstrap',
      'beforeApplicationShutdown',
      'onApplicationShutdown',
      // Common patterns
      'validate',
      'transform',
      'canActivate',
      'intercept',
      'catch',
      'use',
      'createParamDecorator',
    ],
  },
  angular: {
    type: 'angular',
    entryPatterns: [
      'src/**/*.component.ts',
      'src/**/*.module.ts',
      'src/**/*.service.ts',
      'src/**/*.directive.ts',
      'src/**/*.pipe.ts',
      'src/**/*.guard.ts',
      'src/main.ts',
    ],
    conventionalExports: [
      'AppModule',
      'AppComponent',
      'AppRoutingModule',
      // Lifecycle hooks
      'ngOnInit',
      'ngOnDestroy',
      'ngOnChanges',
      'ngAfterViewInit',
      'ngAfterContentInit',
      'ngDoCheck',
      // Router
      'canActivate',
      'canDeactivate',
      'canLoad',
      'resolve',
      // Pipes & Directives
      'transform',
      'validate',
    ],
  },
  remix: {
    type: 'remix',
    entryPatterns: [
      'app/routes/**/*.{ts,tsx,js,jsx}',
      'app/root.{ts,tsx,js,jsx}',
      'app/entry.client.{ts,tsx,js,jsx}',
      'app/entry.server.{ts,tsx,js,jsx}',
    ],
    conventionalExports: [
      'loader',
      'action',
      'meta',
      'links',
      'headers',
      'handle',
      'ErrorBoundary',
      'CatchBoundary',
      'shouldRevalidate',
    ],
  },
  vue: {
    type: 'vue',
    entryPatterns: [
      'src/App.vue',
      'src/main.{ts,js}',
      'src/views/**/*.vue',
      'src/router/**/*.{ts,js}',
    ],
    conventionalExports: [
      'setup',
      'defineComponent',
      'defineProps',
      'defineEmits',
      'defineExpose',
    ],
  },
  svelte: {
    type: 'svelte',
    entryPatterns: [
      'src/App.svelte',
      'src/routes/**/*.svelte',
      'src/lib/**/*.svelte',
    ],
    conventionalExports: [],
  },
  express: {
    type: 'express',
    entryPatterns: [
      'src/server.{ts,js}',
      'src/app.{ts,js}',
      'server.{ts,js}',
      'app.{ts,js}',
    ],
    conventionalExports: ['router', 'middleware'],
  },
  gatsby: {
    type: 'gatsby',
    entryPatterns: [
      'src/pages/**/*.{ts,tsx,js,jsx}',
      'gatsby-config.{ts,js}',
      'gatsby-node.{ts,js}',
      'gatsby-browser.{ts,js}',
      'gatsby-ssr.{ts,js}',
    ],
    conventionalExports: [
      'createPages',
      'onCreateNode',
      'createSchemaCustomization',
      'sourceNodes',
      'wrapRootElement',
      'wrapPageElement',
    ],
  },
  storybook: {
    type: 'storybook',
    entryPatterns: [
      '**/*.stories.{ts,tsx,js,jsx}',
      '.storybook/**/*.{ts,tsx,js,jsx}',
    ],
    conventionalExports: [
      'default',
      'decorators',
      'parameters',
      'argTypes',
      'args',
      'play',
      'render',
      'loaders',
    ],
  },
  expo: {
    type: 'expo',
    entryPatterns: [
      'App.{tsx,ts,jsx,js}',
      'app/**/*.{tsx,ts,jsx,js}',
      'app.config.{ts,js}',
    ],
    conventionalExports: ['default'],
  },
};

/** Dependency name → framework key mapping */
const FRAMEWORK_DEPS: Record<string, string> = {
  next: 'next',
  'react-native': 'react-native',
  '@nestjs/core': 'nestjs',
  '@angular/core': 'angular',
  '@remix-run/react': 'remix',
  '@remix-run/node': 'remix',
  vue: 'vue',
  svelte: 'svelte',
  express: 'express',
  gatsby: 'gatsby',
  '@storybook/react': 'storybook',
  '@storybook/vue3': 'storybook',
  expo: 'expo',
};

/**
 * Reads and parses the package.json dependencies from a root directory
 */
function readAllDeps(
  rootDir: string
): Record<string, string> | null {
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
  } catch {
    return null;
  }
}

/**
 * Detects the first matching framework used in the project by reading package.json.
 * Maintained for backward compatibility.
 */
export function detectFramework(rootDir: string): FrameworkInfo | null {
  const allDeps = readAllDeps(rootDir);
  if (!allDeps) {
    return null;
  }

  for (const [depName, frameworkKey] of Object.entries(FRAMEWORK_DEPS)) {
    if (allDeps[depName]) {
      return FRAMEWORK_CONFIGS[frameworkKey] ?? null;
    }
  }

  return null;
}

/**
 * Detects all frameworks used in the project (e.g., Next.js + Storybook).
 * Returns an array of FrameworkInfo for each detected framework.
 */
export function detectFrameworks(rootDir: string): FrameworkInfo[] {
  const allDeps = readAllDeps(rootDir);
  if (!allDeps) {
    return [];
  }

  const frameworks: FrameworkInfo[] = [];

  for (const [depName, frameworkKey] of Object.entries(FRAMEWORK_DEPS)) {
    if (allDeps[depName]) {
      const config = FRAMEWORK_CONFIGS[frameworkKey];
      if (config && !frameworks.some((f) => f.type === config.type)) {
        frameworks.push(config);
      }
    }
  }

  return frameworks;
}

/**
 * Finds framework-specific entry point files
 */
export async function findFrameworkEntryPoints(
  rootDir: string
): Promise<string[]> {
  const frameworks = detectFrameworks(rootDir);
  if (frameworks.length === 0) {
    return [];
  }

  const allPatterns = frameworks.flatMap((f) => f.entryPatterns);

  const matched = await fg(allPatterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**'],
  });

  return matched;
}

/**
 * Returns conventional export names for all detected frameworks, merged.
 */
export function getFrameworkConventionalExports(
  rootDir: string
): string[] {
  const frameworks = detectFrameworks(rootDir);
  if (frameworks.length === 0) {
    return [];
  }

  const allExports = new Set<string>();
  for (const framework of frameworks) {
    for (const exp of framework.conventionalExports) {
      allExports.add(exp);
    }
  }
  return Array.from(allExports);
}
