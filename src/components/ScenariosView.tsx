'use client';
import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, Copy, GitBranch, Quote, Search } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import type { Analysis, Entity } from '../types';
import type { CreationStep } from '../callFlow';
import { SCENARIO_GROUPS, buildScenario, scenariosForEntity } from '../scenarios';
import type { Scenario, ScenarioField, ScenarioRule } from '../scenarios';
import { buildLogicFlow } from '../scenarioFlow';
import LogicFlowView from './LogicFlow';
import PayloadCompare from './PayloadCompare';
import TryIt from './TryIt';
import FlowPanel from './FlowPanel';
import { primaryEntity } from '../flows';
import { scenarioMarkdown } from '../scenarioExport';
import { comparePayload, flattenPayload } from '../payloadCompare';

type CaseFilter = {kind:'spec';id:string;value:string} | null;
interface Step {key:string;step:CreationStep;call:boolean;stage:'existing'|'build'|'call'}

const words = (value:string) => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const mentions = (text:string, entity:Entity) => { const name=words(entity.name); const t=` ${words(text)} `; return t.includes(` ${name} `)||t.includes(` ${name}s `)||t.includes(` ${name.replace(/ /g,'')} `); };
const shortName = (name:string) => name.split('.').at(-1) || name;

export default function ScenariosView({analysis,initialEntityId,sourceKey,onEntityDetails}:{analysis:Analysis;initialEntityId:string|null;sourceKey:string;onEntityDetails:(id:string)=>void}){
 const entities=useMemo(()=>analysis.entities.filter(entity=>scenariosForEntity(analysis,entity.id).length).sort((a,b)=>a.name.localeCompare(b.name)),[analysis]);
 const [entityId,setEntityId]=useState(()=>entities.find(entity=>entity.id===initialEntityId)?.id||entities[0]?.id||'');
 const [query,setQuery]=useState('');
 const list=useMemo(()=>scenariosForEntity(analysis,entityId),[analysis,entityId]);
 const [operationId,setOperationId]=useState<string|null>(null);
 const current=list.find(item=>item.operation.id===operationId)||list[0]||null;
 const scenario=useMemo(()=>current?buildScenario(analysis,entityId,current.operation,current.group):null,[analysis,entityId,current]);
 const filtered=list.filter(item=>`${item.operation.name} ${item.operation.path}`.toLowerCase().includes(query.toLowerCase()));
 const entity=analysis.entities.find(item=>item.id===entityId);
 if(!entity)return <div className="content-view"><p className="small muted">No endpoints create or change an entity in this analysis.</p></div>;
 return <div className="content-view scenarios-view">
  <div className="view-heading"><div className="eyebrow">SCENARIOS</div><h2>How do I create or change a {entity.name}?</h2><p>Each endpoint is one scenario: what must exist first, which cases change the logic, the rules that apply, and the smallest valid request.</p></div>
  <div className="view-toolbar"><select aria-label="Entity" value={entityId} onChange={event=>{setEntityId(event.target.value);setOperationId(null)}}>{entities.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><label className="search-field"><Search size={15}/><input placeholder="Search scenarios…" value={query} onChange={event=>setQuery(event.target.value)}/></label><span className="small muted">{list.length} scenarios</span></div>
  <FlowPanel analysis={analysis} sourceKey={sourceKey} current={current?.operation||null} onOpen={operation=>{const owner=primaryEntity(analysis,operation);const target=owner&&scenariosForEntity(analysis,owner.id).some(item=>item.operation.id===operation.id)?owner.id:entityId;setEntityId(target);setOperationId(operation.id);setQuery('')}}/>
  <div className="scenario-layout">
   <nav className="scenario-list" aria-label="Scenarios">{SCENARIO_GROUPS.map(group=>{const items=filtered.filter(item=>item.group===group.id);if(!items.length)return null;return <div key={group.id}><h4>{group.label} <span>{items.length}</span></h4>{items.map(item=><button key={item.operation.id} className={item.operation.id===current?.operation.id?'active':''} onClick={()=>setOperationId(item.operation.id)}><b className={`method ${item.operation.method}`}>{item.operation.method}</b><span><strong>{item.operation.name}</strong><code>{item.operation.path}</code></span></button>)}</div>})}</nav>
   {scenario&&<ScenarioDetail key={`${entityId}:${scenario.operation.id}`} scenario={scenario} servers={analysis.servers||[]} apiName={analysis.name} sourceKey={sourceKey} onEntityDetails={onEntityDetails}/>}
  </div>
 </div>;
}

function ScenarioDetail({scenario,servers,apiName,sourceKey,onEntityDetails}:{scenario:Scenario;servers:string[];apiName:string;sourceKey:string;onEntityDetails:(id:string)=>void}){
 const {operation}=scenario;
 const [filter,setFilter]=useState<CaseFilter>(null);
 const steps=useMemo(()=>scenarioSteps(scenario),[scenario]);
 const [stepKey,setStepKey]=useState<string>(()=>steps.at(-1)?.key||'');
 const activeStep=steps.find(step=>step.key===stepKey)||steps.at(-1);
 const flow=useMemo(()=>buildLogicFlow(scenario,steps),[scenario,steps]);
 const savedComparison=useQuery(api.payloadComparisons.get,{sourceKey,operationId:operation.id});
 function exportMarkdown(){
  const comparison=savedComparison?.input?comparePayload(flattenPayload(savedComparison.input),scenario.fields,savedComparison.manual):null;
  const markdown=scenarioMarkdown({scenario,flow,comparison,comparisonLabel:savedComparison?.label||'your payload',apiName,steps:steps.map(item=>({name:item.step.entity.name,stage:item.call?'this call':item.stage==='existing'?'must already exist':item.step.terminal?'create first':'create',endpoint:item.step.operation?`${item.step.operation.method} ${item.step.operation.path}`:null}))});
  const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown'}));const link=document.createElement('a');link.href=url;link.download=`${operation.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const specValue=filter?.kind==='spec'?scenario.cases.find(item=>item.id===filter.id)?.values.find(value=>value.value===filter.value):null;
 const specRules=scenario.rules.filter(rule=>!filter||(filter.kind==='spec'&&rule.appliesTo.includes(filter.value)));
 const highlighted=new Set(specValue?.fields||[]);
 return <section className="scenario-detail">
  <header className="scenario-header"><div><b className={`method ${operation.method}`}>{operation.method}</b><code>{operation.path}</code><button className="outline-button scenario-export" onClick={exportMarkdown} title="Download this scenario as Markdown with a Mermaid logic-flow diagram"><ArrowDownToLine size={13}/>Export .md</button></div><h3>{operation.name}</h3><p>{operation.description?operation.description.slice(0,320)+(operation.description.length>320?'…':''):'No description in the specification.'}</p></header>

  {scenario.cases.length>0&&<div className="scenario-block"><h4>CASES <small>Pick one to see only the rules and fields that apply</small></h4><div className="case-chips"><button className={!filter?'active':''} onClick={()=>setFilter(null)}>All cases</button>{scenario.cases.map(item=><span key={item.id} className="case-group"><em>{item.label}</em>{item.values.map(value=><button key={value.value} className={filter?.id===item.id&&filter.value===value.value?'active':''} onClick={()=>setFilter({kind:'spec',id:item.id,value:value.value})}>{value.value}{value.rules.length>0&&<small>{value.rules.length}</small>}</button>)}</span>)}</div></div>}

  <div className="scenario-block"><h4>LOGIC FLOW <small>Prerequisite checks and the cases found in the specification</small></h4><LogicFlowView flow={flow} explain={node=>{const item=node.step&&steps.find(step=>step.step===node.step);return item?<StepExplain item={item} scenario={scenario} onEntityDetails={onEntityDetails}/>:null}}/></div>

  <div className="scenario-block"><h4>BUILD ORDER <small>Click a step to see why it is needed and how to create it</small></h4>
   <ol className="build-steps">{steps.map((item,index)=><li key={item.key}><button className={`${item.key===activeStep?.key?'active':''} ${item.call?'call':''} ${item.stage}`} onClick={()=>setStepKey(item.key)}><small>{String(index+1).padStart(2,'0')}</small><strong>{item.step.entity.name}</strong><span>{item.call?'This call':item.stage==='existing'?'Must already exist':item.step.terminal?'Create first':'Create'}</span></button>{index<steps.length-1&&<ArrowRight size={13}/>}</li>)}</ol>
   {activeStep&&<StepExplain item={activeStep} scenario={scenario} onEntityDetails={onEntityDetails}/>}
  </div>

  <div className="scenario-block"><h4>RULES <small>{filter?'Filtered to the selected case':'All rules for this endpoint'}</small></h4>
   {!specRules.length&&<p className="small muted">No rule sentences found in the specification.</p>}
   <ul className="rule-list">{specRules.map((rule,index)=><RuleItem key={`spec${index}`} source="SPEC" tone="spec" field={rule.field} text={rule.text} scope={rule.appliesTo.join(', ')}/>)}</ul>
  </div>

  <div className="scenario-block"><h4>REQUEST <small>Minimal valid payload from the specification</small></h4><Payload scenario={scenario} highlighted={highlighted}/></div>
  <div className="scenario-block"><h4>COMPARE WITH YOUR PAYLOAD <small>Paste a payload from your system (e.g. CRM Dynamics) to see what maps, what is missing, and what needs a transform</small></h4><PayloadCompare scenario={scenario} sourceKey={sourceKey}/></div>
  <details className="scenario-block try-block"><summary><h4>TRY IT <small>Send this request to the real API with your own credentials</small></h4></summary><TryIt scenario={scenario} servers={servers} sourceKey={sourceKey}/></details>
  {scenario.response.length>0&&<div className="scenario-block"><h4>RESPONSE <small>{scenario.response.length} top-level fields</small></h4><div className="response-fields">{scenario.response.slice(0,40).map(field=><code key={field.name} title={field.description}>{field.name}</code>)}{scenario.response.length>40&&<span className="small muted">+{scenario.response.length-40} more in Endpoints</span>}</div></div>}
 </section>;
}

/** Records that must already exist come first, then what this call itself needs, then the call. */
function scenarioSteps(scenario:Scenario):Step[]{
 const result:Step[]=[];const seen=new Set<string>();
 const push=(step:CreationStep,stage:Step['stage'])=>{const key=`${step.entity.id}:${step.operation?.id||''}`;if(seen.has(key))return;seen.add(key);result.push({key,step,call:stage==='call',stage})};
 const isCall=(step:CreationStep)=>step.operation?.id===scenario.operation.id;
 for(const step of scenario.existingPlan?.steps||[])push(step,'existing');
 const inExisting=new Set(result.map(item=>item.step.entity.id));
 for(const step of scenario.plan.steps)if(!isCall(step)&&!inExisting.has(step.entity.id))push(step,'build');
 const call=scenario.plan.steps.find(isCall);
 if(call)push(call,'call');
 return result;
}

function StepExplain({item,scenario,onEntityDetails}:{item:Step;scenario:Scenario;onEntityDetails:(id:string)=>void}){
 const {step}=item;const entity=step.entity;
 const plan=item.stage==='existing'?scenario.existingPlan:scenario.plan;
 const needs=(plan?.trace.links||[]).filter(link=>link.source===entity.id);
 const needBy=needs.map(link=>({field:link.field,target:(plan?.trace.entities||[]).find(other=>other.id===link.target)?.name||'',documented:link.status==='documented'}));
 const cases=scenario.cases.filter(item=>item.id.startsWith(`${entity.id}:`));
 const specRules:ScenarioRule[]=item.call?scenario.rules.slice(0,6):scenario.rules.filter(rule=>mentions(rule.text,entity)).slice(0,6);
 const provide=step.unmatchedInputs.filter(input=>!/(?:^|\.)id$/i.test(input.name));
 return <div className="step-explain">
  <div className="step-explain-head"><strong>{entity.name}</strong><span>{item.call?'This call':item.stage==='existing'?`Needed because this endpoint works on an existing ${scenario.entity.name}`:step.terminal?'A starting point: nothing else has to exist before it':'Create this before the next step'}</span><button className="text-button" onClick={()=>onEntityDetails(entity.id)}>Entity details<ChevronRight size={12}/></button></div>
  <div className="step-explain-grid">
   <div><h5>WHY IT IS NEEDED</h5>{item.call?<p>This is the request you are making: <code>{scenario.operation.method} {scenario.operation.path}</code>.</p>:needBy.length?<ul>{needBy.map(need=><li key={`${need.field}${need.target}`}><code>{need.field}</code> on <b>{need.target}</b> must hold this {entity.name}’s ID{need.documented?'':' (inferred link)'}.</li>)}</ul>:<p>{item.stage==='existing'?`The path takes the ${scenario.entity.name} ID.`:'Linked through a required ID of a later step.'}</p>}
    {specRules.map((rule,index)=><p key={`s${index}`} className="step-rule spec"><Quote size={11}/>{shortName(rule.field)}: {rule.text}</p>)}
   </div>
   <div><h5>HOW TO CREATE IT</h5>{step.operation?<><p><b className={`method ${step.operation.method}`}>{step.operation.method}</b> <code>{step.operation.path}</code><br/>{step.operation.name}</p>{step.matches.length>0&&<><h6>IDS FROM EARLIER STEPS</h6><ul>{step.matches.map(match=><li key={match.input.name}><code>{match.input.name}</code> ← {match.links.map(link=>(plan?.trace.entities||[]).find(other=>other.id===link.source)?.name).filter(Boolean).join(' or ')}</li>)}</ul></>}{provide.length>0&&<><h6>VALUES YOU PROVIDE</h6><div className="response-fields">{provide.slice(0,14).map(input=><code key={input.name} title={input.description}>{input.name}</code>)}{provide.length>14&&<span className="small muted">+{provide.length-14}</span>}</div></>}</>:<p>No create endpoint was found; use an existing {entity.name} ID.</p>}</div>
  </div>
  {cases.length>0&&<div className="step-cases"><h5>CASES AT THIS STEP</h5>{cases.map(item=><p key={item.id}><b>{item.label}:</b> {item.values.map(value=>`${value.value}${value.rules.length?` (${value.rules.length} rule${value.rules.length>1?'s':''})`:''}`).join(' · ')}</p>)}</div>}
 </div>;
}

function RuleItem({source,tone,field,text,scope}:{source:string;tone:string;field:string;text:string;scope?:string}){
 return <li className={`rule ${tone}`}><div><span className="rule-source">{source}</span>{field&&<code>{field}</code>}{scope&&<em>{scope}</em>}</div><p>{text}</p></li>;
}

const NEED_LABEL:Record<string,string>={required:'Required','one-of':'Choose one',conditional:'Conditional',optional:'Optional'};
function Payload({scenario,highlighted}:{scenario:Scenario;highlighted:Set<string>}){
 const [copied,setCopied]=useState(false);const [showOptional,setShowOptional]=useState(false);
 const json=JSON.stringify(scenario.payload,null,2);
 const groups=(['required','one-of','conditional','optional'] as const).map(need=>[need,scenario.fields.filter(item=>item.need===need)] as const).filter(([,items])=>items.length);
 return <div className="payload-grid">
  <div className="payload-json"><div><span>{scenario.pathParams.length?`Path: ${scenario.pathParams.map(param=>`{${param.name}}`).join(', ')}`:'Request body'}</span><button className="icon-button" aria-label="Copy payload" onClick={()=>{void navigator.clipboard.writeText(json);setCopied(true);setTimeout(()=>setCopied(false),1500)}}>{copied?<Check size={13}/>:<Copy size={13}/>}</button></div><pre>{json}</pre><p className="small muted">Placeholders in &lt;angle brackets&gt; come from earlier steps or your data. Check the rules above for case-specific fields.</p></div>
  <div className="payload-fields">{groups.map(([need,items])=>{const hidden=need==='optional'&&!showOptional;return <div key={need}><h5>{NEED_LABEL[need]} <span>{items.length}</span>{need==='optional'&&<button className="text-button" onClick={()=>setShowOptional(!showOptional)}>{showOptional?'Hide':'Show'}</button>}</h5>{!hidden&&items.slice(0,need==='optional'?60:40).map(item=><FieldRow key={item.field.name} item={item} highlighted={highlighted.has(item.field.name)}/>)}</div>})}</div>
 </div>;
}
function FieldRow({item,highlighted}:{item:ScenarioField;highlighted:boolean}){
 return <div className={`need-field ${highlighted?'highlight':''}`} title={item.rules.map(rule=>rule.text).join('\n')||item.field.description}><code>{item.field.name}</code><span>{item.link?<><GitBranch size={10}/>{item.link.name}</>:item.field.type}</span>{item.rules.length>0&&<small>{item.rules[0].text.slice(0,90)}{item.rules[0].text.length>90?'…':''}</small>}</div>;
}
