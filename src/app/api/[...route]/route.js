import { after } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { jobs, createJob } from '../../../../server/jobs.js';
import { canonicalizeAnalysis, reconcileResourceEndpoints } from '../../../../server/canonicalize.js';
import { normalizeAnalysis } from '../../../../server/analysisSchema.js';
import { formEncode, tryRequest } from '../../../../server/tryRequest.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

const trying=globalThis.__atlasTrying ||= new Set();
async function tryIt(request,userId){
 const {url,method,headers,body,contentType,arrayStyle}=await readBody(request,1200000);
 if(trying.has(userId))return json({error:'A request is already in flight. Wait for it to finish.'},429);
 // The app itself is never a target: requests go only to the API being explored.
 try{if(new URL(url).host===request.headers.get('host'))return json({error:'Requests to Atlas itself are not allowed.'},400)}catch{return json({error:'Enter a full https:// URL.'},400)}
 let encoded=null;const outgoing={...(headers||{})};
 if(body!==null&&body!==undefined&&body!==''){
  if(/x-www-form-urlencoded/i.test(contentType||'')){encoded=typeof body==='string'?body:formEncode(body,arrayStyle==='index'?'index':'suffix');outgoing['Content-Type']='application/x-www-form-urlencoded'}
  else{encoded=typeof body==='string'?body:JSON.stringify(body);outgoing['Content-Type']=contentType||'application/json'}
 }
 trying.add(userId);
 try{return json(await tryRequest({url,method,headers:outgoing,body:encoded},AbortSignal.timeout(25000)))}
 catch(e){return json({error:e.message||'The request failed.'},400)}
 finally{trying.delete(userId)}
}
async function dispatch(request,context){
 const {route}=await context.params;const method=request.method;
 try{
  if(method!=='GET'&&request.headers.get('origin')&&new URL(request.headers.get('origin')).host!==request.headers.get('host'))return json({error:'Cross-origin requests are not allowed.'},403);
  const {userId}=await auth();
  if(!userId)return json({error:'Sign in to use Atlas.'},401);
  if(route[0]==='try'&&route.length===1&&method==='POST')return await tryIt(request,userId);
  if(route[0]!=='analyses')return json({error:'Route not found.'},404);
  if(route[1]==='normalize'&&route.length===2&&method==='POST'){
   const analysis=await readBody(request,40000000);
   if(!analysis || !Array.isArray(analysis.entities) || !Array.isArray(analysis.operations) || !Array.isArray(analysis.dependencies) || !analysis.coverage)return json({error:'Invalid saved analysis.'},400);
   const upgraded=analysis.coverage.schemaCount===undefined?canonicalizeAnalysis(analysis):analysis.coverage.canonicalVersion>=8?analysis:reconcileResourceEndpoints(analysis);
   return json(normalizeAnalysis(upgraded));
  }
  if(route.length===1&&method==='POST'){const body=await readBody(request);const job=createJob(body,userId);after(job.run);return json({id:job.id},202);}
  const job=jobs.get(route[1]);if(!job||job.userId!==userId)return json({error:'Analysis expired or was not found. Reanalyze to start a new session.'},404);
  if(route.length===2&&method==='GET'){const {controller,userId:owner,...data}=job;void controller;void owner;return json(data);}
  if(route.length===2&&method==='DELETE'){job.controller.abort();job.status='cancelled';return json({ok:true});}
  return json({error:'Route not found.'},404);
 }catch(e){return json({error:e.message||'Invalid request.'},400);}
}
async function readBody(request,maxLength=65536){const text=await request.text();if(text.length>maxLength)throw new Error('Request too large.');return JSON.parse(text);}
export const GET=dispatch;
export const POST=dispatch;
export const DELETE=dispatch;
