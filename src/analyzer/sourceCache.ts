import * as fs from 'fs';

const cache = new Map<string, string | null>();

/**
 * Reads a source file once per analysis run. Returns null when the file
 * cannot be read. Call clearSourceCache() at the start of every analysis.
 */
export function readSource(filePath: string): string | null {
  if (cache.has(filePath)) {
    return cache.get(filePath)!;
  }
  let content: string | null;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    content = null;
  }
  cache.set(filePath, content);
  return content;
}

/**
 * Clears the memoised source contents.
 */
export function clearSourceCache(): void {
  cache.clear();
}
