import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';

const DAY=24*60*60*1000;
const LEASE=12*60*1000;
const MAX_DAILY_ANALYSES=20;
const MAX_DAILY_TRY=100;
const MAX_PROJECTS=25;
const MAX_STORAGE=100*1024*1024;
const MAX_FILE=18*1024*1024;
const day=()=>new Date().toISOString().slice(0,10);
const sourceKey=(urls:string[])=>urls.map(url=>url.trim()).sort().join('|');

export const create=mutation({
 args:{jobId:v.string(),urls:v.array(v.string()),maxPages:v.number()},
 handler:async(ctx,{jobId,urls,maxPages})=>{
  const user=await ctx.auth.getUserIdentity();
  if(!user)throw new ConvexError('Sign in to run an analysis.');
  if(!/^[0-9a-f-]{36}$/i.test(jobId)||urls.length<1||urls.length>4||!Number.isInteger(maxPages)||maxPages<8||maxPages>60)throw new ConvexError('Invalid analysis settings.');
  for(const input of urls){
   if(input.length>2048)throw new ConvexError('Documentation URL is too long.');
   try{const url=new URL(input);if(!['http:','https:'].includes(url.protocol))throw new Error()}catch{throw new ConvexError('Use complete HTTP(S) documentation URLs.');}
  }
  const now=Date.now();const userId=user.tokenIdentifier;
  const active=await Promise.all((['queued','running'] as const).map(status=>ctx.db.query('analysisJobs').withIndex('by_userId_and_status',q=>q.eq('userId',userId).eq('status',status)).take(2)));
  if(active[0].length+active[1].length>=2)throw new ConvexError('Two analyses are already queued or running for your account.');
  const today=day();const usage=await ctx.db.query('usage').withIndex('by_userId_and_day',q=>q.eq('userId',userId).eq('day',today)).unique();
  if((usage?.analyses||0)>=MAX_DAILY_ANALYSES)throw new ConvexError('Daily analysis limit reached. Try again tomorrow.');
  if(usage)await ctx.db.patch('usage',usage._id,{analyses:usage.analyses+1});
  else await ctx.db.insert('usage',{userId,day:today,analyses:1,tryRequests:0,tryUntil:0,lastTryAt:0});
  const existing=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique();
  if(existing)throw new ConvexError('Job already exists.');
  await ctx.db.insert('analysisJobs',{jobId,userId,urls,maxPages,status:'queued',progress:0,stage:'queued',message:'Waiting for analysis',events:[],createdAt:now,updatedAt:now,attempts:0});
  await ctx.scheduler.runAfter(0,internal.analyze.run,{jobId});
  return jobId;
 },
});

export const recoverPending=internalMutation({args:{},handler:async ctx=>{
 const now=Date.now();
 const queued=await ctx.db.query('analysisJobs').withIndex('by_status_and_createdAt',q=>q.eq('status','queued').lt('createdAt',now-60000)).take(20);
 const stale=await ctx.db.query('analysisJobs').withIndex('by_status_and_leaseUntil',q=>q.eq('status','running').lt('leaseUntil',now)).take(20);
 for(const row of [...queued,...stale])await ctx.scheduler.runAfter(0,internal.analyze.run,{jobId:row.jobId});
 return queued.length+stale.length;
}});

export const get=query({
 args:{jobId:v.string()},
 handler:async(ctx,{jobId})=>{
  const user=await ctx.auth.getUserIdentity();if(!user)return null;
  const row=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique();
  if(!row||row.userId!==user.tokenIdentifier)return null;
  const resultUrl=row.status==='complete'&&row.resultStorageId?await ctx.storage.getUrl(row.resultStorageId):null;
  const previousResultUrl=row.status==='complete'&&row.previousStorageId?await ctx.storage.getUrl(row.previousStorageId):null;
  return {id:row.jobId,status:row.status,progress:row.progress,stage:row.stage,message:row.message,error:row.error,events:row.events,resultUrl,previousResultUrl};
 },
});

export const latestActive=query({args:{},handler:async ctx=>{
 const user=await ctx.auth.getUserIdentity();if(!user)return null;
 const rows=(await Promise.all((['queued','running'] as const).map(status=>ctx.db.query('analysisJobs').withIndex('by_userId_and_status',q=>q.eq('userId',user.tokenIdentifier).eq('status',status)).take(2)))).flat();
 const row=rows.sort((a,b)=>b.createdAt-a.createdAt)[0];
 return row?{id:row.jobId,status:row.status,progress:row.progress,stage:row.stage,message:row.message,events:row.events}:null;
}});

export const cancel=mutation({
 args:{jobId:v.string()},
 handler:async(ctx,{jobId})=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new ConvexError('Sign in to cancel an analysis.');
  const row=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique();
  if(!row||row.userId!==user.tokenIdentifier)throw new ConvexError('Analysis job not found.');
  if(['queued','running'].includes(row.status))await ctx.db.patch('analysisJobs',row._id,{status:'cancelled',message:'Analysis stopped',updatedAt:Date.now()});
  return true;
 },
});

export const reserveTry=mutation({
 args:{},handler:async ctx=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new ConvexError('Sign in to send a request.');
  const userId=user.tokenIdentifier,today=day(),now=Date.now();
  const usage=await ctx.db.query('usage').withIndex('by_userId_and_day',q=>q.eq('userId',userId).eq('day',today)).unique();
  if(usage&&(usage.tryRequests>=MAX_DAILY_TRY||usage.tryUntil>now||now-usage.lastTryAt<1000))throw new ConvexError('Try It is busy or its daily limit has been reached.');
  if(usage)await ctx.db.patch('usage',usage._id,{tryRequests:usage.tryRequests+1,tryUntil:now+30000,lastTryAt:now});
  else await ctx.db.insert('usage',{userId,day:today,analyses:0,tryRequests:1,tryUntil:now+30000,lastTryAt:now});
  return true;
 },
});
export const releaseTry=mutation({args:{},handler:async ctx=>{
 const user=await ctx.auth.getUserIdentity();if(!user)return;
 const usage=await ctx.db.query('usage').withIndex('by_userId_and_day',q=>q.eq('userId',user.tokenIdentifier).eq('day',day())).unique();
 if(usage)await ctx.db.patch('usage',usage._id,{tryUntil:0});
}});

export const reserveNormalize=mutation({args:{},handler:async ctx=>{
 const user=await ctx.auth.getUserIdentity();if(!user)throw new ConvexError('Sign in to normalize an analysis.');
 const userId=user.tokenIdentifier,today=day();
 const usage=await ctx.db.query('usage').withIndex('by_userId_and_day',q=>q.eq('userId',userId).eq('day',today)).unique();
 if((usage?.normalizations||0)>=30)throw new ConvexError('Daily normalization limit reached.');
 if(usage)await ctx.db.patch('usage',usage._id,{normalizations:(usage.normalizations||0)+1});
 else await ctx.db.insert('usage',{userId,day:today,analyses:0,tryRequests:0,tryUntil:0,lastTryAt:0,normalizations:1});
}});

export const reserveUpload=mutation({args:{},handler:async ctx=>{
 const user=await ctx.auth.getUserIdentity();if(!user)throw new ConvexError('Sign in to upload an analysis.');
 const userId=user.tokenIdentifier,today=day();
 const usage=await ctx.db.query('usage').withIndex('by_userId_and_day',q=>q.eq('userId',userId).eq('day',today)).unique();
 if((usage?.uploads||0)>=40)throw new ConvexError('Daily upload limit reached.');
 if(usage)await ctx.db.patch('usage',usage._id,{uploads:(usage.uploads||0)+1});
 else await ctx.db.insert('usage',{userId,day:today,analyses:0,tryRequests:0,tryUntil:0,lastTryAt:0,uploads:1});
}});

export const claimNext=internalMutation({args:{leaseToken:v.string(),jobId:v.optional(v.string())},handler:async(ctx,{leaseToken,jobId})=>{
 const now=Date.now();
 const target=jobId?await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique():null;
 const queued=jobId?[]:await ctx.db.query('analysisJobs').withIndex('by_status_and_createdAt',q=>q.eq('status','queued')).order('asc').take(20);
 const stale=jobId||queued.length?[]:await ctx.db.query('analysisJobs').withIndex('by_status_and_leaseUntil',q=>q.eq('status','running').lt('leaseUntil',now)).order('asc').take(1);
 const row=target&&['queued','running'].includes(target.status)&&((target.leaseUntil||0)<now||target.status==='queued')?target:queued[0]||stale.find(job=>(job.leaseUntil||0)<now);
 if(!row)return null;
 if(row.attempts>=3){await ctx.db.patch('analysisJobs',row._id,{status:'failed',error:'Analysis restarted too many times.',updatedAt:now});return null;}
 await ctx.db.patch('analysisJobs',row._id,{status:'running',attempts:row.attempts+1,leaseToken,leaseUntil:now+LEASE,updatedAt:now,message:'Starting analysis'});
 return {jobId:row.jobId,urls:row.urls,maxPages:row.maxPages};
}});

export const heartbeat=internalMutation({
 args:{jobId:v.string(),leaseToken:v.string(),stage:v.string(),progress:v.number(),message:v.string()},
 handler:async(ctx,{jobId,leaseToken,stage,progress,message})=>{
  const row=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique();
  if(!row||row.status!=='running'||row.leaseToken!==leaseToken)return false;
  const now=Date.now(),event={stage:stage.slice(0,60),progress:Math.max(0,Math.min(99,progress)),message:message.slice(0,240),time:now};
  await ctx.db.patch('analysisJobs',row._id,{stage:event.stage,progress:event.progress,message:event.message,events:[...row.events.slice(-19),event],leaseUntil:now+LEASE,updatedAt:now});
  return true;
 },
});

export const complete=internalMutation({
 args:{jobId:v.string(),leaseToken:v.string(),storageId:v.id('_storage'),analysisId:v.string(),sourceKey:v.string(),schemaVersion:v.number(),name:v.string(),version:v.string(),createdAt:v.string(),urls:v.array(v.string()),mode:v.string(),canonicalVersion:v.number(),entityCount:v.number(),operationCount:v.number(),dependencyCount:v.number()},
 handler:async(ctx,{jobId,leaseToken,storageId,...data})=>{
  const row=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique();
  if(!row||row.status!=='running'||row.leaseToken!==leaseToken)return false;
  const file=await ctx.db.system.get('_storage',storageId);
  if(!file||file.size>MAX_FILE)throw new ConvexError('Analysis exceeds the 18 MB saved-file limit.');
  if(data.sourceKey!==sourceKey(row.urls)||sourceKey(data.urls)!==sourceKey(row.urls))throw new ConvexError('Analysis sources changed during processing.');
  const projects=await ctx.db.query('analyses').withIndex('by_userId',q=>q.eq('userId',row.userId)).take(MAX_PROJECTS+1);
  const stale=projects.filter(project=>project.sourceKey===data.sourceKey||project.analysisId===data.analysisId);
  if(projects.length-stale.length>=MAX_PROJECTS)throw new ConvexError('Project limit reached. Delete a project to continue.');
  if(projects.reduce((sum,project)=>sum+(stale.includes(project)?0:project.size),0)+file.size>MAX_STORAGE)throw new ConvexError('Account storage limit reached. Delete a project to continue.');
  const previous=stale[0]?.storageId;
  for(const project of stale){if(project.storageId!==previous)await ctx.storage.delete(project.storageId);await ctx.db.delete('analyses',project._id);}
  await ctx.db.insert('analyses',{...data,userId:row.userId,storageId,size:file.size});
  await ctx.db.patch('analysisJobs',row._id,{status:'complete',progress:100,stage:'complete',message:'Your API map is ready',resultStorageId:storageId,previousStorageId:previous,updatedAt:Date.now()});
  return true;
 },
});

export const fail=internalMutation({args:{jobId:v.string(),leaseToken:v.string(),error:v.string()},handler:async(ctx,{jobId,leaseToken,error})=>{
 const row=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',jobId)).unique();
 if(!row||row.status!=='running'||row.leaseToken!==leaseToken)return false;
 await ctx.db.patch('analysisJobs',row._id,{status:'failed',error:error.slice(0,500),message:'Analysis failed',updatedAt:Date.now()});return true;
}});

export const cleanOld=internalMutation({args:{},handler:async ctx=>{
 const cutoff=Date.now()-7*DAY;
 const rows=(await Promise.all((['complete','failed','cancelled'] as const).map(status=>ctx.db.query('analysisJobs').withIndex('by_status_and_createdAt',q=>q.eq('status',status).lt('createdAt',cutoff)).take(100)))).flat();
 for(const row of rows)await ctx.db.delete('analysisJobs',row._id);
 const usage=await ctx.db.query('usage').take(1000);
 for(const row of usage)if(row.day<new Date(Date.now()-2*DAY).toISOString().slice(0,10))await ctx.db.delete('usage',row._id);
 return rows.length;
}});
