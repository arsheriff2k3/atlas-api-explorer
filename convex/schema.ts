import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Data model
// - analyses: one row per saved map (summary + pointer). The map itself is one JSON
//   file in storage, validated against server/analysisSchema.js, identical for every
//   source format. It is stored as a file, not rows, because a large API (Chargebee:
//   ~19 MB, 675 endpoints) exceeds Convex's per-document and per-query read limits.
// - payloadComparisons: a pasted external payload + manual field mapping per endpoint.
// - flows: named, ordered endpoint chains per project.
// - linkReviews: confirmed / rejected inferred links per project.
// - shares: read-only links to a project (owner-scoped; recipients must be signed in).
// Every row is owned by `userId` = Clerk tokenIdentifier and only read through it.
export default defineSchema({
 analysisJobs: defineTable({
  jobId:v.string(),userId:v.string(),urls:v.array(v.string()),maxPages:v.number(),
  status:v.union(v.literal('queued'),v.literal('running'),v.literal('complete'),v.literal('failed'),v.literal('cancelled')),
  progress:v.number(),stage:v.string(),message:v.string(),error:v.optional(v.string()),
  events:v.array(v.object({stage:v.string(),progress:v.number(),message:v.string(),time:v.number()})),
  createdAt:v.number(),updatedAt:v.number(),attempts:v.number(),
  leaseToken:v.optional(v.string()),leaseUntil:v.optional(v.number()),
  resultStorageId:v.optional(v.id('_storage')),
  previousStorageId:v.optional(v.id('_storage')),
 })
  .index('by_jobId',['jobId'])
  .index('by_userId_and_createdAt',['userId','createdAt'])
  .index('by_userId_and_status',['userId','status'])
  .index('by_status_and_createdAt',['status','createdAt'])
  .index('by_status_and_leaseUntil',['status','leaseUntil']),
 usage: defineTable({userId:v.string(),day:v.string(),analyses:v.number(),tryRequests:v.number(),tryUntil:v.number(),lastTryAt:v.number(),normalizations:v.optional(v.number()),uploads:v.optional(v.number())})
  .index('by_userId_and_day',['userId','day']),
 analyses: defineTable({
  userId: v.string(),
  analysisId: v.string(),
  // Stable project identity (sorted source URLs); one current map per project.
  // Optional only for maps saved before it existed; set on every new save.
  sourceKey: v.optional(v.string()),
  schemaVersion: v.optional(v.number()),
  name: v.string(),
  version: v.string(),
  createdAt: v.string(),
  urls: v.array(v.string()),
  mode: v.string(),
  canonicalVersion: v.number(),
  entityCount: v.number(),
  operationCount: v.number(),
  dependencyCount: v.number(),
  storageId: v.id('_storage'),
  size: v.number(),
 })
  .index('by_userId', ['userId'])
  .index('by_userId_and_analysisId', ['userId', 'analysisId'])
  .index('by_userId_and_sourceKey', ['userId', 'sourceKey'])
  .index('by_storageId', ['storageId']),
 // A pasted payload from another system (e.g. CRM Dynamics) and the user's manual
 // field mappings, per project and endpoint.
 payloadComparisons: defineTable({
  userId: v.string(),
  sourceKey: v.string(),
  operationId: v.string(),
  label: v.string(),
  input: v.string(),
  manual: v.record(v.string(), v.string()),
  updatedAt: v.number(),
 }).index('by_userId_and_sourceKey_and_operationId', ['userId', 'sourceKey', 'operationId']),
 // Named multi-endpoint flows (ordered operation IDs) per project.
 flows: defineTable({
  userId: v.string(),
  sourceKey: v.string(),
  name: v.string(),
  operationIds: v.array(v.string()),
  updatedAt: v.number(),
 }).index('by_userId_and_sourceKey', ['userId', 'sourceKey']),
 // The user's verdicts on inferred links, keyed by source|target|field (stable across re-runs).
 linkReviews: defineTable({
  userId: v.string(),
  sourceKey: v.string(),
  linkKey: v.string(),
  verdict: v.union(v.literal('confirmed'), v.literal('rejected')),
  updatedAt: v.number(),
 }).index('by_userId_and_sourceKey_and_linkKey', ['userId', 'sourceKey', 'linkKey']),
 // Read-only share links. A link follows the owner's latest map of the project.
 shares: defineTable({
  ownerId: v.string(),
  ownerName: v.string(),
  sourceKey: v.string(),
  name: v.string(),
  token: v.string(),
  revoked: v.boolean(),
  createdAt: v.number(),
 })
  .index('by_token', ['token'])
  .index('by_ownerId_and_sourceKey', ['ownerId', 'sourceKey']),
});
