import type { Analysis, Entity } from './types';

export function entityTourSlice(analysis: Analysis, ordered: Entity[], step: number) {
  const current = ordered[step] || null;
  if (!current) return { current, neighbors: [] as Entity[], all: [] as Entity[], connectionCount: 0 };
  const scores = new Map<string, number>();
  let connectionCount = 0;
  for (const link of analysis.dependencies) {
    if (link.source !== current.id && link.target !== current.id) continue;
    connectionCount++;
    const other = link.source === current.id ? link.target : link.source;
    if (other === current.id) continue;
    scores.set(other, (scores.get(other) || 0) + (link.type === 'id' ? 4 : link.type === 'operation' ? 3 : 1));
  }
  const rank = new Map(ordered.map((entity, index) => [entity.id, index]));
  const neighbors = ordered.filter(entity => scores.has(entity.id))
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || rank.get(a.id)! - rank.get(b.id)!)
    .slice(0, 12);
  return { current, neighbors, all: [current, ...neighbors], connectionCount };
}
