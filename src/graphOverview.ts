import type { Dependency, Entity } from './types';

// One high-signal incoming link per resource makes the full-map overview
// readable. The complete dependency set remains available through All links.
export function keyOverviewLinks(dependencies: Dependency[], entities: Entity[]): Dependency[] {
  const ids = new Set(entities.map(entity => entity.id));
  const byTarget = new Map<string, Dependency[]>();
  for (const link of dependencies) {
    if (link.source === link.target || !ids.has(link.source) || !ids.has(link.target)) continue;
    const list = byTarget.get(link.target) || [];
    list.push(link);
    byTarget.set(link.target, list);
  }
  const score = (link: Dependency) =>
    Number(link.status === 'documented') * 10 + Number(!!link.required) * 8 +
    Number(link.type === 'id') * 4 + Number(link.type === 'operation') * 2 -
    Number(/(?:createdBy|updatedBy|fields\[\]|fieldId|userId)/i.test(link.field)) * 6;
  return [...byTarget.values()].map(links => [...links].sort((a, b) => score(b) - score(a) || a.field.localeCompare(b.field))[0]);
}
