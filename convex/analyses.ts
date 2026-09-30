import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
const MAX_PROJECTS=25;
const MAX_STORAGE=100*1024*1024;
const MAX_FILE=18*1024*1024;

async function requireUser(ctx:QueryCtx|MutationCtx) {
 const identity=await ctx.auth.getUserIdentity();
 if(!identity)throw new ConvexError('Sign in to save and open analyses.');
 return identity.tokenIdentifier;
}

export const list=query({
 args:{},
 handler:async ctx=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return [];
  const rows=await ctx.db.query('analyses').withIndex('by_userId',q=>q.eq('userId',identity.tokenIdentifier)).order('desc').take(200);
  return rows.map(({userId,storageId,...row})=>{void userId;void storageId;return row});
 },
});

export const fileUrl=query({
 args:{analysisId:v.string()},
 handler:async (ctx,{analysisId})=>{
  const userId=await requireUser(ctx);
  const row=await ctx.db.query('analyses').withIndex('by_userId_and_analysisId',q=>q.eq('userId',userId).eq('analysisId',analysisId)).unique();
  return row?await ctx.storage.getUrl(row.storageId):null;
 },
});

export const exists=query({args:{analysisId:v.string()},handler:async(ctx,{analysisId})=>{
 const userId=await requireUser(ctx);
 return !!(await ctx.db.query('analyses').withIndex('by_userId_and_analysisId',q=>q.eq('userId',userId).eq('analysisId',analysisId)).unique());
}});

export const save=mutation({
 args:{
  storageId:v.id('_storage'),
  replaceId:v.optional(v.string()),
  analysisId:v.string(),
  sourceKey:v.string(),
  schemaVersion:v.number(),
  name:v.string(),
  version:v.string(),
  createdAt:v.string(),
  urls:v.array(v.string()),
  mode:v.string(),
  canonicalVersion:v.number(),
  entityCount:v.number(),
  operationCount:v.number(),
  dependencyCount:v.number(),
 },
 handler:async (ctx,{replaceId,...args})=>{
  const userId=await requireUser(ctx);
  const file=await ctx.db.system.get('_storage',args.storageId);
  if(!file)throw new ConvexError('The uploaded analysis was not found.');
  if(file.size>MAX_FILE)throw new ConvexError('Analyses are limited to 18 MB compressed.');
  if(args.name.length>200||args.urls.length<1||args.urls.length>4||args.urls.some(url=>url.length>2048)||args.sourceKey.length>8200)throw new ConvexError('Invalid analysis metadata.');
  // Replace the previous map of the same project, plus an explicitly replaced older map.
  const byId=await Promise.all([...new Set([args.analysisId,replaceId])].filter((id):id is string=>!!id).map(id=>ctx.db.query('analyses').withIndex('by_userId_and_analysisId',q=>q.eq('userId',userId).eq('analysisId',id)).unique()));
  const sameProject=await ctx.db.query('analyses').withIndex('by_userId_and_sourceKey',q=>q.eq('userId',userId).eq('sourceKey',args.sourceKey)).take(20);
  const stale=new Map([...byId,...sameProject].filter((row):row is NonNullable<typeof row>=>!!row).map(row=>[row._id,row]));
  const projects=await ctx.db.query('analyses').withIndex('by_userId',q=>q.eq('userId',userId)).take(MAX_PROJECTS+1);
  if(projects.length-stale.size>=MAX_PROJECTS)throw new ConvexError('Project limit reached. Delete a project to continue.');
  if(projects.reduce((total,row)=>total+(stale.has(row._id)?0:row.size),0)+file.size>MAX_STORAGE)throw new ConvexError('Account storage limit reached. Delete a project to continue.');
  for(const row of stale.values()){await ctx.storage.delete(row.storageId);await ctx.db.delete('analyses',row._id)}
  await ctx.db.insert('analyses',{...args,userId,size:file.size});
 },
});

export const remove=mutation({
 args:{analysisId:v.string()},
 handler:async (ctx,{analysisId})=>{
  const userId=await requireUser(ctx);
  const row=await ctx.db.query('analyses').withIndex('by_userId_and_analysisId',q=>q.eq('userId',userId).eq('analysisId',analysisId)).unique();
  if(!row)return;
  await ctx.storage.delete(row.storageId);
  await ctx.db.delete('analyses',row._id);
 },
});
