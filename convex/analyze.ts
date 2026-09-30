'use node';

import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { runAnalysis } from '../server/agent.js';

// A scheduled action runs one durable job and then exits. Convex may terminate
// an action at ten minutes, so our timeout fires earlier and the cron can retry.
export const run=internalAction({
 args:{jobId:v.string()},
 handler:async(ctx,{jobId})=>{
  const leaseToken=randomUUID();
  const job=await ctx.runMutation(internal.jobs.claimNext,{jobId,leaseToken});
  if(!job)return;
  const controller=new AbortController();
  let latest={stage:'discover',progress:1,message:'Starting analysis'};
  let heartbeatFailures=0;
  let heartbeatRunning=false;
  const heartbeat=async()=>{
   if(heartbeatRunning)return;
   heartbeatRunning=true;
   try{
    const active=await ctx.runMutation(internal.jobs.heartbeat,{jobId,leaseToken,...latest});
    heartbeatFailures=0;
    if(!active)controller.abort(new Error('Analysis was cancelled or reassigned.'));
   }catch(error){
    if(++heartbeatFailures>=3)controller.abort(new Error('Could not renew the analysis lease.'));
    console.error(JSON.stringify({event:'job_heartbeat_error',jobId,error:String(error)}));
   }finally{heartbeatRunning=false}
  };
  const interval=setInterval(()=>{void heartbeat()},5000);
  const timeout=setTimeout(()=>controller.abort(new Error('Analysis exceeded the nine-minute runtime limit.')),540000);
  try{
   await heartbeat();controller.signal.throwIfAborted();
   const result=await runAnalysis(job.urls,{maxPages:job.maxPages},(stage:string,progress:number,message:string)=>{latest={stage,progress,message}},controller.signal);
   const metadata=result as typeof result & {schemaVersion?:number;coverage:typeof result.coverage & {canonicalVersion?:number}};
   await heartbeat();controller.signal.throwIfAborted();
   const body=gzipSync(Buffer.from(JSON.stringify(result)));
   if(body.byteLength>18*1024*1024)throw new Error('Analysis exceeds the 18 MB saved-file limit.');
   const storageId=await ctx.storage.store(new Blob([new Uint8Array(body)],{type:'application/gzip'}));
   const saved=await ctx.runMutation(internal.jobs.complete,{
    jobId,leaseToken,storageId,analysisId:result.id,sourceKey:result.urls.map((url:string)=>url.trim()).sort().join('|'),
    schemaVersion:metadata.schemaVersion??0,name:result.name,version:result.version,createdAt:result.createdAt,
    urls:result.urls,mode:result.mode,canonicalVersion:metadata.coverage?.canonicalVersion??0,
    entityCount:result.entities.length,operationCount:result.operations.filter((operation:{kind?:string})=>operation.kind!=='webhook').length,
    dependencyCount:result.dependencies.length,
   });
   if(saved)console.info(JSON.stringify({event:'job_complete',jobId,bytes:body.byteLength}));
  }catch(error){
   try{await ctx.runMutation(internal.jobs.fail,{jobId,leaseToken,error:String(error instanceof Error?error.message:error)})}
   catch(failure){console.error(JSON.stringify({event:'job_fail_update_error',jobId,error:String(failure)}))}
   console.error(JSON.stringify({event:'job_error',jobId,error:String(error)}));
  }finally{clearInterval(interval);clearTimeout(timeout)}
 },
});
