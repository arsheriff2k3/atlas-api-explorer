import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';

const find=(ctx:QueryCtx|MutationCtx,userId:string,sourceKey:string,operationId:string)=>ctx.db.query('payloadComparisons').withIndex('by_userId_and_sourceKey_and_operationId',q=>q.eq('userId',userId).eq('sourceKey',sourceKey).eq('operationId',operationId)).unique();

export const get=query({
 args:{sourceKey:v.string(),operationId:v.string()},
 handler:async (ctx,{sourceKey,operationId})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return null;
  const row=await find(ctx,identity.tokenIdentifier,sourceKey,operationId);
  return row?{label:row.label,input:row.input,manual:row.manual,updatedAt:row.updatedAt}:null;
 },
});

export const save=mutation({
 args:{sourceKey:v.string(),operationId:v.string(),label:v.string(),input:v.string(),manual:v.record(v.string(),v.string())},
 handler:async (ctx,{sourceKey,operationId,label,input,manual})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)throw new ConvexError('Sign in to save payload comparisons.');
  if(input.length>200000||label.length>120||Object.keys(manual).length>500)throw new ConvexError('The payload is too large to save.');
  const row=await find(ctx,identity.tokenIdentifier,sourceKey,operationId);
  if(row)await ctx.db.patch('payloadComparisons',row._id,{label,input,manual,updatedAt:Date.now()});
  else await ctx.db.insert('payloadComparisons',{userId:identity.tokenIdentifier,sourceKey,operationId,label,input,manual,updatedAt:Date.now()});
 },
});
