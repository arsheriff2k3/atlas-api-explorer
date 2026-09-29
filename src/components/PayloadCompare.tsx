'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, CircleDashed, Copy, X } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import type { Scenario } from '../scenarios';
import { comparePayload, flattenPayload, mappedPayload } from '../payloadCompare';

const KIND_LABEL={exact:'Exact name',name:'Same field name',synonym:'Known synonym',similar:'Similar words',manual:'Your mapping'};
const EXAMPLE=`{
  "name": "Acme Ltd",
  "emailaddress1": "ops@acme.com",
  "telephone1": "+1 555 0100",
  "address1_line1": "1 Main St",
  "address1_city": "Austin",
  "address1_postalcode": "73301",
  "address1_country": "US",
  "transactioncurrencyid": "USD"
}`;

export default function PayloadCompare({scenario,sourceKey}:{scenario:Scenario;sourceKey:string}){
 const operationId=scenario.operation.id;
 const saved=useQuery(api.payloadComparisons.get,{sourceKey,operationId});
 const save=useMutation(api.payloadComparisons.save);
 const [input,setInput]=useState<string|null>(null);const [label,setLabel]=useState<string|null>(null);const [manual,setManual]=useState<Record<string,string>|null>(null);
 const [copied,setCopied]=useState(false);const [saveError,setSaveError]=useState('');
 const text=input??saved?.input??'';const name=label??saved?.label??'CRM Dynamics';const mapping=useMemo(()=>manual??saved?.manual??{},[manual,saved]);
 const dirty=input!==null||label!==null||manual!==null;
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{
  if(!dirty)return;
  clearTimeout(timer.current);
  timer.current=setTimeout(()=>{save({sourceKey,operationId,label:name,input:text,manual:mapping}).then(()=>setSaveError('')).catch(()=>setSaveError('Not saved to your account. Changes are kept on this page.'))},700);
  return()=>clearTimeout(timer.current);
 },[dirty,text,name,mapping,save,sourceKey,operationId]);
 const sources=useMemo(()=>flattenPayload(text),[text]);
 const comparison=useMemo(()=>comparePayload(sources,scenario.fields,mapping),[sources,scenario.fields,mapping]);
 const invalidJson=text.trim().startsWith('{')&&(()=>{try{JSON.parse(text);return false}catch{return true}})();
 const setMap=(path:string,target:string)=>setManual({...mapping,[path]:target});
 const targets=scenario.fields.map(item=>item.field.name);
 const result=JSON.stringify(mappedPayload(comparison),null,2);
 const issues=comparison.matches.filter(match=>match.issues.length).length;
 return <div className="payload-compare">
  <div className="compare-input">
   <label className="form-label">SOURCE SYSTEM<input value={name} onChange={event=>setLabel(event.target.value)} maxLength={120}/></label>
   <label className="form-label">PAYLOAD OR FIELD LIST<textarea value={text} onChange={event=>setInput(event.target.value)} rows={10} spellCheck={false} placeholder={'Paste a JSON payload, or one field per line (e.g. emailaddress1: ops@acme.com)'}/></label>
   <div className="compare-input-actions">{!text&&<button className="text-button" onClick={()=>setInput(EXAMPLE)}>Use a Dynamics account example</button>}{invalidJson&&<span className="ai-error">The JSON is not valid yet; fields are read line by line.</span>}{saveError&&<span className="ai-error">{saveError}</span>}</div>
  </div>
  {sources.length>0&&<div className="compare-result">
   <div className="compare-summary"><div className="coverage-meter" style={{'--value':`${Math.round(comparison.coverage*100)}%`} as React.CSSProperties}><strong>{Math.round(comparison.coverage*100)}%</strong><span>required fields covered</span></div><span><CheckCircle2 size={13}/>{comparison.matches.length} mapped</span><span className={comparison.missing.length?'bad':''}><X size={13}/>{comparison.missing.length} missing</span><span className={issues?'warn':''}><AlertTriangle size={13}/>{issues} need a transform</span><span><CircleDashed size={13}/>{comparison.extra.length} not used</span></div>
   {comparison.missing.length>0&&<div className="compare-group"><h5>MISSING FROM {name.toUpperCase()}</h5>{comparison.missing.map(item=><div key={item.field.name} className="compare-row missing"><code>{item.field.name}</code><span>{item.link?`ID from ${item.link.name}  -  create or look it up first`:item.need==='one-of'?'Provide one of this group':'Required by the API'}</span></div>)}</div>}
   <div className="compare-group"><h5>MAPPED <span>{comparison.matches.length}</span></h5>{comparison.matches.map(match=><div key={match.source.path} className={`compare-row ${match.issues.length?'warn':''}`}><code title={match.source.sample}>{match.source.path}</code><ArrowRight size={12}/><select aria-label={`API field for ${match.source.path}`} value={match.target.field.name} onChange={event=>setMap(match.source.path,event.target.value)}>{targets.map(target=><option key={target}>{target}</option>)}</select><em>{KIND_LABEL[match.kind]}</em><button className="icon-button" aria-label={`Do not map ${match.source.path}`} title="Do not map" onClick={()=>setMap(match.source.path,'')}><X size={12}/></button>{match.issues.map(issue=><small key={issue}>{issue}</small>)}</div>)}</div>
   {comparison.extra.length>0&&<div className="compare-group"><h5>NOT USED BY THIS ENDPOINT <span>{comparison.extra.length}</span></h5>{comparison.extra.map(source=><div key={source.path} className="compare-row extra"><code title={source.sample}>{source.path}</code><ArrowRight size={12}/><select aria-label={`Map ${source.path}`} value="" onChange={event=>setMap(source.path,event.target.value)}><option value="">Map to an API field…</option>{targets.map(target=><option key={target}>{target}</option>)}</select></div>)}</div>}
   {comparison.review.length>0&&<details className="compare-group"><summary>CONDITIONAL FIELDS TO REVIEW ({comparison.review.length})</summary>{comparison.review.map(item=><div key={item.field.name} className="compare-row"><code>{item.field.name}</code><span>{item.rules[0]?.text||'Needed in some cases'}</span></div>)}</details>}
   <div className="compare-group"><h5>REQUEST BUILT FROM YOUR VALUES<button className="icon-button" aria-label="Copy mapped request" onClick={()=>{void navigator.clipboard.writeText(result);setCopied(true);setTimeout(()=>setCopied(false),1500)}}>{copied?<Check size={13}/>:<Copy size={13}/>}</button></h5><pre>{result}</pre></div>
  </div>}
 </div>;
}
