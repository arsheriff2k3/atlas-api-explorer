import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';

async function owned(ctx:MutationCtx,id:import('./_generated/dataModel').Id<'flows'>){
 const identity=await ctx.auth.getUserIdentity();
 if(!identity)throw new ConvexError('Sign in to save flows.');
 const row=await ctx.db.get('flows',id);
 if(!row||row.userId!==identity.tokenIdentifier)throw new ConvexError('Flow not found.');
 return row;
}

export const list=query({
 args:{sourceKey:v.string()},
 handler:async (ctx,{sourceKey})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return [];
  const rows=await ctx.db.query('flows').withIndex('by_userId_and_sourceKey',q=>q.eq('userId',identity.tokenIdentifier).eq('sourceKey',sourceKey)).order('desc').take(100);
  return rows.map(row=>({id:row._id,name:row.name,operationIds:row.operationIds,updatedAt:row.updatedAt}));
 },
});

export const create=mutation({
 args:{sourceKey:v.string(),name:v.string(),operationIds:v.array(v.string())},
 handler:async (ctx,{sourceKey,name,operationIds})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)throw new ConvexError('Sign in to save flows.');
  if(name.length>120||operationIds.length>40)throw new ConvexError('Flows are limited to 40 steps.');
  return await ctx.db.insert('flows',{userId:identity.tokenIdentifier,sourceKey,name,operationIds,updatedAt:Date.now()});
 },
});

export const update=mutation({
 args:{id:v.id('flows'),name:v.string(),operationIds:v.array(v.string())},
 handler:async (ctx,{id,name,operationIds})=>{
  await owned(ctx,id);
  if(name.length>120||operationIds.length>40)throw new ConvexError('Flows are limited to 40 steps.');
  await ctx.db.patch('flows',id,{name,operationIds,updatedAt:Date.now()});
 },
});

export const remove=mutation({
 args:{id:v.id('flows')},
 handler:async (ctx,{id})=>{await owned(ctx,id);await ctx.db.delete('flows',id)},
});
