import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { DartAnalyzer } from '../../../../../src/analyzer/languages/dart/dartAnalyzer';

describe('DartAnalyzer', () => {
  const fixtureDir = path.join(__dirname, '../../../../fixtures/dart-project');
  const analyzer = new DartAnalyzer();

  it('should build graph from dart project', () => {
    const files = [
      path.join(fixtureDir, 'lib/main.dart'),
      path.join(fixtureDir, 'lib/app.dart'),
      path.join(fixtureDir, 'lib/src/models/user.dart'),
      path.join(fixtureDir, 'lib/src/widgets/custom_button.dart'),
      path.join(fixtureDir, 'lib/src/utils/helpers.dart'),
    ];

    const graph = analyzer.buildGraph(files, fixtureDir);

    expect(graph.files.size).toBeGreaterThan(0);

    const userFile = graph.files.get(path.join(fixtureDir, 'lib/src/models/user.dart'));
    expect(userFile).toBeDefined();
    expect(userFile!.exports.some(e => e.name === 'User')).toBe(true);
  });

  it('should collect private symbols as locals', () => {
    const files = [
      path.join(fixtureDir, 'lib/src/widgets/custom_button.dart'),
    ];

    const graph = analyzer.buildGraph(files, fixtureDir);
    const buttonFile = graph.files.get(path.join(fixtureDir, 'lib/src/widgets/custom_button.dart'));
    expect(buttonFile).toBeDefined();
    expect(buttonFile!.locals.some(l => l.name === '_ButtonState')).toBe(true);
    expect(buttonFile!.exports.some(e => e.name === 'CustomButton')).toBe(true);
  });

  it('should find Flutter entry points', async () => {
    const entries = await analyzer.findEntryPoints(fixtureDir);
    expect(entries.some(e => e.endsWith('main.dart'))).toBe(true);
  });

  it('should track import edges', () => {
    const files = [
      path.join(fixtureDir, 'lib/main.dart'),
      path.join(fixtureDir, 'lib/app.dart'),
    ];

    const graph = analyzer.buildGraph(files, fixtureDir);

    const mainFile = path.join(fixtureDir, 'lib/main.dart');
    const appFile = path.join(fixtureDir, 'lib/app.dart');

    const outbound = graph.outboundEdges.get(mainFile);
    expect(outbound).toBeDefined();
    expect(outbound!.has(appFile)).toBe(true);
  });
});
