import type { Analysis, Operation } from './types';

// A project can mix API styles (QuickBooks: REST accounting + GraphQL projects).
// The slice keeps one style's endpoints, the resources they touch, and the links into
// those resources (with each link's prerequisite resource as context), so every view
// can show REST or GraphQL on its own.
export type ApiStyle = 'all' | 'rest' | 'graphql';

const GRAPHQL_METHODS = new Set(['QUERY', 'MUTATION', 'SUBSCRIPTION']);
export const styleOf = (operation: Pick<Operation, 'method'>): Exclude<ApiStyle, 'all'> =>
  GRAPHQL_METHODS.has(operation.method.toUpperCase()) ? 'graphql' : 'rest';

/** True when the analysis has both GraphQL and non-GraphQL endpoints. */
export const hasMixedStyles = (analysis: Analysis) => {
  const styles = new Set(analysis.operations.map(styleOf));
  return styles.has('rest') && styles.has('graphql');
};

export function sliceByStyle(analysis: Analysis, style: ApiStyle): Analysis {
  if (style === 'all') return analysis;
  const operations = analysis.operations.filter(operation => styleOf(operation) === style);
  const kept = new Set(operations.map(operation => operation.id));
  const entities = analysis.entities
    .filter(entity => entity.operationIds.some(id => kept.has(id)))
    .map(entity => ({ ...entity, operationIds: entity.operationIds.filter(id => kept.has(id)) }));
  const owned = new Set(entities.map(entity => entity.id));
  // Links into this style's resources come along with their prerequisite resource, even
  // when it has no endpoint in this style (GraphQL time activities need a REST Employee).
  const dependencies = analysis.dependencies.filter(link => owned.has(link.target));
  const context = new Set(dependencies.map(link => link.source).filter(id => !owned.has(id)));
  entities.push(...analysis.entities.filter(entity => context.has(entity.id)).map(entity => ({ ...entity, operationIds: [] })));
  return {
    ...analysis,
    entities,
    operations: operations.map(operation => ({ ...operation, entityIds: operation.entityIds.filter(id => owned.has(id)) })),
    dependencies,
  };
}
