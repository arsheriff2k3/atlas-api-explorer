'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, LoaderCircle, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';

import type { useAiKey } from '../aiKey';

// Server-side AI facts; the user's own key status comes from Convex (useAiKey).
export interface AiConfig {
 model:string;maxPages:number;
 localCodex?:{allowed:boolean;signedIn:boolean};
 encryptionReady?:boolean;loadError?:string|null;
}
type AiKey=ReturnType<typeof useAiKey>;
export function aiStatus(config:AiConfig,aiKey:AiKey){
 const keyUsable=aiKey.status.hasKey&&!!config.encryptionReady;
 return {configured:keyUsable||!!config.localCodex?.signedIn,source:keyUsable?'api-key' as const:config.localCodex?.signedIn?'codex' as const:null,keyUsable};
}
interface DeviceLogin {status:string;url:string|null;code:string|null;expiresAt:number|null;error:string|null;signedIn?:boolean}

async function call<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Request failed.');
 return data as T;
}

export default function AiSettings({config,aiKey,onChange}:{config:AiConfig;aiKey:AiKey;onChange:()=>void}){
 const status=aiStatus(config,aiKey);
 return <div className="settings-ai">
  <div className="settings-ai-head"><Sparkles size={18}/><h3>AI reasoning</h3><span className={`example-badge ${status.configured?'live':''}`}>{status.configured?(status.source==='api-key'?'YOUR API KEY':'CODEX CONNECTED'):'NOT CONNECTED'}</span></div>
  <p>{status.configured?`Using ${config.model} to read documentation prose and answer questions.`:'Specification parsing works without AI. Connect AI to read documentation prose, answer questions, and build scenarios.'}</p>
  {config.loadError&&<p className="ai-error">{config.loadError}</p>}
  {config.localCodex?.allowed&&<CodexConnect signedIn={config.localCodex.signedIn} onChange={onChange}/>}
  <ApiKey config={config} aiKey={aiKey} usable={status.keyUsable}/>
  <p className="small"><ShieldCheck size={11}/> Selected public documentation is sent to OpenAI during AI analysis. Your key is encrypted on this server and never returned to the browser.</p>
 </div>;
}

function CodexConnect({signedIn,onChange}:{signedIn:boolean;onChange:()=>void}){
 const [login,setLogin]=useState<DeviceLogin|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [copied,setCopied]=useState(false);
 const pending=login?.status==='pending';
 useEffect(()=>{
  if(!pending)return;
  const timer=setInterval(async()=>{try{const next=await call<DeviceLogin>('/api/codex/login');setLogin(next);if(next.status==='complete'){onChange()}else if(next.status==='failed')setError(next.error||'Codex sign-in failed.')}catch(e){setError((e as Error).message)}},2000);
  return()=>clearInterval(timer);
 },[pending,onChange]);
 async function start(){setBusy(true);setError('');try{const next=await call<DeviceLogin>('/api/codex/login',{method:'POST'});setLogin(next);if(next.status==='failed')setError(next.error||'Codex sign-in failed.')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function cancel(){await call('/api/codex/login',{method:'DELETE'}).catch(()=>{});setLogin(null)}
 return <div className="ai-connection">
  <div className="ai-connection-head"><strong>Codex on this computer</strong><span className={`connection-dot ${signedIn?'on':''}`}/><small>{signedIn?'Signed in with ChatGPT':'Not signed in'}</small></div>
  {!signedIn&&!pending&&<><p>Sign in with your ChatGPT plan through the official Codex login. Only available on a local development server.</p><button className="outline-button" onClick={start} disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<Sparkles size={14}/>}Connect with ChatGPT</button></>}
  {pending&&login?.url&&login.code&&<div className="device-code">
   <p>1. Open the OpenAI sign-in page and sign in to your ChatGPT account.</p>
   <a className="outline-button" href={login.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Open auth.openai.com</a>
   <p>2. Enter this one-time code (expires in 15 minutes):</p>
   <div className="device-code-value"><code>{login.code}</code><button className="icon-button" aria-label="Copy code" onClick={()=>{void navigator.clipboard.writeText(login.code!);setCopied(true);setTimeout(()=>setCopied(false),1500)}}>{copied?<Check size={14}/>:<Copy size={14}/>}</button></div>
   <p className="small">Only enter this code because you just clicked Connect here. If anyone else gave you a code, cancel.</p>
   <div className="device-code-wait"><LoaderCircle size={13} className="spin"/>Waiting for approval…<button className="text-button" onClick={cancel}><X size={12}/>Cancel</button></div>
  </div>}
  {error&&<p className="ai-error">{error}</p>}
 </div>;
}

function ApiKey({config,aiKey,usable}:{config:AiConfig;aiKey:AiKey;usable:boolean}){
 const [value,setValue]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const saved=aiKey.status.hasKey;
 async function save(){setBusy(true);setError('');try{await aiKey.save(value);setValue('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function remove(){setBusy(true);setError('');try{await aiKey.remove()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="ai-connection">
  <div className="ai-connection-head"><strong>Your OpenAI API key</strong><span className={`connection-dot ${usable?'on':''}`}/><small>{saved?`Saved · ends in ${aiKey.status.last4}`:'Works on any Atlas server'}</small></div>
  {!config.encryptionReady?<p>Saved keys are turned off on this server. Set <code>ATLAS_ENCRYPTION_KEY</code> (32+ characters) and restart it.</p>
  :saved?<><p>AI runs on your key and is billed to your OpenAI account.{config.localCodex?.signedIn?' It is used instead of the local Codex login.':''}</p><button className="outline-button" onClick={remove} disabled={busy}><Trash2 size={14}/>Remove key</button></>
  :<form className="api-key-form" onSubmit={event=>{event.preventDefault();void save()}}><label className="sr-only" htmlFor="openai-key">OpenAI API key</label><KeyRound size={14}/><input id="openai-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={value} onChange={event=>setValue(event.target.value)}/><button className="outline-button" type="submit" disabled={busy||!value.trim()}>{busy?<LoaderCircle size={14} className="spin"/>:<Check size={14}/>}Verify & save</button></form>}
  {error&&<p className="ai-error">{error}</p>}
 </div>;
}
