import { describe, it, expect } from 'vitest';
import { generateReport } from '../../../src/reporter';
import type { AnalysisResult } from '../../../src/types';

const mockResult: AnalysisResult = {
  unusedFiles: [
    { filePath: '/project/src/unused.ts', confidence: 'medium', reason: 'No inbound imports' },
  ],
  unusedExports: [
    { filePath: '/project/src/utils.ts', exportName: 'deadHelper', line: 10, column: 0, confidence: 'medium', kind: 'function' },
  ],
  unusedLocals: [
    { filePath: '/project/src/main.ts', symbolName: 'tempVar', line: 5, column: 2, confidence: 'high', kind: 'variable' },
  ],
  analyzedFileCount: 10,
  totalExportCount: 25,
  totalLocalCount: 40,
  durationMs: 150,
  timestamp: Date.now(),
};

describe('reporter', () => {
  describe('JSON format', () => {
    it('should generate valid JSON', () => {
      const report = generateReport(mockResult, '/project', 'json');
      const parsed = JSON.parse(report);
      expect(parsed.summary.unusedFileCount).toBe(1);
      expect(parsed.summary.unusedExportCount).toBe(1);
      expect(parsed.summary.unusedLocalCount).toBe(1);
      expect(parsed.items).toHaveLength(3);
    });

    it('should include all required fields in JSON output', () => {
      const report = generateReport(mockResult, '/project', 'json');
      const parsed = JSON.parse(report);

      expect(parsed.summary).toBeDefined();
      expect(parsed.summary.analyzedFileCount).toBe(10);
      expect(parsed.summary.totalExportCount).toBe(25);
      expect(parsed.summary.totalLocalCount).toBe(40);
      expect(parsed.summary.durationMs).toBe(150);
      expect(parsed.items).toBeDefined();
    });

    it('should include relative file paths in JSON', () => {
      const report = generateReport(mockResult, '/project', 'json');
      const parsed = JSON.parse(report);

      const unusedFileItem = parsed.items.find((item: any) => item.type === 'file');
      expect(unusedFileItem).toBeDefined();
      expect(unusedFileItem.filePath).toBe('src/unused.ts');
    });

    it('should handle empty results', () => {
      const emptyResult: AnalysisResult = {
        unusedFiles: [],
        unusedExports: [],
        unusedLocals: [],
        analyzedFileCount: 5,
        totalExportCount: 10,
        totalLocalCount: 20,
        durationMs: 100,
        timestamp: Date.now(),
      };

      const report = generateReport(emptyResult, '/project', 'json');
      const parsed = JSON.parse(report);

      expect(parsed.summary.unusedFileCount).toBe(0);
      expect(parsed.summary.unusedExportCount).toBe(0);
      expect(parsed.summary.unusedLocalCount).toBe(0);
      expect(parsed.items).toHaveLength(0);
    });
  });

  describe('HTML format', () => {
    it('should generate HTML with report content', () => {
      const report = generateReport(mockResult, '/project', 'html');
      expect(report).toContain('<!DOCTYPE html>');
      expect(report).toContain('unused.ts');
      expect(report).toContain('deadHelper');
      expect(report).toContain('tempVar');
    });

    it('should include proper HTML structure', () => {
      const report = generateReport(mockResult, '/project', 'html');
      expect(report).toContain('<html');
      expect(report).toContain('<head>');
      expect(report).toContain('<body>');
      expect(report).toContain('</html>');
    });

    it('should include summary statistics', () => {
      const report = generateReport(mockResult, '/project', 'html');
      expect(report).toContain('10'); // analyzed files
      expect(report).toContain('25'); // total exports
      expect(report).toContain('40'); // total locals
    });

    it('should escape HTML special characters', () => {
      const resultWithSpecialChars: AnalysisResult = {
        unusedFiles: [],
        unusedExports: [
          {
            filePath: '/project/src/<script>.ts',
            exportName: 'test&function',
            line: 1,
            column: 0,
            confidence: 'high',
            kind: 'function',
          },
        ],
        unusedLocals: [],
        analyzedFileCount: 1,
        totalExportCount: 1,
        totalLocalCount: 0,
        durationMs: 50,
        timestamp: Date.now(),
      };

      const report = generateReport(resultWithSpecialChars, '/project', 'html');
      // HTML contains <script> tag for functionality, but user content should be escaped
      expect(report).toContain('&lt;script&gt;.ts');
      expect(report).toContain('test&amp;function');
    });
  });

  describe('Markdown format', () => {
    it('should generate markdown with sections', () => {
      const report = generateReport(mockResult, '/project', 'markdown');
      expect(report).toContain('# Dead Code Detection Report');
      expect(report).toContain('## Unused Files');
      expect(report).toContain('## Unused Exports');
      expect(report).toContain('## Unused Locals');
    });

    it('should include summary statistics', () => {
      const report = generateReport(mockResult, '/project', 'markdown');
      expect(report).toContain('Analyzed Files');
      expect(report).toContain('Total Exports');
      expect(report).toContain('Total Locals');
      expect(report).toContain('10'); // analyzed files
      expect(report).toContain('25'); // total exports
      expect(report).toContain('40'); // total locals
    });

    it('should format items with markdown table syntax', () => {
      const report = generateReport(mockResult, '/project', 'markdown');
      expect(report).toContain('|'); // table syntax
      // Only pipe and backtick are escaped in markdown now
      expect(report).toContain('unused.ts');
      expect(report).toContain('deadHelper');
      expect(report).toContain('tempVar');
    });

    it('should include confidence and location information', () => {
      const report = generateReport(mockResult, '/project', 'markdown');
      expect(report).toContain('medium');
      expect(report).toContain('high');
      expect(report).toMatch(/\d+:\d+/); // location format like "10:0"
    });

    it('should handle empty results', () => {
      const emptyResult: AnalysisResult = {
        unusedFiles: [],
        unusedExports: [],
        unusedLocals: [],
        analyzedFileCount: 5,
        totalExportCount: 10,
        totalLocalCount: 20,
        durationMs: 100,
        timestamp: Date.now(),
      };

      const report = generateReport(emptyResult, '/project', 'markdown');
      expect(report).toContain('# Dead Code Detection Report');
      expect(report).toContain('No dead code detected');
    });
  });

  describe('CSV format', () => {
    it('should generate CSV with header and rows', () => {
      const report = generateReport(mockResult, '/project', 'csv');
      const lines = report.split('\n');
      expect(lines[0]).toContain('Type,File,Symbol');
      expect(lines.length).toBeGreaterThan(1); // header + at least 1 row
      // All data fields should be quoted (formula injection prevention)
      expect(lines[1]).toMatch(/^"/);
    });

    it('should include all items in CSV', () => {
      const report = generateReport(mockResult, '/project', 'csv');
      const lines = report.split('\n').filter(line => line.trim().length > 0);

      // Header + 3 data rows (1 file, 1 export, 1 local)
      expect(lines.length).toBe(4);
    });

    it('should properly quote fields with commas', () => {
      const resultWithCommas: AnalysisResult = {
        unusedFiles: [],
        unusedExports: [
          {
            filePath: '/project/src/file,with,commas.ts',
            exportName: 'testFunction',
            line: 1,
            column: 0,
            confidence: 'high',
            kind: 'function',
          },
        ],
        unusedLocals: [],
        analyzedFileCount: 1,
        totalExportCount: 1,
        totalLocalCount: 0,
        durationMs: 50,
        timestamp: Date.now(),
      };

      const report = generateReport(resultWithCommas, '/project', 'csv');
      // CSV escapes fields with commas by wrapping in quotes
      expect(report).toContain('"src/file,with,commas.ts"');
    });

    it('should include confidence and location columns', () => {
      const report = generateReport(mockResult, '/project', 'csv');
      expect(report).toContain('Confidence');
      expect(report).toContain('Line');
      expect(report).toContain('Column');
      // Values are now always quoted
      expect(report).toContain('"medium"');
      expect(report).toContain('"high"');
    });

    it('should handle empty results', () => {
      const emptyResult: AnalysisResult = {
        unusedFiles: [],
        unusedExports: [],
        unusedLocals: [],
        analyzedFileCount: 5,
        totalExportCount: 10,
        totalLocalCount: 20,
        durationMs: 100,
        timestamp: Date.now(),
      };

      const report = generateReport(emptyResult, '/project', 'csv');
      const lines = report.split('\n').filter(line => line.trim().length > 0);

      // Only header row
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('Type,File');
    });
  });

  describe('Report format validation', () => {
    it('should handle all supported formats', () => {
      const formats: Array<'html' | 'json' | 'markdown' | 'csv'> = ['html', 'json', 'markdown', 'csv'];

      formats.forEach(format => {
        const report = generateReport(mockResult, '/project', format);
        expect(report).toBeTruthy();
        expect(typeof report).toBe('string');
        expect(report.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Relative path handling', () => {
    it('should convert absolute paths to relative in all formats', () => {
      const jsonReport = generateReport(mockResult, '/project', 'json');
      expect(jsonReport).toContain('src/unused.ts');
      expect(jsonReport).not.toContain('/project/src/unused.ts');

      const htmlReport = generateReport(mockResult, '/project', 'html');
      expect(htmlReport).toContain('src/unused.ts');

      const mdReport = generateReport(mockResult, '/project', 'markdown');
      // Only pipe and backtick are escaped in markdown
      expect(mdReport).toContain('src/unused.ts');

      const csvReport = generateReport(mockResult, '/project', 'csv');
      expect(csvReport).toContain('src/unused.ts');
    });
  });
});
