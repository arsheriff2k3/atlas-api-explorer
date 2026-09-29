import type { Dependency, Entity } from './types';

export type EntitySort = 'dependency' | 'connected' | 'alphabetical';

export function orderEntities(entities: Entity[], dependencies: Dependency[], sort: EntitySort = 'dependency'): Entity[] {
  const alphabetical = (a: Entity, b: Entity) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  if (sort === 'alphabetical') return [...entities].sort(alphabetical);
  const ids = new Set(entities.map(e => e.id));
  const incoming = new Map(entities.map(e => [e.id, new Set<string>()]));
  const outgoing = new Map(entities.map(e => [e.id, new Set<string>()]));
  for (const link of dependencies) {
    if (link.source === link.target || !ids.has(link.source) || !ids.has(link.target)) continue;
    incoming.get(link.target)!.add(link.source);
    outgoing.get(link.source)!.add(link.target);
  }
  const degree = (e: Entity) => incoming.get(e.id)!.size + outgoing.get(e.id)!.size;
  if (sort === 'connected') return [...entities].sort((a, b) => degree(b) - degree(a) || alphabetical(a, b));

  // Walk prerequisites before consumers. Cycles are broken by the fewest
  // outstanding prerequisites, then by name, so every entity has a stable place.
  const remaining = new Map(entities.map(e => [e.id, e]));
  const pending = new Map([...incoming].map(([id, sources]) => [id, sources.size]));
  const ordered: Entity[] = [];
  while (remaining.size) {
    const next = [...remaining.values()].sort((a, b) =>
      pending.get(a.id)! - pending.get(b.id)! ||
      degree(b) - degree(a) || alphabetical(a, b)
    )[0];
    ordered.push(next);
    remaining.delete(next.id);
    for (const target of outgoing.get(next.id)!) pending.set(target, pending.get(target)! - 1);
  }
  return ordered;
}
