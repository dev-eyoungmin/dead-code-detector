import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectUnusedLocals } from '../../../src/analyzer/unusedLocalDetector';
import type { DependencyGraph } from '../../../src/types';

function createGraphWithLocal(
  filePath: string,
  local: { name: string; line: number; column: number; kind: string; references: number }
): DependencyGraph {
  return {
    files: new Map([
      [
        filePath,
        {
          filePath,
          imports: [],
          exports: [],
          locals: [local],
        },
      ],
    ]),
    exportUsages: new Map(),
  } as unknown as DependencyGraph;
}

describe('unusedLocalDetector - confidence levels', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-local-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign medium confidence to setCount in .tsx files', () => {
    const tsxFile = path.join(tempDir, 'Counter.tsx');
    fs.writeFileSync(tsxFile, 'const [count, setCount] = useState(0);');

    const graph = createGraphWithLocal(tsxFile, {
      name: 'setCount',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign medium confidence to dispatch in .tsx files', () => {
    const tsxFile = path.join(tempDir, 'App.tsx');
    fs.writeFileSync(tsxFile, 'const dispatch = useDispatch();');

    const graph = createGraphWithLocal(tsxFile, {
      name: 'dispatch',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign high confidence to regular unused variable in .ts files', () => {
    const tsFile = path.join(tempDir, 'utils.ts');
    fs.writeFileSync(tsFile, 'const unused = 42;');

    const graph = createGraphWithLocal(tsFile, {
      name: 'unused',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('high');
  });

  it('should assign medium confidence to setState in .jsx files', () => {
    const jsxFile = path.join(tempDir, 'Form.jsx');
    fs.writeFileSync(jsxFile, 'const [state, setState] = useState({});');

    const graph = createGraphWithLocal(jsxFile, {
      name: 'setState',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign high confidence to dispatch in .ts files (not React)', () => {
    const tsFile = path.join(tempDir, 'store.ts');
    fs.writeFileSync(tsFile, 'const dispatch = store.dispatch;');

    const graph = createGraphWithLocal(tsFile, {
      name: 'dispatch',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('high');
  });

  it('should assign low confidence to serialVersionUID in .java files', () => {
    const javaFile = path.join(tempDir, 'User.java');
    fs.writeFileSync(javaFile, 'private static final long serialVersionUID = 1L;');

    const graph = createGraphWithLocal(javaFile, {
      name: 'serialVersionUID',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('low');
  });

  it('should assign medium confidence to logger in .java files', () => {
    const javaFile = path.join(tempDir, 'Service.java');
    fs.writeFileSync(javaFile, 'private static final Logger logger = LoggerFactory.getLogger(Service.class);');

    const graph = createGraphWithLocal(javaFile, {
      name: 'logger',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });

  it('should assign medium confidence to LOG in .java files', () => {
    const javaFile = path.join(tempDir, 'Controller.java');
    fs.writeFileSync(javaFile, 'private static final Logger LOG = LoggerFactory.getLogger(Controller.class);');

    const graph = createGraphWithLocal(javaFile, {
      name: 'LOG',
      line: 1,
      column: 0,
      kind: 'variable',
      references: 0,
    });

    const results = detectUnusedLocals(graph);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('medium');
  });
});
