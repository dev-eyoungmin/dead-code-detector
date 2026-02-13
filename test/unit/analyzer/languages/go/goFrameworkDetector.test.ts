import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectGoFramework,
  findGoFrameworkEntryPoints,
  getGoConventionalExports,
} from '../../../../../src/analyzer/languages/go/goFrameworkDetector';

describe('goFrameworkDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-framework-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('detectGoFramework', () => {
    it('should detect Gin from go.mod', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
)
`
      );

      const result = detectGoFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('gin');
    });

    it('should detect Echo from go.mod', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/labstack/echo v4.11.0
)
`
      );

      const result = detectGoFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('echo');
    });

    it('should detect Fiber from go.mod', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/gofiber/fiber v2.50.0
)
`
      );

      const result = detectGoFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('fiber');
    });

    it('should detect Chi from go.mod', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/go-chi/chi v5.0.0
)
`
      );

      const result = detectGoFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('chi');
    });

    it('should return null for plain Go project without web framework', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/stretchr/testify v1.8.4
)
`
      );

      const result = detectGoFramework(tempDir);
      expect(result).toBeNull();
    });

    it('should return null when no go.mod exists', () => {
      const result = detectGoFramework(tempDir);
      expect(result).toBeNull();
    });
  });

  describe('getGoConventionalExports', () => {
    it('should return conventional exports for Gin project', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
)
`
      );

      const exports = getGoConventionalExports(tempDir);
      expect(exports).toContain('Handler');
      expect(exports).toContain('ServeHTTP');
      expect(exports).toContain('MarshalJSON');
      expect(exports).toContain('Scan');
    });

    it('should return empty array when no framework detected', () => {
      const exports = getGoConventionalExports(tempDir);
      expect(exports).toEqual([]);
    });
  });

  describe('findGoFrameworkEntryPoints', () => {
    it('should find handler files as entry points', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        `module example.com/myapp

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
)
`
      );

      fs.writeFileSync(path.join(tempDir, 'main.go'), 'package main');
      const handlersDir = path.join(tempDir, 'handlers');
      fs.mkdirSync(handlersDir, { recursive: true });
      fs.writeFileSync(path.join(handlersDir, 'user.go'), 'package handlers');

      const result = await findGoFrameworkEntryPoints(tempDir);

      expect(result.some(f => f.includes('main.go'))).toBe(true);
      expect(result.some(f => f.includes('user.go'))).toBe(true);
    });

    it('should return empty array when no framework detected', async () => {
      const result = await findGoFrameworkEntryPoints(tempDir);
      expect(result).toEqual([]);
    });
  });
});
