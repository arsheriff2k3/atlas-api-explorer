'use client';
import { useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, Play } from 'lucide-react';
import type { Scenario } from '../scenarios';
import { readBrandStorage } from '../brandStorage';

type Auth='none'|'bearer'|'basic'|'header';
const PREFS='apipassage-try-prefs';

// Sends the scenario's request to the real API through the APIPassage server (public hosts
// only). Credentials stay in this page's memory and are sent with each request only.
export default function TryIt({scenario,servers,sourceKey}:{scenario:Scenario;servers:string[];sourceKey:string}){
 const {operation}=scenario;
 const saved=useMemo(()=>{try{return JSON.parse(readBrandStorage(PREFS,'atlas-try-prefs')||'{}')[sourceKey]||{}}catch{return {}}},[sourceKey]);
 const [baseUrl,setBaseUrl]=useState<string>(saved.baseUrl||servers[0]||'');
 const [auth,setAuth]=useState<Auth>(saved.auth||'bearer');const [headerName,setHeaderName]=useState<string>(saved.headerName||'X-API-Key');
 const [secret,setSecret]=useState('');const [password,setPassword]=useState('');
 const [params,setParams]=useState<Record<string,string>>({});
 const form=/x-www-form-urlencoded/i.test(operation.contentType||'');
 const [arrayStyle,setArrayStyle]=useState<'suffix'|'index'>(saved.arrayStyle||'suffix');
 const hasBody=!/^(?:GET|HEAD|DELETE)$/.test(operation.method);
 const [body,setBody]=useState(()=>JSON.stringify(scenario.payload,null,2));
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [result,setResult]=useState<{status:number;statusText:string;headers:Record<string,string>;body:string;truncated:boolean;durationMs:number;redirectedTo:string|null}|null>(null);
 const path=operation.path.replace(/\{([^}]+)\}/g,(match,name)=>params[name]?encodeURIComponent(params[name]):match);
 const url=`${baseUrl.replace(/\/$/,'')}${path}`;
 const host=(()=>{try{return new URL(baseUrl.replace(/\{[^}]+\}/g,'x')).hostname}catch{return ''}})();
 async function send(){
  setBusy(true);setError('');setResult(null);
  try{
   if(new URL(url).protocol!=='https:')throw new Error('Try It requires an HTTPS base URL.');
   let parsed:unknown=null;
   if(hasBody&&body.trim()){try{parsed=JSON.parse(body)}catch{throw new Error('The request body must be valid JSON (it is converted to form fields when the endpoint expects them).')}}
   const headers:Record<string,string>={};
   if(auth==='bearer'&&secret)headers.Authorization=`Bearer ${secret}`;
   if(auth==='basic'&&secret)headers.Authorization=`Basic ${btoa(`${secret}:${password}`)}`;
   if(auth==='header'&&secret&&headerName)headers[headerName]=secret;
   try{const prefs=JSON.parse(readBrandStorage(PREFS,'atlas-try-prefs')||'{}');prefs[sourceKey]={baseUrl,auth,headerName,arrayStyle};localStorage.setItem(PREFS,JSON.stringify(prefs))}catch{}
   const response=await fetch('/api/try',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,method:operation.method,headers,body:hasBody?parsed:null,contentType:operation.contentType||'application/json',arrayStyle})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'The request failed.');
   setResult(data);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const pretty=result?(()=>{try{return JSON.stringify(JSON.parse(result.body),null,2)}catch{return result.body}})():'';
 return <div className="try-it">
  <p className="try-warning"><AlertTriangle size={13}/>Sends a real {operation.method} request{host?<> to <b>{host}</b></>:''} over HTTPS. Use a test or sandbox account; write requests change real data. Credentials are not saved.</p>
  <div className="try-grid">
   <label className="form-label">BASE URL{servers.length>1?<select value={servers.includes(baseUrl)?baseUrl:''} onChange={event=>event.target.value&&setBaseUrl(event.target.value)}><option value="">Custom…</option>{servers.map(server=><option key={server}>{server}</option>)}</select>:null}<input value={baseUrl} onChange={event=>setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false}/></label>
   <label className="form-label">AUTHENTICATION<select value={auth} onChange={event=>setAuth(event.target.value as Auth)}><option value="bearer">Bearer token</option><option value="basic">Basic (username / API key)</option><option value="header">API key header</option><option value="none">None</option></select></label>
   {auth==='header'&&<label className="form-label">HEADER NAME<input value={headerName} onChange={event=>setHeaderName(event.target.value)}/></label>}
   {auth!=='none'&&<label className="form-label">{auth==='basic'?'USERNAME OR API KEY':'TOKEN OR KEY'}<input type="password" autoComplete="off" value={secret} onChange={event=>setSecret(event.target.value)}/></label>}
   {auth==='basic'&&<label className="form-label">PASSWORD <span>OFTEN EMPTY FOR API KEYS</span><input type="password" autoComplete="off" value={password} onChange={event=>setPassword(event.target.value)}/></label>}
   {scenario.pathParams.map(param=><label key={param.name} className="form-label">{`{${param.name}}`}<input value={params[param.name]||''} onChange={event=>setParams({...params,[param.name]:event.target.value})}/></label>)}
   {form&&hasBody&&<label className="form-label">FORM ARRAYS<select value={arrayStyle} onChange={event=>setArrayStyle(event.target.value as 'suffix'|'index')}><option value="suffix">items[field][0] (index last)</option><option value="index">items[0][field] (index first)</option></select></label>}
  </div>
  {hasBody&&<label className="form-label">REQUEST BODY (JSON{form?', sent as form fields':''})<textarea rows={8} value={body} onChange={event=>setBody(event.target.value)} spellCheck={false}/></label>}
  <div className="try-send"><code>{operation.method} {url}</code><button className="primary-button" onClick={send} disabled={busy||!baseUrl}>{busy?<LoaderCircle size={14} className="spin"/>:<Play size={14}/>}Send request</button></div>
  {error&&<p className="ai-error">{error}</p>}
  {result&&<div className="try-result"><div className={`try-status ${result.status<300?'ok':result.status<500?'warn':'bad'}`}><b>{result.status}</b> {result.statusText} · {result.durationMs} ms{result.redirectedTo&&<> · redirect to {result.redirectedTo} (not followed)</>}{result.truncated&&' · response truncated at 256 KB'}</div><pre>{pretty||'(empty body)'}</pre><details><summary>Response headers</summary><pre>{Object.entries(result.headers).map(([name,value])=>`${name}: ${value}`).join('\n')}</pre></details></div>}
 </div>;
}
