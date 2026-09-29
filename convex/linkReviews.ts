import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const list=query({
 args:{sourceKey:v.string()},
 handler:async (ctx,{sourceKey})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return {};
  const rows=await ctx.db.query('linkReviews').withIndex('by_userId_and_sourceKey_and_linkKey',q=>q.eq('userId',identity.tokenIdentifier).eq('sourceKey',sourceKey)).take(5000);
  return Object.fromEntries(rows.map(row=>[row.linkKey,row.verdict]));
 },
});

// verdict omitted = clear the review.
export const set=mutation({
 args:{sourceKey:v.string(),linkKey:v.string(),verdict:v.optional(v.union(v.literal('confirmed'),v.literal('rejected')))},
 handler:async (ctx,{sourceKey,linkKey,verdict})=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)throw new ConvexError('Sign in to review links.');
  if(linkKey.length>1000)throw new ConvexError('Invalid link.');
  const row=await ctx.db.query('linkReviews').withIndex('by_userId_and_sourceKey_and_linkKey',q=>q.eq('userId',identity.tokenIdentifier).eq('sourceKey',sourceKey).eq('linkKey',linkKey)).unique();
  if(!verdict){if(row)await ctx.db.delete('linkReviews',row._id);return}
  if(row)await ctx.db.patch('linkReviews',row._id,{verdict,updatedAt:Date.now()});
  else await ctx.db.insert('linkReviews',{userId:identity.tokenIdentifier,sourceKey,linkKey,verdict,updatedAt:Date.now()});
 },
});
