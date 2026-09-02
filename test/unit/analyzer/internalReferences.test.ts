import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { analyze } from '../../../src/analyzer';

describe('internal reference tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-ref-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should not report type used as field type in same-file exported type', async () => {
    fs.writeFileSync(path.join(tempDir, 'dto.ts'), `
export type BodyCompositionDTO = {
  weight_kg: number;
  body_fat_pct?: number;
};

export type DailyBodyCompositionDTO = {
  record_date: string;
  body_composition?: BodyCompositionDTO;
};
`);
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { DailyBodyCompositionDTO } from './dto';
const x: DailyBodyCompositionDTO = { record_date: '2024-01-01' };
`);

    const result = await analyze({
      files: [path.join(tempDir, 'dto.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('BodyCompositionDTO');
  });

  it('should not report function param type used in same-file exported function', async () => {
    fs.writeFileSync(path.join(tempDir, 'dto.ts'), `
export type InputDTO = { value: number };
export function processInput(dto: InputDTO): number {
  return dto.value * 2;
}
`);
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { processInput } from './dto';
processInput({ value: 42 });
`);

    const result = await analyze({
      files: [path.join(tempDir, 'dto.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('InputDTO');
  });

  it('should still report truly unused exports', async () => {
    fs.writeFileSync(path.join(tempDir, 'dto.ts'), `
export type UsedType = { value: number };
export type TrulyUnusedType = { id: string };
export function usedFn(): UsedType { return { value: 1 }; }
`);
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { usedFn } from './dto';
usedFn();
`);

    const result = await analyze({
      files: [path.join(tempDir, 'dto.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('UsedType');
    expect(unusedNames).toContain('TrulyUnusedType');
  });

  it('should not report interface used as return type in same-file exported function', async () => {
    fs.writeFileSync(path.join(tempDir, 'types.ts'), `
export interface Result {
  success: boolean;
  message: string;
}

export function getResult(): Result {
  return { success: true, message: 'ok' };
}
`);
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { getResult } from './types';
const r = getResult();
`);

    const result = await analyze({
      files: [path.join(tempDir, 'types.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('Result');
  });

  it('should not report class used as type in same-file exported function', async () => {
    fs.writeFileSync(path.join(tempDir, 'service.ts'), `
export class Config {
  host: string = 'localhost';
  port: number = 3000;
}

export function createService(config: Config): void {
  console.log(config.host);
}
`);
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { createService } from './service';
createService({ host: 'localhost', port: 3000 } as any);
`);

    const result = await analyze({
      files: [path.join(tempDir, 'service.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('Config');
  });

  it('should handle enum used in same-file exported function', async () => {
    fs.writeFileSync(path.join(tempDir, 'enums.ts'), `
export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}

export function isActive(status: Status): boolean {
  return status === Status.Active;
}
`);
    fs.writeFileSync(path.join(tempDir, 'consumer.ts'), `
import { isActive } from './enums';
isActive('active' as any);
`);

    const result = await analyze({
      files: [path.join(tempDir, 'enums.ts'), path.join(tempDir, 'consumer.ts')],
      rootDir: tempDir,
      entryPoints: [],
    });

    const unusedNames = result.unusedExports.map(e => e.exportName);
    expect(unusedNames).not.toContain('Status');
  });
});
