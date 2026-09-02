import { describe, it, expect } from 'vitest';
import { detectLanguage, isTypeScriptFamily } from '../../../../src/analyzer/languages';

describe('language registry', () => {
  it.each(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.vue', '.svelte'])(
    'maps %s to typescript',
    (ext) => {
      expect(detectLanguage(`/p/file${ext}`)).toBe('typescript');
      expect(isTypeScriptFamily(`/p/file${ext}`)).toBe(true);
    }
  );

  it('maps .php to php', () => {
    expect(detectLanguage('/p/a.php')).toBe('php');
    expect(isTypeScriptFamily('/p/a.php')).toBe(false);
  });

  it('maps the other languages unchanged', () => {
    expect(detectLanguage('/p/a.py')).toBe('python');
    expect(detectLanguage('/p/a.go')).toBe('go');
    expect(detectLanguage('/p/a.java')).toBe('java');
    expect(detectLanguage('/p/a.dart')).toBe('dart');
    expect(detectLanguage('/p/a.txt')).toBeUndefined();
  });
});
