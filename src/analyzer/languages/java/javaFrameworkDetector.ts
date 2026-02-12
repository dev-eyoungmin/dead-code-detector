import * as path from 'path';
import * as fs from 'fs';
import { detectSourceRoots } from './javaModuleResolver';

export type JavaFrameworkType = 'spring' | 'android' | null;

export interface JavaFrameworkInfo {
  type: JavaFrameworkType;
}

/** Annotations that mark a Spring entry point class */
const SPRING_ENTRY_ANNOTATIONS = [
  '@SpringBootApplication',
  '@Configuration',
  '@Component',
  '@Service',
  '@Repository',
  '@Controller',
  '@RestController',
  '@Entity',
  '@ControllerAdvice',
  '@RestControllerAdvice',
];

/** Base classes that mark an Android component */
const ANDROID_BASE_CLASSES = [
  'Activity',
  'AppCompatActivity',
  'FragmentActivity',
  'Fragment',
  'Service',
  'IntentService',
  'BroadcastReceiver',
  'ContentProvider',
  'Application',
  'ViewModel',
  'AndroidViewModel',
];

/**
 * Detects whether a Java project uses Spring Boot or Android
 */
export function detectJavaFramework(rootDir: string): JavaFrameworkInfo | null {
  // Check pom.xml for Spring Boot
  const pomPath = path.join(rootDir, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    try {
      const content = fs.readFileSync(pomPath, 'utf-8');
      if (content.includes('spring-boot-starter')) {
        return { type: 'spring' };
      }
      if (content.includes('com.android')) {
        return { type: 'android' };
      }
    } catch {
      // ignore read errors
    }
  }

  // Check build.gradle / build.gradle.kts
  for (const gradleFile of ['build.gradle', 'build.gradle.kts']) {
    const gradlePath = path.join(rootDir, gradleFile);
    if (fs.existsSync(gradlePath)) {
      try {
        const content = fs.readFileSync(gradlePath, 'utf-8');
        if (content.includes('org.springframework.boot')) {
          return { type: 'spring' };
        }
        if (content.includes('com.android.application') || content.includes('com.android.library')) {
          return { type: 'android' };
        }
      } catch {
        // ignore read errors
      }
    }
  }

  // Check AndroidManifest.xml (nested search)
  const manifestPath = path.join(rootDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  const rootManifest = path.join(rootDir, 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath) || fs.existsSync(rootManifest)) {
    return { type: 'android' };
  }

  return null;
}

/**
 * Finds files containing Spring annotations, treating them as entry points
 */
export function findSpringAnnotatedFiles(rootDir: string): string[] {
  const sourceRoots = detectSourceRoots(rootDir);
  const results: string[] = [];

  for (const sourceRoot of sourceRoots) {
    scanForAnnotations(sourceRoot, results);
  }

  return results;
}

function scanForAnnotations(dir: string, results: string[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanForAnnotations(fullPath, results);
      } else if (entry.name.endsWith('.java')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (SPRING_ENTRY_ANNOTATIONS.some((ann) => content.includes(ann))) {
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
}

/**
 * Finds Android component files by checking for extends patterns
 */
export function findAndroidComponentFiles(rootDir: string): string[] {
  const sourceRoots = detectSourceRoots(rootDir);
  const results: string[] = [];

  // Build a regex pattern for matching extends
  const classPattern = new RegExp(
    `extends\\s+(?:${ANDROID_BASE_CLASSES.join('|')})\\b`
  );

  for (const sourceRoot of sourceRoots) {
    scanForPattern(sourceRoot, classPattern, results);
  }

  return results;
}

function scanForPattern(dir: string, pattern: RegExp, results: string[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanForPattern(fullPath, pattern, results);
      } else if (entry.name.endsWith('.java')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (pattern.test(content)) {
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
}
