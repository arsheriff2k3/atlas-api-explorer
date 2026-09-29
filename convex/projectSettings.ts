import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const get=query({
 args:{sourceKey:v.string()},
 handler:async (ctx,{sourceKey})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return null;
  const row=await ctx.db.query('projectSettings').withIndex('by_userId_and_sourceKey',q=>q.eq('userId',identity.tokenIdentifier).eq('sourceKey',sourceKey)).unique();
  return row?{docsUrl:row.docsUrl??null}:null;
 },
});

export const setDocsUrl=mutation({
 args:{sourceKey:v.string(),docsUrl:v.optional(v.string())},
 handler:async (ctx,{sourceKey,docsUrl})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)throw new ConvexError('Sign in to change project settings.');
  if(docsUrl&&(!/^https?:\/\/[^\s]+$/i.test(docsUrl)||docsUrl.length>2048))throw new ConvexError('Enter a full http(s) documentation URL.');
  const row=await ctx.db.query('projectSettings').withIndex('by_userId_and_sourceKey',q=>q.eq('userId',identity.tokenIdentifier).eq('sourceKey',sourceKey)).unique();
  if(row)await ctx.db.patch('projectSettings',row._id,{docsUrl,updatedAt:Date.now()});
  else await ctx.db.insert('projectSettings',{userId:identity.tokenIdentifier,sourceKey,docsUrl,updatedAt:Date.now()});
 },
});
