'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowDown, ArrowDownToLine, ArrowUp, Link2, ListPlus, Plus, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { Analysis, Operation } from '../types';
import { buildFlowPlan, flowMarkdown, withMissingSteps } from '../flows';

export default function FlowPanel({analysis,sourceKey,current,onOpen}:{analysis:Analysis;sourceKey:string;current:Operation|null;onOpen:(operation:Operation)=>void}){
 const flows=useQuery(api.flows.list,{sourceKey});
 const create=useMutation(api.flows.create);const update=useMutation(api.flows.update);const remove=useMutation(api.flows.remove);
 const [selectedId,setSelectedId]=useState<string|null>(null);const [error,setError]=useState('');
 const flow=flows?.find(item=>item.id===selectedId)||flows?.[0]||null;
 const plan=useMemo(()=>flow?buildFlowPlan(analysis,flow.operationIds):null,[analysis,flow]);
 const run=(task:Promise<unknown>)=>task.then(()=>setError('')).catch(()=>setError('The flow could not be saved. Try again.'));
 const setSteps=(operationIds:string[])=>{if(flow)void run(update({id:flow.id as Id<'flows'>,name:flow.name,operationIds}))};
 async function newFlow(){const id=await create({sourceKey,name:current?`${current.name} flow`:'New flow',operationIds:current?[current.id]:[]}).catch(()=>{setError('The flow could not be created.');return null});if(id)setSelectedId(id)}
 function move(index:number,delta:number){if(!flow)return;const ids=[...flow.operationIds];const [item]=ids.splice(index,1);ids.splice(index+delta,0,item);setSteps(ids)}
 function exportFlow(){if(!flow||!plan)return;const url=URL.createObjectURL(new Blob([flowMarkdown(analysis,flow.name,plan)],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download=`${flow.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const inFlow=!!(flow&&current&&flow.operationIds.includes(current.id));
 return <div className="flow-panel">
  <div className="flow-panel-head"><Link2 size={15}/><strong>Flows</strong><span>Chain endpoints into one integration plan; IDs pass from each response to the next request.</span>
   {!!flows?.length&&<select aria-label="Flow" value={flow?.id||''} onChange={event=>setSelectedId(event.target.value)}>{flows.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
   <button className="outline-button" onClick={newFlow}><Plus size={13}/>New flow</button>
   {flow&&current&&<button className="outline-button" onClick={()=>setSteps([...flow.operationIds,current.id])} disabled={inFlow} title={inFlow?'Already in this flow':'Add the open scenario as the last step'}><ListPlus size={13}/>{inFlow?'In flow':'Add this scenario'}</button>}
  </div>
  {error&&<p className="ai-error">{error}</p>}
  {flow&&plan&&<div className="flow-panel-body">
   <div className="flow-panel-tools"><input aria-label="Flow name" defaultValue={flow.name} key={flow.id} onBlur={event=>{const name=event.target.value.trim()||flow.name;if(name!==flow.name)void run(update({id:flow.id as Id<'flows'>,name,operationIds:flow.operationIds}))}}/>
    {plan.missing.some(item=>item.create)&&<button className="outline-button" onClick={()=>setSteps(withMissingSteps(analysis,flow.operationIds))}><Wand2 size={13}/>Add {plan.missing.filter(item=>item.create).length} missing step{plan.missing.filter(item=>item.create).length>1?'s':''}</button>}
    <button className="outline-button" onClick={exportFlow} disabled={!plan.calls.length}><ArrowDownToLine size={13}/>Export .md</button>
    <button className="icon-button" aria-label="Delete flow" title="Delete flow" onClick={()=>{if(window.confirm(`Delete the flow “${flow.name}”?`)){void run(remove({id:flow.id as Id<'flows'>}));setSelectedId(null)}}}><Trash2 size={14}/></button></div>
   {!plan.calls.length&&<p className="small muted">Open a scenario below and click <b>Add this scenario</b>.</p>}
   <ol className="flow-calls">{plan.calls.map(call=><li key={`${call.operation.id}:${call.index}`} className={current?.id===call.operation.id?'active':''}>
    <div className="flow-call-head"><small>{String(call.index+1).padStart(2,'0')}</small><button className="flow-call-open" onClick={()=>onOpen(call.operation)}><b className={`method ${call.operation.method}`}>{call.operation.method}</b><strong>{call.operation.name}</strong><code>{call.operation.path}</code></button>
     <span className="flow-call-actions"><button className="icon-button" aria-label="Move up" disabled={call.index===0} onClick={()=>move(call.index,-1)}><ArrowUp size={12}/></button><button className="icon-button" aria-label="Move down" disabled={call.index===plan.calls.length-1} onClick={()=>move(call.index,1)}><ArrowDown size={12}/></button><button className="icon-button" aria-label="Remove step" onClick={()=>setSteps(flow.operationIds.filter((_,index)=>index!==call.index))}><X size={12}/></button></span></div>
    {call.bindings.length>0&&<div className="flow-bindings">{call.bindings.map(binding=><span key={binding.input.name} className={binding.fromStep===null?'missing':''}><code>{binding.input.name}</code>{binding.fromStep===null?<>needs an existing {binding.entity.name}</>:<>← step {binding.fromStep+1} <code>{binding.responseField||'id'}</code></>}</span>)}</div>}
    {call.creates&&<p className="flow-creates"><Sparkles size={11}/>Creates a {call.creates.name}</p>}
   </li>)}</ol>
  </div>}
 </div>;
}
