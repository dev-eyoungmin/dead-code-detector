import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findToolingEntryPoints, findFrameworkEntryPoints } from '../../../src/analyzer/frameworkDetector';

describe('tooling entry points', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-points-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should recognize jest.config.js as entry point', async () => {
    fs.writeFileSync(path.join(tempDir, 'jest.config.js'), 'module.exports = {};');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('jest.config.js'))).toBe(true);
  });

  it('should recognize vitest.config.ts as entry point', async () => {
    fs.writeFileSync(path.join(tempDir, 'vitest.config.ts'), 'export default {};');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('vitest.config.ts'))).toBe(true);
  });

  it('should recognize jest.setup.ts as entry point', async () => {
    fs.writeFileSync(path.join(tempDir, 'jest.setup.ts'), '// setup');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('jest.setup.ts'))).toBe(true);
  });

  it('should not include regular source files', async () => {
    fs.writeFileSync(path.join(tempDir, 'main.ts'), 'console.log("hi");');
    const entries = await findToolingEntryPoints(tempDir);
    expect(entries.some(e => e.endsWith('main.ts'))).toBe(false);
  });
});

describe('expo entry points expanded', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-entry-test-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { expo: '~49.0.0' },
    }));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should recognize modules/*/index.ts as entry points', async () => {
    const moduleDir = path.join(tempDir, 'modules', 'expo-app-lifecycle');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'index.ts'), 'export default {};');

    const entries = await findFrameworkEntryPoints(tempDir);
    expect(entries.some(e => e.includes('modules/expo-app-lifecycle/index.ts'))).toBe(true);
  });
});
