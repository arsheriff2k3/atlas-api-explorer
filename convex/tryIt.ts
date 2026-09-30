'use node';

import { ConvexError, v } from 'convex/values';
import { action } from './_generated/server';
import { api } from './_generated/api';
import { tryRequest } from '../server/tryRequest.js';

// The Node action keeps DNS validation and connection pinning in one runtime.
// The web Worker forwards the authenticated request and never opens the target URL.
export const request = action({
 args:{url:v.string(),method:v.string(),headers:v.record(v.string(),v.string()),body:v.union(v.string(),v.null())},
 handler:async(ctx,args)=>{
  if(!(await ctx.auth.getUserIdentity()))throw new ConvexError('Sign in to send a request.');
  await ctx.runMutation(api.jobs.reserveTry,{});
  try{return await tryRequest(args,AbortSignal.timeout(25000))}
  finally{await ctx.runMutation(api.jobs.releaseTry,{}).catch(()=>{})}
 },
});
