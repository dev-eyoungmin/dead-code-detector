import type { DependencyGraph } from '../types';
import { edgeKey } from './graphBuilder';

export interface ReachabilityOptions {
  /**
   * Edges that must not be traversed, keyed by `edgeKey(from, to)`. Used to
   * drop edges whose only justification is a dead named re-export.
   */
  suppressedEdges?: Set<string>;
}

/**
 * Computes the set of files transitively reachable from the given entry points
 * by following outbound (import) edges.
 *
 * Files outside the returned set form "dead clusters": they may still have
 * inbound edges (they import each other), but nothing the project actually
 * runs can reach them.
 */
export function computeReachable(
  graph: DependencyGraph,
  entryPoints: string[],
  options: ReachabilityOptions = {}
): Set<string> {
  const suppressed = options.suppressedEdges;
  const reachable = new Set<string>();
  const stack = entryPoints.filter((entry) => graph.files.has(entry));

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    for (const next of graph.outboundEdges.get(current) ?? []) {
      if (suppressed?.has(edgeKey(current, next))) {
        continue;
      }
      if (!reachable.has(next)) {
        stack.push(next);
      }
    }
  }

  return reachable;
}
