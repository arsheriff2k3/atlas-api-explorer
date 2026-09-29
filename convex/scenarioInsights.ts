import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';

async function requireUser(ctx:QueryCtx|MutationCtx) {
 const identity=await ctx.auth.getUserIdentity();
 if(!identity)throw new ConvexError('Sign in to save scenario rules.');
 return identity.tokenIdentifier;
}
const find=(ctx:QueryCtx|MutationCtx,userId:string,sourceKey:string,operationId:string)=>ctx.db.query('scenarioInsights').withIndex('by_userId_and_sourceKey_and_operationId',q=>q.eq('userId',userId).eq('sourceKey',sourceKey).eq('operationId',operationId)).unique();

export const get=query({
 args:{sourceKey:v.string(),operationId:v.string()},
 handler:async (ctx,{sourceKey,operationId})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return null;
  const row=await find(ctx,identity.tokenIdentifier,sourceKey,operationId);
  return row?{result:row.result,createdAt:row.createdAt}:null;
 },
});

// Which scenarios of a project already have saved rules (for list badges).
export const listForSource=query({
 args:{sourceKey:v.string()},
 handler:async (ctx,{sourceKey})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return [];
  const rows=await ctx.db.query('scenarioInsights').withIndex('by_userId_and_sourceKey_and_operationId',q=>q.eq('userId',identity.tokenIdentifier).eq('sourceKey',sourceKey)).take(500);
  return rows.map(row=>row.operationId);
 },
});

export const save=mutation({
 args:{sourceKey:v.string(),operationId:v.string(),result:v.string()},
 handler:async (ctx,{sourceKey,operationId,result})=>{
  const userId=await requireUser(ctx);
  if(result.length>800000||sourceKey.length>2048||operationId.length>2048)throw new ConvexError('Scenario rules are too large to save.');
  const row=await find(ctx,userId,sourceKey,operationId);
  if(row)await ctx.db.patch('scenarioInsights',row._id,{result,createdAt:Date.now()});
  else await ctx.db.insert('scenarioInsights',{userId,sourceKey,operationId,result,createdAt:Date.now()});
 },
});
