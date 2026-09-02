import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readSource, clearSourceCache } from '../../../src/analyzer/sourceCache';

describe('sourceCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
    clearSourceCache();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a file and memoises it until cleared', () => {
    const f = path.join(dir, 'a.ts');
    fs.writeFileSync(f, 'one');
    expect(readSource(f)).toBe('one');
    fs.writeFileSync(f, 'two');
    expect(readSource(f)).toBe('one');
    clearSourceCache();
    expect(readSource(f)).toBe('two');
  });

  it('returns null for missing files', () => {
    expect(readSource(path.join(dir, 'missing.ts'))).toBeNull();
  });
});
