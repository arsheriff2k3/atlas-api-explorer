import { after } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { jobs, createJob } from '../../../../server/jobs.js';
import { answerQuestion, localCodexSignedIn } from '../../../../server/agent.js';
import { canonicalizeAnalysis, reconcileResourceEndpoints } from '../../../../server/canonicalize.js';
import { cancelDeviceLogin, localCodexAllowed, loginStatus, startDeviceLogin } from '../../../../server/codexLogin.js';
import { decrypt, encrypt, encryptionReady } from '../../../../server/secrets.js';
import { checkScenarioRules } from '../../../../server/scenarioRules.js';
import { normalizeAnalysis } from '../../../../server/analysisSchema.js';
import { formEncode, tryRequest } from '../../../../server/tryRequest.js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

// The browser (already authenticated to Convex) stores and fetches the user's encrypted
// key; this server only encrypts/decrypts it, bound to the signed-in Clerk user.
// A user's key wins; otherwise the local Codex login, only on a local dev server.
function aiCredentials(request,userId,aiKey){
 const apiKey=typeof aiKey==='string'&&aiKey?decrypt(aiKey,userId):null;
 if(apiKey)return {apiKey};
 return localCodexAllowed(request)&&localCodexSignedIn()?{}:null;
}
function aiConfig(request){
 const localAllowed=localCodexAllowed(request);
 return {model:process.env.CODEX_MODEL||'Codex default',provider:'Codex SDK',maxPages:60,localCodex:{allowed:localAllowed,signedIn:localAllowed&&localCodexSignedIn()},encryptionReady:encryptionReady()};
}
async function encryptApiKey(request,userId){
 const {apiKey}=await readBody(request);
 const key=typeof apiKey==='string'?apiKey.trim():'';
 if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)||key.length>300)return json({error:'Enter an OpenAI API key that starts with sk-.'},400);
 if(!encryptionReady())return json({error:'Saved API keys are disabled on this server: set ATLAS_ENCRYPTION_KEY and restart.'},400);
 // Validate with OpenAI itself, the only service the key is ever sent to.
 const check=await fetch('https://api.openai.com/v1/models?limit=1',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)}).catch(()=>null);
 if(!check)return json({error:'Could not reach OpenAI to verify the key. Try again.'},502);
 if(check.status===401)return json({error:'OpenAI rejected this API key.'},400);
 return json({ciphertext:encrypt(key,userId),last4:key.slice(-4)});
}

// A short, user-facing reason for an AI failure (the full error is in the server log).
function aiFailure(e){
 const text=String(e?.message||e||'').replace(/\s+/g,' ');
 if(/Unable to locate Codex|ENOENT/i.test(text))return 'the Codex CLI could not be started on this server. Restart the dev server.';
 if(/401|unauthori[sz]ed|invalid api key|not logged in|login/i.test(text))return 'the AI sign-in was rejected. Reconnect in Settings.';
 if(/429|rate limit|quota|usage limit/i.test(text))return 'your AI usage limit was reached. Try again later.';
 return text.slice(0,240)||'unknown error. See the server log.';
}
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
const asking=globalThis.__atlasAsking ||= new Set();
async function ask(request,userId){
 const {question,context,aiKey}=await readBody(request,1600000);
 if(typeof question!=='string'||question.length>2000||!question.trim())return json({error:'Enter a question under 2,000 characters.'},400);
 if(!context||!Array.isArray(context.entities)||!Array.isArray(context.operations))return json({error:'Open an analysis to ask about it.'},400);
 const ai=aiCredentials(request,userId,aiKey);
 if(!ai)return json({error:'Connect AI in Settings to use Ask Atlas.'},400);
 if(asking.has(userId))return json({error:'Please wait for the current answer.'},429);
 asking.add(userId);
 try{return json({answer:await answerQuestion(context,question,AbortSignal.timeout(100000),ai)})}
 catch(e){console.error('[atlas] ask',e);return json({error:`The AI provider could not answer: ${aiFailure(e)}`},400)}
 finally{asking.delete(userId)}
}
const checking=globalThis.__atlasScenarioChecks ||= new Set();
async function scenarioRules(request,userId){
 const body=await readBody(request,600000);
 const operation=body.operation;
 if(!operation||typeof operation.name!=='string'||typeof operation.path!=='string'||!Array.isArray(operation.inputs))return json({error:'Invalid scenario.'},400);
 if(body.docsUrl&&!/^https?:\/\//i.test(body.docsUrl))return json({error:'Invalid documentation URL.'},400);
 const ai=aiCredentials(request,userId,body.aiKey);
 if(!ai)return json({error:'Connect AI in Settings to check rules.'},400);
 if(checking.has(userId))return json({error:'A rule check is already running. Wait for it to finish.'},429);
 checking.add(userId);
 try{return json(await checkScenarioRules({operation,entityName:String(body.entityName||''),docsUrl:body.docsUrl||null,cases:Array.isArray(body.cases)?body.cases.slice(0,12):[]},ai,AbortSignal.timeout(240000)))}
 catch(e){console.error('[atlas] scenario rules',e);return json({error:e.name==='TimeoutError'?'The AI rule check took too long. Try again.':`The AI rule check failed: ${aiFailure(e)}`},502)}
 finally{checking.delete(userId)}
}

async function dispatch(request,context){
 const {route}=await context.params;const method=request.method;
 try{
  if(method!=='GET'&&request.headers.get('origin')&&new URL(request.headers.get('origin')).host!==request.headers.get('host'))return json({error:'Cross-origin requests are not allowed.'},403);
  const {userId}=await auth();
  if(!userId)return json({error:'Sign in to use Atlas.'},401);
  if(route[0]==='config'&&method==='GET')return json(aiConfig(request));
  if(route[0]==='ai-key'&&route.length===1&&method==='POST')return await encryptApiKey(request,userId);
  if(route[0]==='codex'&&route[1]==='login'&&route.length===2){
   if(!localCodexAllowed(request))return json({error:'Connect Codex is only available on a local development server. Add your own OpenAI API key instead.'},403);
   if(method==='POST')return json(await startDeviceLogin());
   if(method==='GET')return json({...loginStatus(),signedIn:localCodexSignedIn()});
   if(method==='DELETE')return json(cancelDeviceLogin());
  }
  if(route[0]==='scenarios'&&route[1]==='rules'&&route.length===2&&method==='POST')return await scenarioRules(request,userId);
  if(route[0]==='ask'&&route.length===1&&method==='POST')return await ask(request,userId);
  if(route[0]==='try'&&route.length===1&&method==='POST')return await tryIt(request,userId);
  if(route[0]!=='analyses')return json({error:'Route not found.'},404);
  if(route[1]==='normalize'&&route.length===2&&method==='POST'){
   const analysis=await readBody(request,40000000);
   if(!analysis || !Array.isArray(analysis.entities) || !Array.isArray(analysis.operations) || !Array.isArray(analysis.dependencies) || !analysis.coverage)return json({error:'Invalid saved analysis.'},400);
   const upgraded=analysis.coverage.schemaCount===undefined?canonicalizeAnalysis(analysis):analysis.coverage.canonicalVersion>=8?analysis:reconcileResourceEndpoints(analysis);
   return json(normalizeAnalysis(upgraded));
  }
  if(route.length===1&&method==='POST'){const body=await readBody(request);const ai=body.useAI!==false?aiCredentials(request,userId,body.aiKey):null;const job=createJob(body,userId,ai);after(job.run);return json({id:job.id},202);}
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
