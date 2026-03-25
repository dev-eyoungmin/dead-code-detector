/**
 * Central Decorator Rule Registry for DI framework detection.
 *
 * Tracks decorator/annotation names used by popular DI frameworks across
 * TypeScript, Python, Java, and Dart so that decorated classes are not
 * falsely reported as dead code.
 */

export interface DecoratorRule {
  /** Decorator/annotation name (without @) */
  name: string;
  /** Framework or library the decorator belongs to */
  framework: string;
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript built-in DI decorators
// ---------------------------------------------------------------------------

export const TS_DI_DECORATORS: DecoratorRule[] = [
  // inversify
  { name: 'injectable', framework: 'inversify' },
  { name: 'singleton', framework: 'inversify' },
  { name: 'multiInject', framework: 'inversify' },
  // tsyringe
  { name: 'autoInjectable', framework: 'tsyringe' },
  { name: 'scoped', framework: 'tsyringe' },
  // typedi
  { name: 'Service', framework: 'typedi' },
  // NestJS / Angular
  { name: 'Injectable', framework: 'nestjs/angular' },
  { name: 'Controller', framework: 'nestjs' },
  { name: 'Resolver', framework: 'nestjs' },
  { name: 'Guard', framework: 'nestjs' },
  { name: 'Interceptor', framework: 'nestjs' },
  { name: 'Middleware', framework: 'nestjs' },
  { name: 'Pipe', framework: 'nestjs/angular' },
  { name: 'Module', framework: 'nestjs' },
  { name: 'Component', framework: 'angular' },
  { name: 'Directive', framework: 'angular' },
  { name: 'NgModule', framework: 'angular' },
  // typeorm / mikro-orm / prisma
  { name: 'Entity', framework: 'typeorm' },
  { name: 'Repository', framework: 'typeorm' },
  // awilix / other
  { name: 'Provide', framework: 'awilix' },
];

/** Set of built-in TS DI decorator names for fast lookup */
const TS_DI_DECORATOR_NAMES = new Set(TS_DI_DECORATORS.map((r) => r.name));

// ---------------------------------------------------------------------------
// Python built-in DI annotation patterns (matched with regex)
// ---------------------------------------------------------------------------

export const PYTHON_DI_ANNOTATION_PATTERNS: string[] = [
  'inject',
  'inject\\.autoparams',
  'provider',
  'injectable',
  'singleton',
  'component',
  'service',
  'repository',
];

// ---------------------------------------------------------------------------
// Java built-in DI annotation names
// ---------------------------------------------------------------------------

export const JAVA_DI_ANNOTATIONS: string[] = [
  'Inject',
  'Provides',
  'Singleton',
  'Component',
  'Service',
  'Repository',
  'Controller',
  'RestController',
  'Bean',
  'Autowired',
  'Module',
  'Binds',
  // Dagger
  'Subcomponent',
  'BindsInstance',
  // Guice
  'ProvidedBy',
  'ImplementedBy',
];

// ---------------------------------------------------------------------------
// Dart built-in DI annotation names
// ---------------------------------------------------------------------------

export const DART_DI_ANNOTATIONS: string[] = [
  'injectable',
  'lazySingleton',
  'singleton',
  'module',
  'Injectable',
  'LazySingleton',
  'Singleton',
  'factoryMethod',
  'FactoryMethod',
  'preResolve',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the given TypeScript decorator name is a known DI entry-point
 * decorator OR is included in the user-configured list.
 */
export function isEntryPointDecorator(
  decoratorName: string,
  userConfiguredDecorators: string[] = []
): boolean {
  return (
    TS_DI_DECORATOR_NAMES.has(decoratorName) ||
    userConfiguredDecorators.includes(decoratorName)
  );
}

/**
 * Returns true when the given Python annotation name matches a known DI pattern
 * OR is included in the user-configured list.
 */
export function isPythonDIAnnotation(
  annotationName: string,
  userConfiguredDecorators: string[] = []
): boolean {
  const builtInMatch = PYTHON_DI_ANNOTATION_PATTERNS.some((p) =>
    new RegExp(`^${p}$`, 'i').test(annotationName)
  );
  return builtInMatch || userConfiguredDecorators.includes(annotationName);
}

/**
 * Returns true when the given Java annotation name is a known DI annotation
 * OR is included in the user-configured list.
 */
export function isJavaDIAnnotation(
  annotationName: string,
  userConfiguredDecorators: string[] = []
): boolean {
  return (
    JAVA_DI_ANNOTATIONS.includes(annotationName) ||
    userConfiguredDecorators.includes(annotationName)
  );
}

/**
 * Returns true when the given Dart annotation name is a known DI annotation
 * OR is included in the user-configured list.
 */
export function isDartDIAnnotation(
  annotationName: string,
  userConfiguredDecorators: string[] = []
): boolean {
  return (
    DART_DI_ANNOTATIONS.includes(annotationName) ||
    userConfiguredDecorators.includes(annotationName)
  );
}
