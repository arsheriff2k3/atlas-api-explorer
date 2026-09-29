import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';

async function requireUser(ctx:QueryCtx|MutationCtx) {
 const identity=await ctx.auth.getUserIdentity();
 if(!identity)throw new ConvexError('Sign in to manage your AI key.');
 return identity.tokenIdentifier;
}
const keyFor=(ctx:QueryCtx|MutationCtx,userId:string)=>ctx.db.query('aiKeys').withIndex('by_userId',q=>q.eq('userId',userId)).unique();

export const status=query({
 args:{},
 handler:async ctx=>{
  const identity=await ctx.auth.getUserIdentity();
  if(!identity)return {hasKey:false,last4:null};
  const row=await keyFor(ctx,identity.tokenIdentifier);
  return {hasKey:!!row,last4:row?.last4??null};
 },
});

// Only the owner can read their ciphertext, and it is useless without the
// server-side ATLAS_ENCRYPTION_KEY that decrypts it.
export const ciphertext=query({
 args:{},
 handler:async ctx=>{
  const row=await keyFor(ctx,await requireUser(ctx));
  return row?.ciphertext??null;
 },
});

export const set=mutation({
 args:{ciphertext:v.string(),last4:v.string()},
 handler:async (ctx,{ciphertext,last4})=>{
  if(!ciphertext.startsWith('v1:')||ciphertext.length>4096||last4.length>4)throw new ConvexError('Invalid encrypted key.');
  const userId=await requireUser(ctx);
  const row=await keyFor(ctx,userId);
  if(row)await ctx.db.patch('aiKeys',row._id,{ciphertext,last4,updatedAt:Date.now()});
  else await ctx.db.insert('aiKeys',{userId,ciphertext,last4,updatedAt:Date.now()});
 },
});

export const remove=mutation({
 args:{},
 handler:async ctx=>{
  const row=await keyFor(ctx,await requireUser(ctx));
  if(row)await ctx.db.delete('aiKeys',row._id);
 },
});
