import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';

async function identity(ctx:QueryCtx|MutationCtx){
 const user=await ctx.auth.getUserIdentity();
 if(!user)throw new ConvexError('Sign in to use share links.');
 return user;
}
// 128 bits from the platform CSPRNG, URL-safe.
const newToken=()=>{const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('')};

export const listForProject=query({
 args:{sourceKey:v.string()},
 handler:async (ctx,{sourceKey})=>{
  const user=await ctx.auth.getUserIdentity();
  if(!user)return [];
  const rows=await ctx.db.query('shares').withIndex('by_ownerId_and_sourceKey',q=>q.eq('ownerId',user.tokenIdentifier).eq('sourceKey',sourceKey)).take(20);
  return rows.filter(row=>!row.revoked).map(row=>({token:row.token,createdAt:row.createdAt}));
 },
});

export const create=mutation({
 args:{sourceKey:v.string()},
 handler:async (ctx,{sourceKey})=>{
  const user=await identity(ctx);
  const project=await ctx.db.query('analyses').withIndex('by_userId_and_sourceKey',q=>q.eq('userId',user.tokenIdentifier).eq('sourceKey',sourceKey)).first();
  if(!project)throw new ConvexError('Save this project before sharing it.');
  const links=await ctx.db.query('shares').withIndex('by_ownerId_and_sourceKey',q=>q.eq('ownerId',user.tokenIdentifier).eq('sourceKey',sourceKey)).take(21);
  if(links.filter(link=>!link.revoked).length>=20)throw new ConvexError('This project has reached its 20 active share-link limit.');
  const token=newToken();
  await ctx.db.insert('shares',{ownerId:user.tokenIdentifier,ownerName:user.name||user.email||'An APIPassage user',sourceKey,name:project.name,token,revoked:false,createdAt:Date.now()});
  return token;
 },
});

export const revoke=mutation({
 args:{token:v.string()},
 handler:async (ctx,{token})=>{
  const user=await identity(ctx);
  const row=await ctx.db.query('shares').withIndex('by_token',q=>q.eq('token',token)).unique();
  if(!row||row.ownerId!==user.tokenIdentifier)throw new ConvexError('Share link not found.');
  await ctx.db.patch('shares',row._id,{revoked:true});
 },
});

// Any signed-in user holding the token can read the owner's latest map of that project.
export const open=query({
 args:{token:v.string()},
 handler:async (ctx,{token})=>{
  await identity(ctx);
  const row=await ctx.db.query('shares').withIndex('by_token',q=>q.eq('token',token)).unique();
  if(!row||row.revoked)return null;
  const project=await ctx.db.query('analyses').withIndex('by_userId_and_sourceKey',q=>q.eq('userId',row.ownerId).eq('sourceKey',row.sourceKey)).order('desc').first();
  if(!project)return null;
  return {name:project.name,ownerName:row.ownerName==='An Atlas user'?'An APIPassage user':row.ownerName,createdAt:project.createdAt,url:await ctx.storage.getUrl(project.storageId)};
 },
});
