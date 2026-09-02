import * as path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';
import { readSource } from '../../sourceCache';

export type PhpFrameworkType = 'laravel' | 'symfony' | 'wordpress';

/** PHP magic methods (always applied, framework-independent) plus common interface methods
 * (Countable, Iterator, ArrayAccess, JsonSerializable) that PHP invokes implicitly. */
export const PHP_MAGIC_METHODS: string[] = [
  '__construct', '__destruct', '__call', '__callStatic', '__get', '__set', '__isset', '__unset',
  '__sleep', '__wakeup', '__serialize', '__unserialize', '__toString', '__invoke', '__set_state',
  '__clone', '__debugInfo',
  'jsonSerialize', 'offsetExists', 'offsetGet', 'offsetSet', 'offsetUnset', 'getIterator', 'count',
  'current', 'key', 'next', 'rewind', 'valid',
];

const LARAVEL_CONVENTIONAL_EXPORTS: string[] = [
  'boot', 'register', 'handle', 'rules', 'authorize', 'toArray', 'toResponse', 'render', 'build',
  'via', 'toMail', 'toDatabase', 'toBroadcast', 'broadcastOn', 'broadcastWith', 'failed', 'middleware',
  'tags', 'shouldQueue', 'retryUntil', 'up', 'down', 'run', 'definition', 'passes', 'message',
  'terminate', 'report', 'casts', 'booted', 'viewAny', 'view', 'create', 'update', 'delete', 'restore',
  'forceDelete', 'creating', 'created', 'updating', 'updated', 'deleting', 'deleted', 'saving', 'saved',
  'restoring', 'restored', 'mount', 'hydrate', 'dehydrate', 'rendering', 'rendered', 'attributes',
  'configure', 'schedule', 'commands', 'map', 'routes', 'gate', 'policies', 'subscribe',
];

const SYMFONY_CONVENTIONAL_EXPORTS: string[] = [
  'configure', 'execute', 'interact', 'initialize', 'getSubscribedEvents', 'load', 'process',
  'getConfigTreeBuilder', 'buildForm', 'configureOptions', 'getParent', 'supports', 'authenticate',
  'onAuthenticationSuccess', 'onAuthenticationFailure', 'vote', 'supportsNormalization', 'normalize',
  'denormalize', 'supportsDenormalization', 'getFunctions', 'getFilters', 'getTests', 'transform',
  'reverseTransform', 'validate', 'validatedBy', 'getTargets', 'configureRoutes', 'registerBundles',
  'configureContainer', 'getProjectDir', 'getCacheDir', 'getLogDir', 'preUpdate', 'prePersist',
  'postPersist', 'postUpdate', 'preRemove', 'postRemove', 'postLoad',
];

const WORDPRESS_CONVENTIONAL_EXPORTS: string[] = [
  'init', 'activate', 'deactivate', 'uninstall', 'register', 'widget', 'form', 'update',
  'enqueue_scripts', 'admin_menu', 'render_callback', 'register_routes', 'get_items', 'get_item',
  'create_item', 'update_item', 'delete_item', 'permissions_check',
];

/** Pattern-based conventional export rules (Laravel local scopes / accessors / mutators, Livewire hooks). */
const CONVENTIONAL_PATTERNS: RegExp[] = [
  /^scope[A-Z]/,
  /^get[A-Z]\w*Attribute$/,
  /^set[A-Z]\w*Attribute$/,
  /^updated[A-Z]/,
];

const GENERIC_ENTRY_PATTERNS: string[] = [
  'index.php',
  'public/index.php',
  'bin/**/*.php',
  'tests/bootstrap.php',
];

const LARAVEL_ENTRY_PATTERNS: string[] = [
  'routes/**/*.php',
  'config/**/*.php',
  'bootstrap/**/*.php',
  'artisan',
  'database/migrations/**/*.php',
  'database/seeders/**/*.php',
  'database/factories/**/*.php',
  'app/Console/Kernel.php',
  'app/Http/Kernel.php',
  'app/Providers/**',
  'app/Http/Controllers/**',
  'app/Http/Middleware/**',
  'app/Console/Commands/**',
  'app/Jobs/**',
  'app/Listeners/**',
  'app/Events/**',
  'app/Policies/**',
  'app/Observers/**',
  'app/Notifications/**',
  'app/Mail/**',
  'app/Rules/**',
  'app/Exceptions/**',
  'app/View/Components/**',
  'resources/views/**/*.blade.php',
  'app/Livewire/**',
  'app/Http/Livewire/**',
  'app/Nova/**',
  'app/Filament/**',
];

const SYMFONY_ENTRY_PATTERNS: string[] = [
  'public/index.php',
  'bin/console',
  'config/**/*.php',
  'src/Kernel.php',
  'src/Controller/**',
  'src/Command/**',
  'src/EventSubscriber/**',
  'src/EventListener/**',
  'src/MessageHandler/**',
  'src/Security/**',
  'src/Twig/**',
  'src/DataFixtures/**',
  'src/Migrations/**',
  'migrations/**',
];

const WORDPRESS_ENTRY_PATTERNS: string[] = [
  'wp-content/themes/*/functions.php',
  'wp-content/themes/*/*.php',
  'wp-content/mu-plugins/*.php',
];

/**
 * Framework attributes that make the *declaration they sit on* an entry point: the
 * router, console, messenger, event dispatcher or Twig runtime calls it by
 * configuration, never through a call site the analyzer can see. Symfony action
 * names are arbitrary (`list`, `detail`, ...), so no conventional-name list can
 * ever cover them — the attribute is the only reliable signal.
 *
 * Used in two places: file-level Symfony entry detection (below) and member-level
 * `isEntryPointDecorated` in `phpExportCollector`.
 */
export const PHP_FRAMEWORK_ENTRY_ATTRIBUTES: string[] = [
  'Route',
  'AsCommand',
  'AsEventListener',
  'AsMessageHandler',
  'AsController',
  'AsTwigFilter',
  'AsTwigFunction',
];

const SYMFONY_ATTRIBUTE_PATTERN = new RegExp(
  String.raw`#\[\s*(?:[\w\\]+\\)?(${PHP_FRAMEWORK_ENTRY_ATTRIBUTES.join('|')})\b`
);

const WORDPRESS_PLUGIN_HEADER_PATTERN = /^\s*\*?\s*Plugin Name:/m;

const FG_IGNORE = ['**/vendor/**', '**/node_modules/**'];

/**
 * Detects PHP frameworks used by the project (laravel, symfony, wordpress). Multiple
 * frameworks may be returned when the project mixes conventions (e.g. a Laravel package
 * that also ships a WordPress bridge).
 */
export function detectPhpFrameworks(rootDir: string): PhpFrameworkType[] {
  const frameworks: PhpFrameworkType[] = [];

  const composerPath = path.join(rootDir, 'composer.json');
  const composerContent = readSource(composerPath);
  if (composerContent !== null) {
    try {
      const pkg = JSON.parse(composerContent) as {
        require?: Record<string, string>;
        'require-dev'?: Record<string, string>;
      };
      const deps = { ...(pkg.require ?? {}), ...(pkg['require-dev'] ?? {}) };
      if (deps['laravel/framework']) {
        frameworks.push('laravel');
      }
      if (deps['symfony/framework-bundle'] || deps['symfony/symfony']) {
        frameworks.push('symfony');
      }
    } catch {
      // ignore malformed composer.json
    }
  }

  if (isWordPressProject(rootDir, frameworks)) {
    frameworks.push('wordpress');
  }

  return frameworks;
}

function isWordPressProject(rootDir: string, detectedSoFar: PhpFrameworkType[]): boolean {
  if (fs.existsSync(path.join(rootDir, 'wp-config.php'))) {
    return true;
  }
  if (fs.existsSync(path.join(rootDir, 'wp-content'))) {
    return true;
  }
  // A composer.json requiring laravel/framework or symfony/framework-bundle already
  // identifies the project unambiguously; skip the plugin-header fallback scan below
  // so a stray file with a "Plugin Name:"-like comment can't misclassify a Laravel or
  // Symfony project as WordPress.
  if (detectedSoFar.includes('laravel') || detectedSoFar.includes('symfony')) {
    return false;
  }
  // Fallback: a standalone WordPress plugin repository has neither wp-config.php nor
  // a wp-content/ directory (the project itself is the plugin, meant to be dropped
  // into a WordPress install). By convention the plugin header comment lives in the
  // plugin's main file at or near the project root, so only shallow paths are
  // scanned (not the full tree) to keep this cheap and avoid false positives from
  // unrelated deeply-nested files.
  const phpFiles = fg.sync(['*.php', '*/*.php'], {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: FG_IGNORE,
  });
  return phpFiles.some((file) => {
    const content = readSource(file);
    return content !== null && WORDPRESS_PLUGIN_HEADER_PATTERN.test(content);
  });
}

/**
 * Resolves the entry-point files for the given PHP frameworks. Generic entry patterns
 * (index.php, bin/**, tests/bootstrap.php) are always included regardless of framework.
 */
export async function findPhpFrameworkEntryPoints(
  rootDir: string,
  frameworks: PhpFrameworkType[]
): Promise<string[]> {
  const patterns = [...GENERIC_ENTRY_PATTERNS];
  if (frameworks.includes('laravel')) {
    patterns.push(...LARAVEL_ENTRY_PATTERNS);
  }
  if (frameworks.includes('symfony')) {
    patterns.push(...SYMFONY_ENTRY_PATTERNS);
  }
  if (frameworks.includes('wordpress')) {
    patterns.push(...WORDPRESS_ENTRY_PATTERNS);
  }

  const matched = await fg(patterns, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: FG_IGNORE,
  });

  const results = new Set<string>(matched.map((file) => path.normalize(file)));

  if (frameworks.includes('symfony')) {
    for (const file of await findSymfonyAttributeFiles(rootDir)) {
      results.add(path.normalize(file));
    }
  }

  if (frameworks.includes('wordpress')) {
    for (const file of await findWordPressPluginFiles(rootDir)) {
      results.add(path.normalize(file));
    }
  }

  return Array.from(results);
}

async function findSymfonyAttributeFiles(rootDir: string): Promise<string[]> {
  const files = await fg('src/**/*.php', {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: FG_IGNORE,
  });

  return files.filter((file) => {
    const content = readSource(file);
    return content !== null && SYMFONY_ATTRIBUTE_PATTERN.test(content);
  });
}

async function findWordPressPluginFiles(rootDir: string): Promise<string[]> {
  const files = await fg('wp-content/plugins/*/*.php', {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: FG_IGNORE,
  });

  return files.filter((file) => {
    const content = readSource(file);
    return content !== null && WORDPRESS_PLUGIN_HEADER_PATTERN.test(content);
  });
}

/**
 * Returns the conventional (framework-idiomatic) member names for the detected PHP
 * frameworks, merged with the always-applicable PHP magic methods.
 */
export function getPhpConventionalExports(rootDir: string): string[] {
  const frameworks = detectPhpFrameworks(rootDir);
  const exportsSet = new Set<string>(PHP_MAGIC_METHODS);

  if (frameworks.includes('laravel')) {
    for (const name of LARAVEL_CONVENTIONAL_EXPORTS) exportsSet.add(name);
  }
  if (frameworks.includes('symfony')) {
    for (const name of SYMFONY_CONVENTIONAL_EXPORTS) exportsSet.add(name);
  }
  if (frameworks.includes('wordpress')) {
    for (const name of WORDPRESS_CONVENTIONAL_EXPORTS) exportsSet.add(name);
  }

  return Array.from(exportsSet);
}

/**
 * Tests whether a member name matches a conventional pattern rule (Laravel local
 * scopes `scopeXxx`, accessor/mutator `getXxxAttribute`/`setXxxAttribute`, and Livewire
 * lifecycle hooks `updatedXxx`).
 */
export function matchesPhpConventionalPattern(name: string): boolean {
  return CONVENTIONAL_PATTERNS.some((pattern) => pattern.test(name));
}
