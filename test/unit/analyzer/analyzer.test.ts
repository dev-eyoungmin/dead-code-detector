import { describe, it, expect } from 'vitest';
import { analyze } from '../../../src/analyzer';
import { scanFiles } from '../../../src/scanner/fileScanner';
import * as path from 'path';

const fixtureDir = path.resolve(__dirname, '../../fixtures/simple-project');
const tsconfigPath = path.join(fixtureDir, 'tsconfig.json');

describe('analyzer', () => {
  it('should detect unused.ts as an unused file', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // unused.ts should be detected
    const unusedFilePaths = result.unusedFiles.map(f => f.filePath);
    expect(unusedFilePaths.some(f => f.includes('unused.ts'))).toBe(true);

    // index.ts should NOT be unused (it's an entry point)
    expect(unusedFilePaths.some(f => f.includes('index.ts'))).toBe(false);

    // used.ts should NOT be unused
    expect(unusedFilePaths.some(f => f.includes('used.ts') && !f.includes('unused.ts') && !f.includes('partiallyUsed.ts'))).toBe(false);
  });

  it('should detect unused exports in partiallyUsed.ts', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // unusedExport and ANOTHER_UNUSED should be detected
    const unusedExportNames = result.unusedExports.map(e => e.exportName);
    expect(unusedExportNames).toContain('unusedExport');
    expect(unusedExportNames).toContain('ANOTHER_UNUSED');

    // partiallyUsedFn should NOT be detected (it's imported by index.ts)
    expect(unusedExportNames).not.toContain('partiallyUsedFn');
  });

  it('should return correct statistics', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath,
    });

    expect(result.analyzedFileCount).toBe(scanResult.files.length);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.totalExportCount).toBeGreaterThan(0);
  });

  it('should detect unused exports in unused.ts file', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // All exports from unused.ts should be detected as unused
    const unusedExportsFromUnusedFile = result.unusedExports.filter(
      e => e.filePath.includes('unused.ts')
    );

    const exportNames = unusedExportsFromUnusedFile.map(e => e.exportName);
    expect(exportNames).toContain('unusedFunction');
    expect(exportNames).toContain('UNUSED_CONSTANT');
    expect(exportNames).toContain('UnusedInterface');
  });

  it('should not detect used exports as unused', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // usedFunction and UsedClass should NOT be in unused exports
    const unusedExportNames = result.unusedExports.map(e => e.exportName);
    expect(unusedExportNames).not.toContain('usedFunction');
    expect(unusedExportNames).not.toContain('UsedClass');
  });

  it('should include confidence levels in results', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // Check that confidence levels are present
    if (result.unusedFiles.length > 0) {
      expect(result.unusedFiles[0].confidence).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(result.unusedFiles[0].confidence);
    }

    if (result.unusedExports.length > 0) {
      expect(result.unusedExports[0].confidence).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(result.unusedExports[0].confidence);
    }
  });

  it('should include kind information for exports', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // Find specific unused exports and check their kinds
    const unusedFunctionExport = result.unusedExports.find(
      e => e.exportName === 'unusedFunction'
    );
    if (unusedFunctionExport) {
      expect(unusedFunctionExport.kind).toBe('function');
    }

    const unusedConstantExport = result.unusedExports.find(
      e => e.exportName === 'UNUSED_CONSTANT'
    );
    if (unusedConstantExport) {
      expect(unusedConstantExport.kind).toBe('variable');
    }

    const unusedInterfaceExport = result.unusedExports.find(
      e => e.exportName === 'UnusedInterface'
    );
    if (unusedInterfaceExport) {
      expect(unusedInterfaceExport.kind).toBe('interface');
    }
  });

  it('should include line and column information', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // Check that unused exports have line/column info
    if (result.unusedExports.length > 0) {
      const unusedExport = result.unusedExports[0];
      expect(typeof unusedExport.line).toBe('number');
      expect(typeof unusedExport.column).toBe('number');
      expect(unusedExport.line).toBeGreaterThan(0);
    }

    // Check that unused locals have line/column info
    if (result.unusedLocals.length > 0) {
      const unusedLocal = result.unusedLocals[0];
      expect(typeof unusedLocal.line).toBe('number');
      expect(typeof unusedLocal.column).toBe('number');
      expect(unusedLocal.line).toBeGreaterThan(0);
    }
  });

  it('should calculate total export count correctly', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // Total exports should be at least the number of unused exports
    expect(result.totalExportCount).toBeGreaterThanOrEqual(result.unusedExports.length);
    expect(result.totalExportCount).toBeGreaterThan(0);
  });

  it('should handle projects with no unused code gracefully', async () => {
    // Analyze only index.ts and used.ts (no unused code)
    const files = [
      path.join(fixtureDir, 'src/index.ts'),
      path.join(fixtureDir, 'src/used.ts'),
    ];

    const entryPoint = path.join(fixtureDir, 'src/index.ts');

    const result = await analyze({
      files,
      rootDir: fixtureDir,
      entryPoints: [entryPoint],
      tsconfigPath,
    });

    // Should have minimal or no unused code
    expect(result.unusedFiles.length).toBe(0);
    expect(result.analyzedFileCount).toBe(2);
  });
});
