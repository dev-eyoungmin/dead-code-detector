import { describe, it, expect } from 'vitest';
import { parseExportKey, makeExportKey } from '../../../src/analyzer/dependencyGraph';

describe('dependencyGraph utilities', () => {
  describe('makeExportKey', () => {
    it('should create a key with :: separator', () => {
      const key = makeExportKey('/src/file.ts', 'myExport');
      expect(key).toBe('/src/file.ts::myExport');
    });

    it('should handle empty export name', () => {
      const key = makeExportKey('/src/file.ts', '');
      expect(key).toBe('/src/file.ts::');
    });
  });

  describe('parseExportKey', () => {
    it('should parse a valid export key', () => {
      const result = parseExportKey('/src/file.ts::myExport');
      expect(result.filePath).toBe('/src/file.ts');
      expect(result.exportName).toBe('myExport');
    });

    it('should handle export names containing colons', () => {
      const result = parseExportKey('/src/file.ts::some::value');
      expect(result.filePath).toBe('/src/file.ts::some');
      expect(result.exportName).toBe('value');
    });

    it('should throw on invalid key without :: separator', () => {
      expect(() => parseExportKey('invalidkey')).toThrow(
        'Invalid export key format'
      );
    });

    it('should throw on empty string', () => {
      expect(() => parseExportKey('')).toThrow('Invalid export key format');
    });

    it('should roundtrip with makeExportKey', () => {
      const filePath = '/project/src/utils.ts';
      const exportName = 'helperFn';
      const key = makeExportKey(filePath, exportName);
      const parsed = parseExportKey(key);
      expect(parsed.filePath).toBe(filePath);
      expect(parsed.exportName).toBe(exportName);
    });
  });
});
