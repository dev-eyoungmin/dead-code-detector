import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { analyze } from '../../../src/analyzer';

describe('property access confidence downgrade', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-access-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign low confidence when named export is in default object', async () => {
    fs.writeFileSync(path.join(tempDir, 'typo.ts'), `
export const mediumRegular = { fontSize: 14 };
export const largeBold = { fontSize: 18 };
export default { mediumRegular, largeBold };
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import KpdsTypo from './typo';
const style = KpdsTypo.mediumRegular;
`);

    const result = await analyze({
      files: [path.join(tempDir, 'typo.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const mediumRegular = result.unusedExports.find(e => e.exportName === 'mediumRegular');
    if (mediumRegular) {
      expect(mediumRegular.confidence).toBe('low');
    }
  });

  it('should not downgrade named export not in default object', async () => {
    fs.writeFileSync(path.join(tempDir, 'module.ts'), `
export const helper = 42;
export const unused = 99;
export default { helper };
`);

    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import mod from './module';
console.log(mod.helper);
`);

    const result = await analyze({
      files: [path.join(tempDir, 'module.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unused = result.unusedExports.find(e => e.exportName === 'unused');
    if (unused) {
      expect(unused.confidence).not.toBe('low');
    }
  });
});
