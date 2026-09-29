import { z } from 'zod';

// The one shape every documentation format is normalized into (mirrors src/types.ts).
// Extraction output is checked against it before it is returned or saved, so
// All supported specification formats are stored identically.
export const SCHEMA_VERSION = 1;

const Field = z.object({
  name: z.string().min(1), type: z.string(), required: z.boolean(), description: z.string(),
  enum: z.array(z.string()).optional(), location: z.enum(['path', 'query', 'header', 'cookie', 'body', 'argument']).optional(), ref: z.string().optional(),
});
const Entity = z.object({
  id: z.string().min(1), name: z.string().min(1), rawName: z.string().optional(), api: z.string(), group: z.string(), description: z.string(),
  fields: z.array(Field), source: z.string(), pointer: z.string().optional(), operationIds: z.array(z.string()), kind: z.string(), schemaNames: z.array(z.string()).optional(),
});
const Operation = z.object({
  id: z.string().min(1), name: z.string().min(1), method: z.string().min(1), path: z.string(), description: z.string(),
  inputs: z.array(Field), outputs: z.array(Field), entityIds: z.array(z.string()), source: z.string(),
  tags: z.array(z.string()).optional(), kind: z.literal('webhook').optional(), contentType: z.string().optional(),
}).passthrough(); // parser metadata (operationId, security, links, responseRefs) is kept as-is
const Dependency = z.object({
  id: z.string().min(1), source: z.string(), target: z.string(), field: z.string(), type: z.enum(['id', 'schema', 'operation', 'cross-api']),
  status: z.enum(['documented', 'inferred']), evidence: z.string(), sourceUrl: z.string(),
  quote: z.string().optional(), sourceOperation: z.string().optional(), targetOperation: z.string().optional(), required: z.boolean().optional(), extraction: z.string().optional(), review: z.literal('confirmed').optional(),
});
export const Analysis = z.object({
  id: z.string().min(1), name: z.string(), version: z.string(), createdAt: z.string(), urls: z.array(z.string()),
  entities: z.array(Entity), operations: z.array(Operation), dependencies: z.array(Dependency),
  patterns: z.array(z.object({ name: z.string(), detail: z.string(), source: z.string(), inferred: z.boolean().optional() })),
  warnings: z.array(z.string()),
  sources: z.array(z.object({ url: z.string(), title: z.string(), kind: z.string(), status: z.string() })),
  coverage: z.object({ pagesRead: z.number(), specifications: z.number(), discovered: z.number(), attempted: z.number(), pageLimit: z.number(), aiPages: z.number().optional(), complete: z.boolean() }).passthrough(),
  mode: z.string(), demo: z.boolean(), jobId: z.string().optional(), schemaVersion: z.number().optional(), docsUrl: z.string().nullable().optional(), servers: z.array(z.string()).optional(), changes: z.object({ comparedWith: z.string() }).passthrough().optional(),
});

/** Puts every record into the canonical shape before validation. */
export function normalizeAnalysis(analysis) {
  for (const operation of analysis.operations) {
    delete operation.entityNames;
    // Older saved operations can lack parameter locations; path templates and GET inputs are inferable.
    for (const input of operation.inputs) if (!input.location) {
      if (operation.path.includes(`{${input.name}}`)) input.location = 'path';
      else if (/^(?:GET|DELETE|HEAD)$/.test(operation.method)) input.location = 'query';
      else if (/^(?:POST|PUT|PATCH)$/.test(operation.method)) input.location = 'body';
    }
  }
  analysis.schemaVersion = SCHEMA_VERSION;
  return analysis;
}

/** Structural and referential checks: shape, unique IDs, and links that point at real records. */
export function validateAnalysis(analysis) {
  const parsed = Analysis.safeParse(analysis);
  const problems = parsed.success ? [] : parsed.error.issues.slice(0, 20).map(issue => `${issue.path.join('.')}: ${issue.message}`);
  if (!parsed.success) return problems;
  const entityIds = new Set(); const operationIds = new Set(); const dependencyIds = new Set();
  for (const entity of analysis.entities) { if (entityIds.has(entity.id)) problems.push(`duplicate entity id ${entity.id}`); entityIds.add(entity.id); }
  for (const operation of analysis.operations) { if (operationIds.has(operation.id)) problems.push(`duplicate operation id ${operation.id}`); operationIds.add(operation.id); }
  for (const entity of analysis.entities) for (const id of entity.operationIds) if (!operationIds.has(id)) problems.push(`entity ${entity.name} lists missing operation ${id}`);
  for (const operation of analysis.operations) for (const id of operation.entityIds) if (!entityIds.has(id)) problems.push(`operation ${operation.name} lists missing entity ${id}`);
  for (const link of analysis.dependencies) {
    if (dependencyIds.has(link.id)) problems.push(`duplicate dependency id ${link.id}`);
    dependencyIds.add(link.id);
    if (!entityIds.has(link.source) || !entityIds.has(link.target)) problems.push(`dependency ${link.id} points at a missing entity`);
  }
  return problems.slice(0, 40);
}
