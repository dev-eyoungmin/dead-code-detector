import fg from 'fast-glob';
import * as path from 'path';

export interface ScanOptions {
  rootDir: string;
  include: string[];
  exclude: string[];
}

export interface ScanResult {
  files: string[];
  durationMs: number;
}

export async function scanFiles(options: ScanOptions): Promise<ScanResult> {
  const start = Date.now();
  const { rootDir, include, exclude } = options;

  const files = await fg(include, {
    cwd: rootDir,
    absolute: true,
    ignore: exclude,
    onlyFiles: true,
    followSymbolicLinks: false,
    dot: false,
  });

  // Normalize paths
  const normalizedFiles = files.map(f => path.normalize(f));

  return {
    files: normalizedFiles,
    durationMs: Date.now() - start,
  };
}
