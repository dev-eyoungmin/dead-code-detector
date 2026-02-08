import { describe, it, expect } from 'vitest';
import { scanFiles } from '../../../src/scanner/fileScanner';
import * as path from 'path';

const fixtureDir = path.resolve(__dirname, '../../fixtures/simple-project');

describe('fileScanner', () => {
  it('should scan TypeScript files in the fixture project', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['**/*.ts'],
      exclude: ['**/node_modules/**'],
    });
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.some(f => f.includes('index.ts'))).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should respect exclude patterns', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['**/*.ts'],
      exclude: ['**/unused.ts'],
    });
    expect(result.files.some(f => f.includes('unused.ts'))).toBe(false);
  });

  it('should return empty for non-existent patterns', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['**/*.xyz'],
      exclude: [],
    });
    expect(result.files).toEqual([]);
  });

  it('should return absolute paths', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    expect(result.files.length).toBeGreaterThan(0);
    result.files.forEach(file => {
      expect(path.isAbsolute(file)).toBe(true);
    });
  });

  it('should include all expected fixture files', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const fileNames = result.files.map(f => path.basename(f));
    expect(fileNames).toContain('index.ts');
    expect(fileNames).toContain('used.ts');
    expect(fileNames).toContain('unused.ts');
    expect(fileNames).toContain('partiallyUsed.ts');
  });

  it('should measure scan duration', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle multiple include patterns', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts', 'test/**/*.ts'],
      exclude: [],
    });

    expect(result.files.length).toBeGreaterThan(0);
  });

  it('should handle multiple exclude patterns', async () => {
    const result = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: ['**/unused.ts', '**/partiallyUsed.ts'],
    });

    expect(result.files.some(f => f.includes('unused.ts'))).toBe(false);
    expect(result.files.some(f => f.includes('partiallyUsed.ts'))).toBe(false);
    expect(result.files.some(f => f.includes('index.ts'))).toBe(true);
  });
});
