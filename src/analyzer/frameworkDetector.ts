import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

export type FrameworkType =
  | 'next'
  | 'react-native'
  | 'nestjs'
  | 'angular'
  | 'remix'
  | null;

interface FrameworkInfo {
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
    conventionalExports: [],
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
    conventionalExports: [],
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
    conventionalExports: [],
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
};

/** Dependency name → framework key mapping */
const FRAMEWORK_DEPS: Record<string, string> = {
  next: 'next',
  'react-native': 'react-native',
  '@nestjs/core': 'nestjs',
  '@angular/core': 'angular',
  '@remix-run/react': 'remix',
  '@remix-run/node': 'remix',
};

/**
 * Detects the framework used in the project by reading package.json
 */
export function detectFramework(rootDir: string): FrameworkInfo | null {
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    for (const [depName, frameworkKey] of Object.entries(FRAMEWORK_DEPS)) {
      if (allDeps[depName]) {
        return FRAMEWORK_CONFIGS[frameworkKey] ?? null;
      }
    }
  } catch {
    // Failed to parse package.json
  }

  return null;
}

/**
 * Finds framework-specific entry point files
 */
export async function findFrameworkEntryPoints(
  rootDir: string
): Promise<string[]> {
  const framework = detectFramework(rootDir);
  if (!framework) {
    return [];
  }

  const matched = await fg(framework.entryPatterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**'],
  });

  return matched;
}

/**
 * Returns conventional export names for the detected framework
 */
export function getFrameworkConventionalExports(
  rootDir: string
): string[] {
  const framework = detectFramework(rootDir);
  if (!framework) {
    return [];
  }
  return framework.conventionalExports;
}
