import { auth } from '@clerk/nextjs/server';
import { randomUUID } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api.js';
import { canonicalizeAnalysis, reconcileResourceEndpoints } from '../../../../server/canonicalize.js';
import { normalizeAnalysis } from '../../../../server/analysisSchema.js';
import { formEncode } from '../../../../server/formEncode.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

async function tryIt(request,convex){
 const {url,method,headers,body,contentType,arrayStyle}=await readBody(request,1200000);
 // The app itself is never a target: requests go only to the API being explored.
 try{if(new URL(url).host===request.headers.get('host'))return json({error:'Requests to APIPassage itself are not allowed.'},400)}catch{return json({error:'Enter a full https:// URL.'},400)}
 if(new URL(url).protocol!=='https:')return json({error:'Try It requires HTTPS to protect API credentials.'},400);
 let encoded=null;const outgoing={...(headers||{})};
 if(body!==null&&body!==undefined&&body!==''){
  if(/x-www-form-urlencoded/i.test(contentType||'')){encoded=typeof body==='string'?body:formEncode(body,arrayStyle==='index'?'index':'suffix');outgoing['Content-Type']='application/x-www-form-urlencoded'}
  else{encoded=typeof body==='string'?body:JSON.stringify(body);outgoing['Content-Type']=contentType||'application/json'}
 }
 try{return json(await convex.action(api.tryIt.request,{url,method,headers:outgoing,body:encoded}))}
 catch(e){return json({error:e.message||'The request failed.'},400)}
}
async function dispatch(request,context){
 const {route}=await context.params;const method=request.method;
 try{
  if(method!=='GET'&&request.headers.get('origin')&&new URL(request.headers.get('origin')).host!==request.headers.get('host'))return json({error:'Cross-origin requests are not allowed.'},403);
  const {userId,getToken}=await auth();
  if(!userId)return json({error:'Sign in to use APIPassage.'},401);
  const token=await getToken();
  if(!token)return json({error:'Your session could not connect to project storage. Sign in again.'},401);
  const convex=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  convex.setAuth(token);
  if(route[0]==='try'&&route.length===1&&method==='POST')return await tryIt(request,convex);
  if(route[0]==='upload'&&route.length===1&&method==='POST'){
   const siteUrl=process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
   if(!siteUrl)throw new Error('Convex upload endpoint is not configured.');
   const body=await readBytes(request,18*1024*1024);
   const uploaded=await fetch(new URL('/upload-analysis',siteUrl),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':request.headers.get('content-type')||'application/octet-stream'},body});
   if(!uploaded.ok)return json({error:await uploaded.text()||'The analysis could not be uploaded.'},uploaded.status);
   return json(await uploaded.json());
  }
  if(route[0]!=='analyses')return json({error:'Route not found.'},404);
  if(route[1]==='normalize'&&route.length===2&&method==='POST'){
   const analysis=await readBody(request,40000000);
   if(!analysis || !Array.isArray(analysis.entities) || !Array.isArray(analysis.operations) || !Array.isArray(analysis.dependencies) || !analysis.coverage)return json({error:'Invalid saved analysis.'},400);
   if(typeof analysis.id!=='string'||!(await convex.query(api.analyses.exists,{analysisId:analysis.id})))return json({error:'Saved analysis not found in your account.'},404);
   await convex.mutation(api.jobs.reserveNormalize,{});
   const upgraded=analysis.coverage.schemaCount===undefined?canonicalizeAnalysis(analysis):analysis.coverage.canonicalVersion>=8?analysis:reconcileResourceEndpoints(analysis);
   return json(normalizeAnalysis(upgraded));
  }
  if(route.length===1&&method==='POST'){
   const body=await readBody(request);const id=randomUUID();
   await convex.mutation(api.jobs.create,{jobId:id,urls:body.urls,maxPages:Math.min(60,Math.max(8,Number(body.maxPages)||24))});
   return json({id},202);
  }
  if(route.length===1&&method==='GET')return json(await convex.query(api.jobs.latestActive,{}));
  if(route.length===2&&method==='GET'){
   const job=await convex.query(api.jobs.get,{jobId:route[1]});
   return job?json(job):json({error:'Analysis job was not found in your account.'},404);
  }
  if(route.length===2&&method==='DELETE'){await convex.mutation(api.jobs.cancel,{jobId:route[1]});return json({ok:true});}
  return json({error:'Route not found.'},404);
 }catch(e){return json({error:e.message||'Invalid request.'},400);}
}
async function readBody(request,maxLength=65536){
 return JSON.parse(new TextDecoder().decode(await readBytes(request,maxLength)));
}
async function readBytes(request,maxLength){
 const reader=request.body?.getReader();if(!reader)throw new Error('Request body is required.');
 const chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxLength){await reader.cancel();throw new Error('Request too large.')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return bytes;
}
export const GET=dispatch;
export const POST=dispatch;
export const DELETE=dispatch;
