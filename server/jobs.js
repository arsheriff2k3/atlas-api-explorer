import { randomUUID } from 'node:crypto';
import { runAnalysis } from './agent.js';
// Single Node deployment: jobs survive Next route invocations and hot reloads.
// Distributed deployment requires a durable queue and shared storage (see README).
export const jobs = globalThis.__apiPassageJobs ||= new Map();
export function createJob(body,userId) {
 const urls=body.urls;
 if(!Array.isArray(urls)||!urls.length||urls.length>4||urls.some(u=>typeof u!=='string'||u.length>2048||!/^https?:\/\//i.test(u)))throw new Error('Enter one to four valid HTTP(S) documentation URLs.');
 urls.forEach(u=>new URL(u));
 if([...jobs.values()].filter(j=>j.status==='running').length>=2)throw new Error('Two analyses are already running. Wait for one to finish.');
 for(const [id,job]of jobs)if(Date.now()-job.started>3600000 && job.status!=='running')jobs.delete(id);
 if(jobs.size>=20){const oldest=[...jobs.values()].find(j=>j.status!=='running');if(oldest)jobs.delete(oldest.id);}
 const id=randomUUID();const controller=new AbortController();
 const job={id,userId,status:'running',progress:0,stage:'discover',message:'Starting analysis',started:Date.now(),events:[],controller};jobs.set(id,job);
 const run=async()=>{
  const timeout=setTimeout(()=>controller.abort(new Error('Analysis exceeded the 10-minute runtime limit.')),600000);
  const update=(stage,progress,message,stats)=>{Object.assign(job,{stage,progress,message,stats});job.events.push({stage,progress,message,time:Date.now()});};
  try{const result=await runAnalysis(urls,{maxPages:Math.min(60,Math.max(8,Number(body.maxPages)||24))},update,controller.signal);Object.assign(job,{status:'complete',progress:100,result,message:'Your API map is ready'});}
  catch(e){Object.assign(job,{status:controller.signal.aborted?'cancelled':'failed',error:e.message});}
  finally{clearTimeout(timeout);}
 };
 return {id,run};
}
