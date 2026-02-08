import { describe, it, expect } from 'vitest';
import { scanFiles } from '../../src/scanner/fileScanner';
import { analyze } from '../../src/analyzer';
import { generateReport } from '../../src/reporter';
import * as path from 'path';

const fixtureDir = path.resolve(__dirname, '../fixtures/simple-project');

describe('Full Pipeline Integration', () => {
  it('should scan, analyze, and generate report successfully', async () => {
    // Step 1: Scan
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    expect(scanResult.files.length).toBeGreaterThan(0);

    // Step 2: Analyze
    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });
    expect(result.analyzedFileCount).toBeGreaterThan(0);

    // Step 3: Generate reports in all formats
    const jsonReport = generateReport(result, fixtureDir, 'json');
    expect(JSON.parse(jsonReport)).toBeDefined();

    const htmlReport = generateReport(result, fixtureDir, 'html');
    expect(htmlReport).toContain('<!DOCTYPE html>');

    const mdReport = generateReport(result, fixtureDir, 'markdown');
    expect(mdReport).toContain('# Dead Code');

    const csvReport = generateReport(result, fixtureDir, 'csv');
    expect(csvReport).toContain('Type,File');
  });

  it('should detect all types of dead code in fixture project', async () => {
    // Scan files
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    // Analyze
    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Verify unused files detected
    expect(result.unusedFiles.length).toBeGreaterThan(0);
    const unusedFilePaths = result.unusedFiles.map(f => path.basename(f.filePath));
    expect(unusedFilePaths).toContain('unused.ts');

    // Verify unused exports detected
    expect(result.unusedExports.length).toBeGreaterThan(0);
    const unusedExportNames = result.unusedExports.map(e => e.exportName);
    expect(unusedExportNames).toContain('unusedExport');
    expect(unusedExportNames).toContain('ANOTHER_UNUSED');
  });

  it('should generate consistent results across multiple runs', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    // First run
    const result1 = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Second run
    const result2 = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Results should be consistent
    expect(result1.unusedFiles.length).toBe(result2.unusedFiles.length);
    expect(result1.unusedExports.length).toBe(result2.unusedExports.length);
    expect(result1.analyzedFileCount).toBe(result2.analyzedFileCount);
  });

  it('should complete pipeline within reasonable time', async () => {
    const startTime = Date.now();

    // Full pipeline
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    const jsonReport = generateReport(result, fixtureDir, 'json');
    const htmlReport = generateReport(result, fixtureDir, 'html');
    const mdReport = generateReport(result, fixtureDir, 'markdown');
    const csvReport = generateReport(result, fixtureDir, 'csv');

    const totalTime = Date.now() - startTime;

    // Full pipeline should complete in reasonable time (less than 10 seconds)
    expect(totalTime).toBeLessThan(10000);

    // All reports should be generated
    expect(jsonReport.length).toBeGreaterThan(0);
    expect(htmlReport.length).toBeGreaterThan(0);
    expect(mdReport.length).toBeGreaterThan(0);
    expect(csvReport.length).toBeGreaterThan(0);
  });

  it('should handle different exclude patterns correctly', async () => {
    // Scan with exclude pattern
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: ['**/unused.ts'],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // unused.ts should not be in the analysis
    const analyzedFiles = scanResult.files.map(f => path.basename(f));
    expect(analyzedFiles).not.toContain('unused.ts');

    // Generate report
    const report = generateReport(result, fixtureDir, 'json');
    const parsed = JSON.parse(report);

    // Report should not mention unused.ts as a file item (it wasn't analyzed)
    const fileItems = parsed.items.filter((item: any) => item.type === 'file');
    expect(fileItems.every((item: any) => !item.filePath.includes('unused.ts'))).toBe(true);
  });

  it('should preserve all analysis metadata through the pipeline', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Verify analysis result has all metadata
    expect(result.analyzedFileCount).toBe(scanResult.files.length);
    expect(result.totalExportCount).toBeGreaterThan(0);
    expect(result.totalLocalCount).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeGreaterThan(0);

    // Generate JSON report and verify metadata is preserved
    const jsonReport = generateReport(result, fixtureDir, 'json');
    const parsed = JSON.parse(jsonReport);

    expect(parsed.summary.analyzedFileCount).toBe(result.analyzedFileCount);
    expect(parsed.summary.totalExportCount).toBe(result.totalExportCount);
    expect(parsed.summary.totalLocalCount).toBe(result.totalLocalCount);
    expect(parsed.summary.durationMs).toBe(result.durationMs);
  });

  it('should generate valid report content for all formats', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // JSON - should be parseable
    const jsonReport = generateReport(result, fixtureDir, 'json');
    expect(() => JSON.parse(jsonReport)).not.toThrow();

    // HTML - should have valid structure
    const htmlReport = generateReport(result, fixtureDir, 'html');
    expect(htmlReport).toContain('<!DOCTYPE html>');
    expect(htmlReport).toContain('<html');
    expect(htmlReport).toContain('</html>');

    // Markdown - should have headers
    const mdReport = generateReport(result, fixtureDir, 'markdown');
    expect(mdReport).toMatch(/^#\s+/m);

    // CSV - should have comma-separated values
    const csvReport = generateReport(result, fixtureDir, 'csv');
    const lines = csvReport.split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain(',');
  });

  it('should handle analysis with multiple entry points', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    // Use both index.ts and partiallyUsed.ts as entry points
    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [
        path.join(fixtureDir, 'src/index.ts'),
        path.join(fixtureDir, 'src/partiallyUsed.ts'),
      ],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Entry points should not be marked as unused
    const unusedFilePaths = result.unusedFiles.map(f => f.filePath);
    expect(unusedFilePaths.every(p => !p.includes('index.ts'))).toBe(true);
    expect(unusedFilePaths.every(p => !p.includes('partiallyUsed.ts'))).toBe(true);

    // Generate report
    const report = generateReport(result, fixtureDir, 'json');
    const parsed = JSON.parse(report);
    expect(parsed.summary).toBeDefined();
  });

  it('should detect different export kinds correctly', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Check that different kinds are detected
    const exportKinds = result.unusedExports.map(e => e.kind);

    // Should have function exports
    expect(exportKinds).toContain('function');

    // Should have variable exports
    expect(exportKinds).toContain('variable');

    // Should have interface exports
    expect(exportKinds).toContain('interface');
  });

  it('should provide accurate statistics across pipeline', async () => {
    const scanResult = await scanFiles({
      rootDir: fixtureDir,
      include: ['src/**/*.ts'],
      exclude: [],
    });

    const result = await analyze({
      files: scanResult.files,
      rootDir: fixtureDir,
      entryPoints: [path.join(fixtureDir, 'src/index.ts')],
      tsconfigPath: path.join(fixtureDir, 'tsconfig.json'),
    });

    // Verify scan statistics
    expect(scanResult.files.length).toBeGreaterThanOrEqual(4); // at least index, used, unused, partiallyUsed
    expect(scanResult.durationMs).toBeGreaterThanOrEqual(0);

    // Verify analysis statistics
    expect(result.analyzedFileCount).toBe(scanResult.files.length);
    expect(result.totalExportCount).toBeGreaterThanOrEqual(result.unusedExports.length);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify report includes statistics
    const jsonReport = generateReport(result, fixtureDir, 'json');
    const parsed = JSON.parse(jsonReport);

    expect(parsed.summary.unusedFileCount).toBe(result.unusedFiles.length);
    expect(parsed.summary.unusedExportCount).toBe(result.unusedExports.length);
    expect(parsed.summary.unusedLocalCount).toBe(result.unusedLocals.length);
  });
});
