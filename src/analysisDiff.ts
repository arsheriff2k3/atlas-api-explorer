import type { Analysis } from './types';

// What changed between two runs of the same project. Records are matched by their
// stable IDs (entity IDs derive from host + resource path; endpoints from method + path).
export interface AnalysisChanges {
  comparedWith: string;          // previous createdAt
  entities: {added: string[]; removed: string[]};
  endpoints: {added: string[]; removed: string[]; changed: {endpoint: string; addedFields: string[]; removedFields: string[]; newlyRequired: string[]}[]};
  links: {added: string[]; removed: string[]};
}

const endpointKey = (operation: {method: string; path: string}) => `${operation.method} ${operation.path}`;

export function diffAnalyses(previous: Analysis, next: Analysis): AnalysisChanges {
  const name = (analysis: Analysis, id: string) => analysis.entities.find(entity => entity.id === id)?.name || id;
  const linkLabel = (analysis: Analysis) => (link: Analysis['dependencies'][number]) => `${name(analysis, link.source)} → ${name(analysis, link.target)} (${link.field})`;
  const set = <T>(items: T[], key: (item: T) => string) => new Map(items.map(item => [key(item), item]));
  const oldEntities = set(previous.entities, entity => entity.id), newEntities = set(next.entities, entity => entity.id);
  const oldOps = set(previous.operations.filter(op => op.kind !== 'webhook'), endpointKey), newOps = set(next.operations.filter(op => op.kind !== 'webhook'), endpointKey);
  const oldLinks = set(previous.dependencies.filter(link => link.type !== 'schema'), linkLabel(previous)), newLinks = set(next.dependencies.filter(link => link.type !== 'schema'), linkLabel(next));
  const changed: AnalysisChanges['endpoints']['changed'] = [];
  for (const [key, operation] of newOps) {
    const before = oldOps.get(key); if (!before) continue;
    const oldFields = set(before.inputs, field => field.name), newFields = set(operation.inputs, field => field.name);
    const addedFields = [...newFields.keys()].filter(field => !oldFields.has(field));
    const removedFields = [...oldFields.keys()].filter(field => !newFields.has(field));
    const newlyRequired = [...newFields.values()].filter(field => field.required && oldFields.get(field.name)?.required === false).map(field => field.name);
    if (addedFields.length || removedFields.length || newlyRequired.length) changed.push({endpoint: key, addedFields: addedFields.slice(0, 50), removedFields: removedFields.slice(0, 50), newlyRequired});
  }
  const only = <T>(a: Map<string, T>, b: Map<string, T>) => [...a.keys()].filter(key => !b.has(key));
  return {
    comparedWith: previous.createdAt,
    entities: {added: only(newEntities, oldEntities).map(id => newEntities.get(id)!.name), removed: only(oldEntities, newEntities).map(id => oldEntities.get(id)!.name)},
    endpoints: {added: only(newOps, oldOps), removed: only(oldOps, newOps), changed: changed.slice(0, 200)},
    links: {added: only(newLinks, oldLinks).slice(0, 300), removed: only(oldLinks, newLinks).slice(0, 300)},
  };
}

export const changeCount = (changes: AnalysisChanges) => changes.entities.added.length + changes.entities.removed.length + changes.endpoints.added.length + changes.endpoints.removed.length + changes.endpoints.changed.length + changes.links.added.length + changes.links.removed.length;
