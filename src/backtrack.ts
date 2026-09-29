import type { Analysis, Dependency, Entity } from './types';

export interface BacktrackGroup { distance: number; entities: Entity[] }
export interface BacktrackResult { target: Entity | null; groups: BacktrackGroup[]; entities: Entity[]; links: Dependency[]; truncated: boolean }

export type TraceDirection = 'prerequisites' | 'dependents';

export function traceConnections(analysis: Analysis, targetId: string, direction: TraceDirection, maxDepth = Infinity, limit = analysis.entities.length): BacktrackResult {
  const byId = new Map(analysis.entities.map(entity => [entity.id, entity]));
  const target = byId.get(targetId) || null;
  if (!target) return { target: null, groups: [], entities: [], links: [], truncated: false };
  const adjacent = new Map<string, Dependency[]>();
  for (const link of analysis.dependencies) {
    if (link.source === link.target || !byId.has(link.source) || !byId.has(link.target)) continue;
    const key = direction === 'prerequisites' ? link.target : link.source;
    const list = adjacent.get(key) || [];
    list.push(link);
    adjacent.set(key, list);
  }
  const distances = new Map([[target.id, 0]]);
  const queue = [target.id];
  let truncated = false;
  for (let index = 0; index < queue.length; index++) {
    const currentId = queue[index];
    if (distances.get(currentId)! >= maxDepth) continue;
    for (const link of adjacent.get(currentId) || []) {
      const nextId = direction === 'prerequisites' ? link.source : link.target;
      if (distances.has(nextId)) continue;
      if (distances.size >= limit) { truncated = true; continue; }
      distances.set(nextId, distances.get(currentId)! + 1);
      queue.push(nextId);
    }
  }
  const relevant = analysis.dependencies.filter(link => link.source !== link.target && distances.has(link.source) && distances.has(link.target) && (direction === 'prerequisites' ? distances.get(link.source)! > distances.get(link.target)! : distances.get(link.source)! < distances.get(link.target)!));
  const links = [...new Map(relevant.map(link => [`${link.source}\0${link.target}\0${link.field}`, link])).values()];
  const groups = [...new Set(distances.values())].sort((a, b) => b - a).map(distance => ({
    distance,
    entities: analysis.entities.filter(entity => distances.get(entity.id) === distance).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  return { target, groups, entities: groups.flatMap(group => group.entities), links, truncated };
}

export function tracePrerequisites(analysis: Analysis, targetId: string, limit = analysis.entities.length): BacktrackResult {
  return traceConnections(analysis, targetId, 'prerequisites', Infinity, limit);
}

export function traceDependents(analysis: Analysis, targetId: string, limit = analysis.entities.length): BacktrackResult {
  return traceConnections(analysis, targetId, 'dependents', Infinity, limit);
}
