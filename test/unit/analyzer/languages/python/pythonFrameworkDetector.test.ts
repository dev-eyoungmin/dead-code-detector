import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectPythonFramework,
  findPythonFrameworkEntryPoints,
} from '../../../../../src/analyzer/languages/python/pythonFrameworkDetector';

describe('pythonFrameworkDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-framework-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('detectPythonFramework', () => {
    it('should detect Django from requirements.txt', () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'Django==4.2.0\npsycopg2-binary==2.9.9\n'
      );

      const result = detectPythonFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('django');
    });

    it('should detect Django from requirements.txt (lowercase)', () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'django>=4.0\ncelery\n'
      );

      const result = detectPythonFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('django');
    });

    it('should detect Flask from requirements.txt', () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'flask==3.0.0\nflask-cors\n'
      );

      const result = detectPythonFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('flask');
    });

    it('should detect FastAPI from pyproject.toml', () => {
      fs.writeFileSync(
        path.join(tempDir, 'pyproject.toml'),
        `[project]
name = "myapp"
dependencies = [
  "fastapi>=0.100.0",
  "uvicorn",
]`
      );

      const result = detectPythonFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('fastapi');
    });

    it('should detect Django from Pipfile', () => {
      fs.writeFileSync(
        path.join(tempDir, 'Pipfile'),
        `[packages]
django = ">=4.0"
psycopg2 = "*"
`
      );

      const result = detectPythonFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('django');
    });

    it('should detect Django from manage.py fallback', () => {
      fs.writeFileSync(
        path.join(tempDir, 'manage.py'),
        `#!/usr/bin/env python
import os
import sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')
`
      );

      const result = detectPythonFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('django');
    });

    it('should return null for plain Python project', () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'requests==2.31.0\nnumpy\n'
      );

      const result = detectPythonFramework(tempDir);
      expect(result).toBeNull();
    });

    it('should return null when no dependency files exist', () => {
      const result = detectPythonFramework(tempDir);
      expect(result).toBeNull();
    });
  });

  describe('findPythonFrameworkEntryPoints', () => {
    it('should find Django models.py and views.py as entry points', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'django==4.2.0\n'
      );

      const appDir = path.join(tempDir, 'myapp');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'models.py'), 'class User: pass');
      fs.writeFileSync(path.join(appDir, 'views.py'), 'def index(request): pass');

      const result = await findPythonFrameworkEntryPoints(tempDir);

      expect(result.some(f => f.includes('models.py'))).toBe(true);
      expect(result.some(f => f.includes('views.py'))).toBe(true);
    });

    it('should find Django settings.py and urls.py as entry points', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'django==4.2.0\n'
      );

      const configDir = path.join(tempDir, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'settings.py'), 'DEBUG = True');
      fs.writeFileSync(path.join(configDir, 'urls.py'), 'urlpatterns = []');

      const result = await findPythonFrameworkEntryPoints(tempDir);

      expect(result.some(f => f.includes('settings.py'))).toBe(true);
      expect(result.some(f => f.includes('urls.py'))).toBe(true);
    });

    it('should find manage.py as entry point for Django', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'manage.py'),
        '#!/usr/bin/env python\nimport django\n'
      );

      const result = await findPythonFrameworkEntryPoints(tempDir);

      expect(result.some(f => f.includes('manage.py'))).toBe(true);
    });

    it('should find FastAPI router files as entry points', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'fastapi>=0.100.0\n'
      );

      fs.writeFileSync(path.join(tempDir, 'main.py'), 'app = FastAPI()');
      const routersDir = path.join(tempDir, 'routers');
      fs.mkdirSync(routersDir, { recursive: true });
      fs.writeFileSync(path.join(routersDir, 'users.py'), 'router = APIRouter()');

      const result = await findPythonFrameworkEntryPoints(tempDir);

      expect(result.some(f => f.includes('main.py'))).toBe(true);
      expect(result.some(f => f.includes('users.py'))).toBe(true);
    });

    it('should return empty array for plain Python project', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'requests==2.31.0\n'
      );

      const result = await findPythonFrameworkEntryPoints(tempDir);
      expect(result).toEqual([]);
    });

    it('should ignore __pycache__ and venv directories', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'django==4.2.0\n'
      );

      const cacheDir = path.join(tempDir, '__pycache__');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'models.py'), 'cached');

      const venvDir = path.join(tempDir, 'venv', 'lib');
      fs.mkdirSync(venvDir, { recursive: true });
      fs.writeFileSync(path.join(venvDir, 'views.py'), 'venv file');

      const result = await findPythonFrameworkEntryPoints(tempDir);

      expect(result.every(f => !f.includes('__pycache__'))).toBe(true);
      expect(result.every(f => !f.includes('venv'))).toBe(true);
    });
  });
});
