'use client';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Share2, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Box, Boxes, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Code2, Command, Compass, FileText, Focus, GitBranch, Globe2, Layers3, Link2, LoaderCircle, Maximize2, Menu, Network, Plus, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Workflow, X } from 'lucide-react';
import type { Analysis, Dependency, SavedAnalysis, View } from './types';
import { displayName, isEndpoint } from './types';
import { orderEntities } from './ordering';
import type { EntitySort } from './ordering';
import { demo } from './demo';
import { sourceKeyFor, templateFor, templateForUrls } from './projectSources';
import { applyLinkReviews, linkKey } from './linkReviews';
import type { LinkVerdict } from './linkReviews';
import type { ProjectTemplate } from './projectSources';
import { useQuery as useConvexQuery, useMutation as useConvexMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import ScenariosView from './components/ScenariosView';
import { UserButton, useUser } from '@clerk/nextjs';
import { useSavedAnalyses } from './savedAnalyses';
import Graph from './components/Graph';
import Inspector from './components/Inspector';
import WorkspaceHome from './components/WorkspaceHome';
import AppModals from './components/AppModals';
import { GraphBoundary, Metric, download } from './components/ui';
import ThemeToggle from './components/ThemeToggle';
import Tour, { TOUR_KEY } from './components/Tour';
import { useAnalysisJob } from './useAnalysisJob';
import { changeCount, diffAnalyses } from './analysisDiff';
import ChangesPanel from './components/ChangesPanel';
import SharePanel from './components/SharePanel';
import { readMap } from './savedAnalyses';
import { useConvex } from 'convex/react';
import EntityStepper from './components/EntityStepper';
import BacktrackPanel from './components/BacktrackPanel';
import { entityTourSlice } from './entityTour';
import { traceConnections } from './backtrack';
import type { TraceDirection } from './backtrack';
import { keyOverviewLinks } from './graphOverview';
import { filterTraceByRequirement, requirementForDependency } from './requirements';
import { buildCreationPlan, creationOperationForEntity, operationsForEntity, requiredCallFlow } from './callFlow';
import type { Requirement, RequirementFilter } from './requirements';
import { DependenciesView, Empty, OperationsView, PatternsView, SourcesView, StudyView } from './components/Views';
const Graph3D=lazy(()=>import('./components/Graph3D'));
const tabs:{id:View;label:string;icon:typeof Network}[]=[{id:'graph',label:'Dependency map',icon:Network},{id:'dependencies',label:'ID lineage',icon:GitBranch},{id:'operations',label:'Endpoints',icon:Code2},{id:'scenarios',label:'Scenarios',icon:Workflow},{id:'study',label:'Study path',icon:BookOpen}];

export default function App(){
 const [rawAnalysis,setAnalysis]=useState<Analysis>(demo);
 // Every view works on the reviewed map: confirmed links count as documented, rejected links are hidden.
 const linkReviews=useConvexQuery(api.linkReviews.list,rawAnalysis.demo?'skip':{sourceKey:sourceKeyFor(rawAnalysis.urls)});const setLinkReview=useConvexMutation(api.linkReviews.set);
 const {analysis,rejected:rejectedLinks}=useMemo(()=>applyLinkReviews(rawAnalysis,(linkReviews||{}) as Record<string,LinkVerdict>),[rawAnalysis,linkReviews]);
 const [view,setView]=useState<View>('workspace');const [selected,setSelected]=useState<string|null>('subscription');const [edge,setEdge]=useState<Dependency|null>(null);
 const [detailOpen,setDetailOpen]=useState(false);
 const [traceTarget,setTraceTarget]=useState<string|null>(null);const [selectedCallId,setSelectedCallId]=useState<string|null>(null);const [traceDirection,setTraceDirection]=useState<TraceDirection>('prerequisites');const [traceScope,setTraceScope]=useState<'direct'|'full'>('direct');const [requirementFilter,setRequirementFilter]=useState<RequirementFilter>('all');
 const [url,setUrl]=useState('');const [extraUrls,setExtraUrls]=useState('');const [query,setQuery]=useState('');const [group,setGroup]=useState('all');const [evidence,setEvidence]=useState('all');const [focus,setFocus]=useState(false);const [dimension,setDimension]=useState('2d');
 const [modal,setModal]=useState<string|null>(null);const [fullGraph,setFullGraph]=useState(false);const [showExport,setShowExport]=useState(false);const [showSidebar,setShowSidebar]=useState(false);
 const [error,setError]=useState('');const [toast,setToast]=useState('');
 const reviewLink=useCallback((link:Dependency,verdict:LinkVerdict|null)=>{if(rawAnalysis.demo)return;void setLinkReview({sourceKey:sourceKeyFor(rawAnalysis.urls),linkKey:linkKey(link),verdict:verdict||undefined}).catch(()=>setError('Your link review could not be saved. Try again.'))},[rawAnalysis,setLinkReview]);const {history,ready:historyReady,save:saveAnalysis,open:openSavedAnalysis,remove:removeSavedAnalysis}=useSavedAnalyses();const {user}=useUser();const [openingSaved,setOpeningSaved]=useState(false);
 const [maxPages,setMaxPages]=useState(24);const [nodeLimit,setNodeLimit]=useState(30);const [fitKey,setFitKey]=useState(0);
 const [linkScope,setLinkScope]=useState<'key'|'all'>('key');
 const [entitySort,setEntitySort]=useState<EntitySort>('dependency');
 const [tourStep,setTourStep]=useState(0);const [tourActive,setTourActive]=useState(false);
 const handledRoute=useRef<string|null|undefined>(undefined);
 const params=useSearchParams();const router=useRouter();
 // The URL is the source of truth for what is open: ?analysis=<id>&tab=<view>, or ?project=<example key>.
 const routeAnalysis=params.get('analysis');const routeProject=params.get('project');const routeTab=params.get('tab') as View|null;
 const routeShare=params.get('share');
 const routeKey=`${routeAnalysis||''}|${routeProject||''}|${routeShare||''}`;
 const convexClient=useConvex();const [sharedBy,setSharedBy]=useState<string|null>(null);const [showShare,setShowShare]=useState(false);
 const [saveFailure,setSaveFailure]=useState<{analysis:Analysis;replaceId?:string}|null>(null);
 const [touring,setTouring]=useState(false);const [showChanges,setShowChanges]=useState(false);
 const urlInput=useRef<HTMLInputElement>(null);const searchInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();searchInput.current?.focus()}if(event.key==='Escape'){setModal(null);setShowExport(false);setFullGraph(false)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
 useEffect(()=>{if(!toast)return;const timeout=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(timeout)},[toast]);
 useEffect(()=>{if(!fullGraph)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[fullGraph]);
 const loadAnalysis=useCallback((next:Analysis)=>{try{if(!localStorage.getItem(TOUR_KEY))setTouring(true)}catch{}const first=orderEntities(next.entities,next.dependencies,'dependency')[0];setAnalysis(next);setTourStep(0);setTourActive(!!first);setSelected(first?.id||null);setEdge(null);setDetailOpen(false);setTraceTarget(null);setGroup('all');setQuery('');setEvidence('all');setView('graph');setEntitySort('dependency');setLinkScope('key');setNodeLimit(30);setFitKey(k=>k+1);setShowSidebar(false);},[]);
 const openSaved=useCallback(async (saved:SavedAnalysis,tab?:View|null)=>{setError('');setOpeningSaved(true);try{loadAnalysis(await openSavedAnalysis(saved));if(tab&&tab!=='workspace')setView(tab)}catch(e){setError((e as Error).message)}finally{setOpeningSaved(false)}},[loadAnalysis,openSavedAnalysis]);
 const {job,starting,running:jobRunning,launch:launchAnalysis,cancel}=useAnalysisJob({maxPages,
  onStart:()=>{setError('');setModal(null)},
  onError:message=>setError(message),
  onToast:message=>setToast(message),
  onComplete:async (fresh,replaced)=>{
   // On a rerun, record what changed since the previous map before it is replaced.
   let result=fresh;const previousSaved=replaced?history.find(item=>item.id===replaced):null;
   if(previousSaved){try{const previous=await openSavedAnalysis(previousSaved);result={...fresh,changes:diffAnalyses(previous,fresh)}}catch{}}
   loadAnalysis(result);if(result.changes)setShowChanges(true);setToast(replaced?'Analysis refreshed and saved to your account.':'Your API map is ready and saved to your account.');setSaveFailure(null);void saveAnalysis(result,replaced||undefined).catch(()=>setSaveFailure({analysis:result,replaceId:replaced||undefined}))},
 });
 const running=jobRunning;
 const startTemplate=useCallback((template:ProjectTemplate)=>{
  const saved=history.find(item=>item.sourceKey===sourceKeyFor(template.urls));
  if(saved){void openSaved(saved);return}
  setUrl(template.urls[0]);setExtraUrls(template.urls.slice(1).join('\n'));void launchAnalysis(template.urls);
 },[history,openSaved,launchAnalysis]);
 useEffect(()=>{
  if(!historyReady||handledRoute.current===routeKey)return;
  handledRoute.current=routeKey;
  if(routeShare){
   setOpeningSaved(true);setError('');
   convexClient.query(api.shares.open,{token:routeShare}).then(async shared=>{
    if(!shared?.url)throw new Error('This share link is invalid or was revoked.');
    const response=await fetch(shared.url);if(!response.ok)throw new Error('The shared project could not be downloaded.');
    loadAnalysis(await readMap(response));setSharedBy(shared.ownerName);
   }).catch((e:Error)=>{setError(e.message);setView('workspace')}).finally(()=>setOpeningSaved(false));
   return;
  }
  setSharedBy(null);
  const saved=routeAnalysis?history.find(item=>item.id===routeAnalysis):null;
  if(saved){if(saved.id!==analysis.id)void openSaved(saved,routeTab);else if(routeTab)setView(routeTab);return}
  if(routeAnalysis){setError('That saved project was not found in your account.');setView('workspace');return}
  const template=templateFor(routeProject);
  if(template){startTemplate(template);return}
  setView('workspace');
 },[historyReady,routeKey,routeAnalysis,routeProject,routeShare,routeTab,history,analysis.id,openSaved,startTemplate,convexClient,loadAnalysis]);
 // Keep the URL in step with the open project and tab so reload, back, and shared links restore it.
 useEffect(()=>{
  const saved=!analysis.demo&&history.some(item=>item.id===analysis.id);
  const next=view==='workspace'||!saved?'/':`/?analysis=${encodeURIComponent(analysis.id)}${view==='graph'?'':`&tab=${view}`}`;
  const current=`${window.location.pathname}${window.location.search}`;
  if(routeShare&&view!=='workspace')return;
  if(next===current||(next==='/'&&(routeProject||(routeAnalysis&&view!=='workspace'))))return;
  handledRoute.current=next==='/'?'|':`${analysis.id}|`;
  router.replace(next,{scroll:false});
 },[view,analysis.id,analysis.demo,history,router,routeProject,routeAnalysis,routeShare]);
 function showProjects(){setView('workspace');setFullGraph(false);setTraceTarget(null);setShowSidebar(false);}
 function openFromNav(saved:SavedAnalysis){return (event:{preventDefault:()=>void})=>{event.preventDefault();setShowSidebar(false);setFullGraph(false);if(saved.id===analysis.id&&view!=='workspace')return;void openSaved(saved)}}
 function startAnalysis(){
  const urls=[url,...extraUrls.split(/\n/)].map(u=>u.trim()).filter(Boolean);
  if(!urls.length){urlInput.current?.focus();setError('Paste a documentation or OpenAPI URL to get started.');return}
  if(urls.length>4){setError('Use up to four documentation sources in one analysis.');return}
  try{urls.forEach(u=>{const parsed=new URL(u);if(!/^https?:$/.test(parsed.protocol))throw new Error()})}catch{setError('Use complete URLs starting with https:// or http://.');return}
  void launchAnalysis(urls);
 }
 function rerunAnalysis(saved:Pick<Analysis,'id'|'urls'|'mode'>){if(running||!saved.urls.length)return;setUrl(saved.urls[0]);setExtraUrls(saved.urls.slice(1).join('\n'));void launchAnalysis(saved.urls,saved.id)}
 const orderedEntities=useMemo(()=>orderEntities(analysis.entities,analysis.dependencies,entitySort),[analysis,entitySort]);
 const entityRank=useMemo(()=>new Map(orderedEntities.map((e,i)=>[e.id,i+1])),[orderedEntities]);
 const tourData=useMemo(()=>entityTourSlice(analysis,orderedEntities,tourStep),[analysis,orderedEntities,tourStep]);
 const requirementById=useMemo(()=>new Map(analysis.dependencies.map(link=>[link.id,requirementForDependency(analysis,link)] as [string,Requirement])),[analysis]);
 const callOperations=useMemo(()=>traceTarget?operationsForEntity(analysis,traceTarget):[],[analysis,traceTarget]);
 const callOperation=callOperations.find(operation=>operation.id===selectedCallId)||callOperations[0]||null;
 const callFlow=useMemo(()=>traceTarget&&callOperation?requiredCallFlow(analysis,traceTarget,callOperation,analysis.dependencies.filter(link=>evidence==='all'||link.status===evidence)):null,[analysis,traceTarget,callOperation,evidence]);
 const creationRootOperation=traceTarget?(callOperation?.method==='POST'&&/\b(?:create|add|provision|register)\b/i.test(callOperation.name)?callOperation:creationOperationForEntity(analysis,traceTarget)):null;
 const creationPlan=useMemo(()=>traceTarget?buildCreationPlan(analysis,traceTarget,creationRootOperation,analysis.dependencies.filter(link=>evidence==='all'||link.status===evidence)):null,[analysis,traceTarget,creationRootOperation,evidence]);
 const trace=useMemo(()=>{if(!traceTarget)return null;if(requirementFilter==='creation'&&traceDirection==='prerequisites')return creationPlan?.trace||traceConnections({...analysis,dependencies:[]},traceTarget,'prerequisites',1);if(requirementFilter==='call'&&traceDirection==='prerequisites')return callFlow?.trace||traceConnections({...analysis,dependencies:[]},traceTarget,'prerequisites',1);const base=traceConnections({...analysis,dependencies:analysis.dependencies.filter(link=>evidence==='all'||link.status===evidence)},traceTarget,traceDirection,traceScope==='direct'?1:Infinity);return filterTraceByRequirement(base,traceDirection,requirementFilter,requirementById)},[analysis,traceTarget,traceDirection,traceScope,evidence,requirementFilter,requirementById,callFlow,creationPlan]);
 const traceRanks=useMemo(()=>trace?new Map((traceDirection==='dependents'?[...trace.groups].reverse().flatMap(group=>group.entities):trace.entities).map((entity,index)=>[entity.id,index+1])):entityRank,[trace,traceDirection,entityRank]);
 const groups=useMemo(()=>[...new Set(orderedEntities.map(e=>e.group))],[orderedEntities]);
 function selectEntity(id:string){setSelected(id);setEdge(null);const index=orderedEntities.findIndex(e=>e.id===id);if(index>=0)setTourStep(index)}
 function openEntityDetails(id:string){selectEntity(id);setDetailOpen(true)}
 function openDependencyDetails(dependency:Dependency){setEdge(dependency);setDetailOpen(true)}
 function startTrace(id:string,direction:TraceDirection='prerequisites'){setTraceTarget(id);setSelectedCallId(null);setTraceDirection(direction);setTraceScope('full');setRequirementFilter(direction==='prerequisites'?'creation':'all');setSelected(id);setEdge(null);setDetailOpen(false);setFocus(false);setGroup('all');setQuery('');setEvidence(analysis.dependencies.some(d=>(direction==='prerequisites'?d.target:d.source)===id&&d.status==='documented')?'documented':'all');setView('graph');setFitKey(k=>k+1)}
 function stopTrace(){setTraceTarget(null);setTourActive(true);setFitKey(k=>k+1)}
 function explore(id:string){selectEntity(id);setView('graph');setQuery('');setGroup('all');setFitKey(k=>k+1)}
 function goEntityStep(index:number){if(index<0||index>=orderedEntities.length)return;setTraceTarget(null);setTourStep(index);setTourActive(true);setSelected(orderedEntities[index].id);setEdge(null);setGroup('all');setQuery('');setView('graph');setFitKey(k=>k+1)}
 const filteredEntities=useMemo(()=>{if(trace)return trace.entities;const stepIds=tourActive?new Set(tourData.all.map(e=>e.id)):null;return orderedEntities.filter(e=>(!stepIds||stepIds.has(e.id))&&(group==='all'||e.group===group)&&`${e.name} ${e.description} ${e.fields.map(f=>f.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()))},[orderedEntities,tourData,tourActive,group,query,trace]);
 const visibleEntities=useMemo(()=>{if(trace)return filteredEntities;const items=filteredEntities.slice(0,nodeLimit);const active=filteredEntities.find(e=>e.id===selected);if(active&&!items.includes(active))items[items.length?items.length-1:0]=active;return items},[filteredEntities,nodeLimit,selected,trace]);
 const visibleIds=new Set(visibleEntities.map(e=>e.id));
 const allVisibleDependencies=(trace?trace.links:analysis.dependencies.filter(d=>visibleIds.has(d.source)&&visibleIds.has(d.target)));
 const visibleDependencies=(trace||tourActive||linkScope==='all'?allVisibleDependencies:keyOverviewLinks(allVisibleDependencies,visibleEntities)).filter(d=>evidence==='all'||d.status===evidence);
 const entity=analysis.entities.find(e=>e.id===selected)||null;
 const documented=analysis.dependencies.filter(d=>d.status==='documented').length;
 const inspectorVisible=detailOpen&&(view==='graph'||view==='dependencies')&&(!!entity||!!edge);
 function exportData(format:string){setShowExport(false);if(format==='json')download('atlas-api-analysis.json',JSON.stringify(analysis,null,2),'application/json');else{const text=`# ${analysis.name}\n\nAnalyzed: ${analysis.createdAt}\nMode: ${analysis.mode}\n\n## Entities\n\n${analysis.entities.map(e=>`### ${e.name}\n${e.description}\nSource: ${e.source}\n\n${e.fields.map(f=>`- ${f.name} (${f.type}${f.required?', required':''}): ${f.description}`).join('\n')}`).join('\n\n')}\n\n## Dependencies\n\n${analysis.dependencies.map(d=>`- ${analysis.entities.find(e=>e.id===d.source)?.name} → ${analysis.entities.find(e=>e.id===d.target)?.name}: ${d.field} [${d.status}]\n  ${d.evidence}\n  Source: ${d.sourceUrl}`).join('\n')}\n\n## Coverage\n${analysis.warnings.join('\n')}`;download('atlas-api-study-notes.md',text,'text/markdown')}setToast('Export downloaded.')}
 return <div className={`app-shell ${fullGraph?'full-graph':''}`}>
  {showSidebar&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setShowSidebar(false)}/>}
  <aside className={`sidebar ${showSidebar?'mobile-open':''}`}>
   <Link className="brand" href="/" onClick={showProjects}><span className="brand-mark"><Network size={24}/></span>atlas<span className="brand-dot">.</span></Link>
   <Link className="workspace-switch" href="/" onClick={showProjects}><span className="workspace-avatar">P</span><span><strong>Personal workspace</strong><small>Your space to explore</small></span><ChevronDown size={13}/></Link>
   <button className="new-analysis" onClick={()=>{setModal('new');setShowSidebar(false)}}><Plus size={15}/>New analysis<span>↗</span></button>
   <div className="nav-section-label">WORKSPACE</div><nav className="main-nav">
    <Link href="/" onClick={showProjects} className={view==='workspace'?'active':''}><Layers3 size={17}/>All projects</Link>
    {[{id:'graph' as View,icon:Compass,label:'API explorer'},{id:'operations' as View,icon:Layers3,label:'API library'},{id:'study' as View,icon:BookOpen,label:'Study path'}].map(n=><button key={n.id} className={view===n.id||n.id==='graph'&&view==='dependencies'?'active':''} onClick={()=>{setView(n.id);setShowSidebar(false)}}><n.icon size={17}/>{n.label}{n.id==='study'&&<span className="nav-pill">30 min</span>}</button>)}
   </nav>
   <div className="nav-section-label sources-label">PROJECTS <button className="icon-button" aria-label="New project" onClick={()=>{setModal('new');setShowSidebar(false)}}><Plus size={14}/></button></div><div className="project-nav">{history.slice(0,8).map(item=>{const template=templateForUrls(item.urls);return <Link key={item.id} href={`/?analysis=${encodeURIComponent(item.id)}`} onClick={openFromNav(item)} className={view!=='workspace'&&analysis.id===item.id?'active':''} aria-current={view!=='workspace'&&analysis.id===item.id?'page':undefined}><span className="project-nav-icon">{(template?.badge||item.name).charAt(0).toUpperCase()}</span><span>{template?.name||displayName(item.name)}<small>{item.entityCount} entities · {item.operationCount} endpoints</small></span><ChevronRight size={13}/></Link>})}{historyReady&&!history.length&&<p className="project-nav-empty">No projects yet. Paste a URL above or start from an example.</p>}{history.length>8&&<Link href="/" onClick={showProjects}>All {history.length} projects<ArrowRight size={12}/></Link>}</div>
   {view!=='workspace'&&<>
   <div className="nav-section-label sources-label">YOUR SOURCES <button className="icon-button" aria-label="Add API source" onClick={()=>setModal('new')}><Plus size={14}/></button></div>
   <button className="source-nav active" onClick={()=>{setView('graph');setGroup('all')}}><span className="api-avatar">{displayName(analysis.name).charAt(0)}</span><span>{displayName(analysis.name)}<small>{analysis.demo?'Example workspace':'Specification analysis'}</small></span><ChevronDown size={13}/></button>
   <div className="entity-nav">{groups.slice(0,7).map(g=><button key={g} className={group===g?'selected':''} onClick={()=>{setGroup(group===g?'all':g);setTourActive(false);setView('graph');setShowSidebar(false);setFitKey(k=>k+1)}}><span className="nav-tree-branch"/><span>{g}</span><small>{analysis.entities.filter(e=>e.group===g).length}</small></button>)}{groups.length>7&&<button onClick={()=>{setView('graph');setGroup('all');setTourActive(false);setNodeLimit(100)}}><span className="nav-tree-branch"/>All {groups.length} groups<ArrowRight size={12}/></button>}</div>
   <div className="nav-section-label entity-order-label">ENTITY READING ORDER <span>01 → {String(orderedEntities.length).padStart(2,'0')}</span></div>
   <div className="entity-order-list">{orderedEntities.slice(0,10).map(e=><button key={e.id} className={selected===e.id?'selected':''} title={`${entityRank.get(e.id)} · ${e.name}`} onClick={()=>{goEntityStep((entityRank.get(e.id)||1)-1);setShowSidebar(false)}}><small>{String(entityRank.get(e.id)).padStart(2,'0')}</small><span>{e.name}</span><ChevronRight size={12}/></button>)}{orderedEntities.length>10&&<span className="entity-order-more">+ {orderedEntities.length-10} more · see entity walkthrough</span>}</div>
   </>}
   <div className="sidebar-bottom"><div className="study-promo"><span className="promo-icon"><Sparkles size={17}/></span><strong>Go from docs to clarity.</strong><p>Your next API, understood<br/>one connection at a time.</p><button onClick={()=>setView('study')}>Start your study path <ArrowUpRight size={13}/></button></div><ThemeToggle/><button className="bottom-nav" onClick={()=>setModal('settings')}><Settings2 size={16}/>Settings<span className="connection-dot on"/></button><button className="bottom-nav" onClick={()=>setModal('help')}><CircleHelp size={16}/>How Atlas works<ArrowUpRight size={13}/></button><div className="profile"><UserButton/><div><strong>{user?.fullName||user?.username||'Your workspace'}</strong><small>{user?.primaryEmailAddress?.emailAddress||'Signed in'}</small></div><ShieldCheck size={16}/></div></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setShowSidebar(true)}><Menu size={19}/></button><Layers3 size={15}/><Link href="/" onClick={showProjects}>Workspace</Link><ChevronRight size={12}/><strong>{view==='workspace'?'Projects':'API explorer'}</strong><span className="beta-badge">BETA</span></div><div className="topbar-actions">{view!=='workspace'&&<><button className="text-button" onClick={()=>setView('sources')}><FileText size={14}/>Sources</button><span className="topbar-divider"/><div className="export-container"><button className="outline-button export-button" onClick={()=>setShowExport(!showExport)}><ArrowDownToLine size={14}/>Export<ChevronDown size={12}/></button>{showExport&&<div className="export-menu"><button onClick={()=>exportData('json')}><Code2 size={14}/>Analysis JSON</button><button onClick={()=>exportData('md')}><FileText size={14}/>Study notes (.md)</button></div>}</div></>}<span className="top-avatar"><UserButton/></span></div></header>
   <main className="main-content"><section className="intro"><div className="intro-copy"><div><h1>See the whole API<span>.</span></h1><p>Turn documentation into connections. Turn connections into understanding.</p></div><span className="intro-label"><span className="live-dot"/>YOUR API COMPASS</span></div><div className={`url-bar ${running?'analyzing':''}`}><span className="url-icon"><Globe2 size={20}/></span><input ref={urlInput} aria-label="API documentation URL" placeholder="Paste any API documentation or OpenAPI URL…" value={url} disabled={!!running} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')startAnalysis()}}/><button className="add-source-button" title="Add sources and configure analysis" aria-label="Add sources and configure analysis" onClick={()=>setModal('new')} disabled={!!running}><Plus size={17}/></button><button className="analyze-button" onClick={startAnalysis} disabled={!!running}>{running?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {running?'Analyzing…':'Analyze API'}{!running&&<ArrowRight size={15}/>}</button></div><div className="url-hints"><span><Link2 size={12}/>OpenAPI, Swagger, or a documentation website</span><span><ShieldCheck size={12}/>Source-backed insights</span><button onClick={()=>{loadAnalysis(demo);setToast('Curated example loaded. Paste a URL to analyze your own API.')}}>Explore an example <ArrowUpRight size={11}/></button></div>
   </section>
   {sharedBy&&view!=='workspace'&&<div className="info-banner shared-banner" role="status"><Share2 size={16}/><span>Shared with you by <b>{sharedBy}</b> · read-only. <button className="text-button" onClick={()=>{setSharedBy(null);router.replace('/');setView('workspace')}}>Back to your projects</button></span></div>}
   {saveFailure&&<div className="error-banner" role="alert"><span>This map is not saved to your account yet, so it will be lost when you leave. </span><button className="outline-button" onClick={()=>{const failed=saveFailure;setSaveFailure(null);void saveAnalysis(failed.analysis,failed.replaceId).then(()=>setToast('Saved to your account.')).catch(()=>setSaveFailure(failed))}}>Retry save</button></div>}
   {error&&<div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
   {openingSaved&&!running&&<div className="analysis-progress" role="status"><div className="progress-orb"><LoaderCircle size={20} className="spin"/></div><div className="progress-main"><div><strong>Opening your saved analysis…</strong></div><p>Loaded from your account · no regeneration needed</p></div></div>}
   {running&&<div className="analysis-progress" role="status"><div className="progress-orb"><Sparkles size={20}/></div><div className="progress-main"><div><strong>{job?.message||'Starting analysis…'}</strong><span>{Math.round(job?.progress||1)}%</span></div><div className="progress-track"><i style={{width:`${job?.progress||1}%`}}/></div><p>Discover → Read → Map dependencies → Build your study path</p></div><button className="outline-button" onClick={cancel} disabled={starting}>Cancel</button></div>}
   {view==='workspace'?<WorkspaceHome history={history} ready={historyReady} running={!!running||openingSaved} onNew={()=>setModal('new')} onOpen={item=>void openSaved(item)} onStart={startTemplate} onRerun={rerunAnalysis} onDelete={item=>{if(!window.confirm(`Delete the saved analysis “${item.name}”? You will need to run it again to reopen it.`))return;removeSavedAnalysis(item.id).then(()=>setToast('Saved analysis deleted.')).catch(()=>setError('Could not delete the analysis. Try again.'))}}/>:<section className="workspace-panel"><div className="workspace-heading"><div className="api-title"><span className="api-logo">{analysis.demo?'c':displayName(analysis.name).charAt(0).toLowerCase()}<span/></span><div><div className="api-title-top"><h2>{analysis.name}</h2><span className={`example-badge ${analysis.demo?'':'live'}`}>{analysis.demo?'EXAMPLE MAP':'STRUCTURAL MAP'}</span></div><p>{analysis.demo?'Subscription billing, connected.':`${analysis.urls.length} source${analysis.urls.length>1?'s':''} · ${analysis.version}`}<span className="heading-dot">·</span><button onClick={()=>setView('sources')}>{analysis.demo?'Curated preview':'View analysis coverage'}<ArrowUpRight size={11}/></button></p></div></div><div className="analysis-heading-actions">{!analysis.demo&&!sharedBy&&history.some(item=>item.id===analysis.id)&&<span className="share-anchor"><button className="outline-button rerun-button" onClick={()=>setShowShare(!showShare)} aria-expanded={showShare}><Share2 size={14}/>Share</button>{showShare&&<SharePanel sourceKey={sourceKeyFor(analysis.urls)} onClose={()=>setShowShare(false)}/>}</span>}{analysis.changes&&<button className="outline-button rerun-button" onClick={()=>setShowChanges(true)} title="What changed since the previous run"><RotateCcw size={14}/>What changed<span className="nav-pill">{changeCount(analysis.changes)}</span></button>}{!analysis.demo&&!sharedBy&&<button className="outline-button rerun-button" onClick={()=>rerunAnalysis(analysis)} disabled={!!running} title="Refresh this analysis from its saved documentation URLs"><RotateCcw size={14}/>Rerun analysis</button>}<button className="study-shortcut" onClick={()=>setView('study')}><BookOpen size={16}/><span>Understand in <strong>30 min</strong></span><ArrowRight size={14}/></button></div></div>
    <div className="metrics-row"><Metric icon={Boxes} value={analysis.entities.length} label="entities"/><Metric icon={GitBranch} value={analysis.dependencies.length} label="dependencies"/><Metric icon={Code2} value={analysis.operations.filter(isEndpoint).length} label="endpoints"/><Metric icon={CheckCheck} value={documented} label="documented links"/><span className="coverage-label"><span/> {analysis.demo?'Example · partial coverage':'Bounded analysis · review coverage'}</span></div>
    <div className="view-tabs"><div className="tab-buttons">{tabs.map(t=><button data-tab={t.id} className={view===t.id?'active':''} key={t.id} onClick={()=>setView(t.id)}><t.icon size={15}/>{t.label}{t.id==='dependencies'&&<span>{analysis.dependencies.filter(d=>d.type!=='schema').length}</span>}</button>)}</div><button className={`patterns-button ${view==='patterns'?'active':''}`} onClick={()=>setView('patterns')}><Workflow size={14}/><span>Design patterns</span></button></div>
    <div className={`workspace-body ${view==='graph'&&orderedEntities.length?'with-stepper':''} ${inspectorVisible?'details-open':''}`}>{view==='graph'&&!!orderedEntities.length&&(trace?<BacktrackPanel trace={trace} direction={traceDirection} scope={traceScope} requirementFilter={requirementFilter} onRequirementFilter={filter=>{setRequirementFilter(filter);if(filter==='call'||filter==='creation'){setTraceDirection('prerequisites');setTraceScope('direct');setEvidence(analysis.dependencies.some(d=>d.target===traceTarget&&d.status==='documented')?'documented':'all')}setFitKey(k=>k+1)}} requirementById={requirementById} callOperations={callOperations} callOperation={callOperation} creationPlan={creationPlan} onCallOperation={id=>{setSelectedCallId(id);setFitKey(k=>k+1)}} onFullBacktrack={()=>{setRequirementFilter('creation');setTraceScope('full');setFitKey(k=>k+1)}} onScope={scope=>{setTraceScope(scope);if(scope==='full'&&(requirementFilter==='call'||requirementFilter==='creation'))setRequirementFilter('all');setFitKey(k=>k+1)}} onDirection={direction=>{setTraceDirection(direction);if(direction==='dependents'&&(requirementFilter==='call'||requirementFilter==='creation'))setRequirementFilter('all');setEvidence(analysis.dependencies.some(d=>(direction==='prerequisites'?d.target:d.source)===traceTarget&&d.status==='documented')?'documented':'all');setFitKey(k=>k+1)}} onExit={stopTrace} onDetails={openEntityDetails} onTrace={startTrace}/>:<EntityStepper entities={orderedEntities} step={tourStep} active={tourActive} connectionCount={tourData.connectionCount} onStep={goEntityStep} onDetails={()=>{if(tourData.current)openEntityDetails(tourData.current.id)}} onTrace={direction=>{if(tourData.current)startTrace(tourData.current.id,direction)}} onFullMap={()=>{setTourActive(false);setLinkScope('key');setNodeLimit(30);setFitKey(k=>k+1)}} onResume={()=>goEntityStep(tourStep)}/>)}<div className="workspace-main">
     {view==='graph'&&<><div className="graph-toolbar"><label className="graph-search"><Search size={14}/><input ref={searchInput} aria-label="Search entities" placeholder="Find an entity…" value={query} onChange={e=>{setTraceTarget(null);setQuery(e.target.value);if(e.target.value)setTourActive(false)}}/>{query?<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={12}/></button>:<kbd><Command size={9}/>K</kbd>}</label><div className="graph-filters"><select value={group} onChange={e=>{setTraceTarget(null);setGroup(e.target.value);setTourActive(false);setFitKey(k=>k+1)}} aria-label="Filter entity group"><option value="all">All groups</option>{groups.map(g=><option key={g}>{g}</option>)}</select><select className="entity-sort" value={entitySort} onChange={e=>{const sort=e.target.value as EntitySort;const first=orderEntities(analysis.entities,analysis.dependencies,sort)[0];setTraceTarget(null);setEntitySort(sort);setTourStep(0);setSelected(first?.id||null);setTourActive(!!first);setNodeLimit(30);setFitKey(k=>k+1)}} aria-label="Entity order"><option value="dependency">Prerequisites first</option><option value="connected">Most connected</option><option value="alphabetical">A–Z</option></select><button className={`focus-button ${trace&&traceDirection==='prerequisites'?'active':''}`} onClick={()=>{if(selected)startTrace(selected,'prerequisites')}} title="Show what this entity needs"><GitBranch size={14}/><span>Needs</span></button><button className={`focus-button ${trace&&traceDirection==='dependents'?'active':''}`} onClick={()=>{if(selected)startTrace(selected,'dependents')}} title="Show where this entity is used"><ArrowUpRight size={14}/><span>Used by</span></button><button className={`focus-button ${focus?'active':''}`} onClick={()=>setFocus(!focus)} title="Highlight selected entity and its neighbors"><Focus size={14}/><span>Focus</span></button><div className="dimension-switch"><button className={dimension==='2d'?'active':''} onClick={()=>setDimension('2d')}>2D</button><button className={dimension==='3d'?'active':''} onClick={()=>setDimension('3d')}><Box size={12}/>3D</button></div><button className="icon-button expand-button" title={fullGraph?"Exit full screen":"Full screen graph"} aria-label={fullGraph?"Exit full screen":"Full screen graph"} onClick={()=>{setFullGraph(v=>!v);setFitKey(k=>k+1)}}>{fullGraph?<X size={15}/>:<Maximize2 size={15}/>}</button></div></div><div className="graph-order-hint"><span>{trace?(requirementFilter==='creation'?'CREATION CHAIN':requirementFilter==='call'?'THIS API CALL':traceDirection==='prerequisites'?'NEEDS TO CREATE':'USED BY'):'READING ORDER'}</span> {trace?requirementFilter==='creation'?`Showing the required creation data for ${trace.target?.name}, backtracked to ${creationPlan?.terminalEntityIds.length||0} root ${creationPlan?.terminalEntityIds.length===1?'entity':'entities'}.`:requirementFilter==='call'?`Showing only ${callOperation?.name||trace.target?.name} and its ${trace.entities.length-1} required linked ${trace.entities.length===2?'ID':'IDs'}.`:`Showing ${trace.target?.name} and ${trace.entities.length-1} ${traceDirection==='prerequisites'?'prerequisites':'dependents'} (${traceScope==='direct'?'direct links':'full chain'}).`:entitySort==='dependency'?'Start with prerequisites, then follow arrows to dependent entities.':entitySort==='connected'?'Start with the most connected entities.':'Entities are sorted by name.'} <small>{trace?(traceDirection==='prerequisites'?'Arrows point toward the selected entity.':'Arrows point away from the selected entity.'):tourActive?`Step ${tourStep+1} of ${orderedEntities.length} · ${tourData.neighbors.length} connected entities in view.`:linkScope==='key'?'Key connections are shown. Choose Every connection below for all links.':'Numbers match the entity list.'}</small></div><div className="graph-canvas">{visibleEntities.length?(dimension==='2d'?<Graph entities={visibleEntities} dependencies={visibleDependencies} ranks={traceRanks} selected={selected} onSelect={openEntityDetails} onEdgeSelect={openDependencyDetails} focus={focus} fitKey={fitKey} trace={!!trace} overview={!trace&&!tourActive&&linkScope==='key'}/>:<GraphBoundary onFallback={()=>setDimension('2d')}><Suspense fallback={<div className="loading-3d"><LoaderCircle size={26} className="spin"/><h3>Entering your API universe…</h3><p>Preparing the 3D constellation</p></div>}><Graph3D entities={visibleEntities} dependencies={visibleDependencies} ranks={traceRanks} selected={selected} onSelect={openEntityDetails}/></Suspense></GraphBoundary>):<Empty title="No entities match your search" text="Try another name or select a different group."/>}{!trace&&filteredEntities.length>nodeLimit&&<button className="load-more-nodes" onClick={()=>{setNodeLimit(n=>n+30);setFitKey(k=>k+1)}}>Showing {visibleEntities.length} of {filteredEntities.length} · Show 30 more <Plus size={12}/></button>}</div><div className="graph-legend"><div>{!trace&&!tourActive&&<><button className={linkScope==='key'?'selected':''} onClick={()=>{setLinkScope('key');setFitKey(k=>k+1)}}>Key connections</button><button className={linkScope==='all'?'selected':''} onClick={()=>{setLinkScope('all');setFitKey(k=>k+1)}}>Every connection</button><span className="legend-divider"/></>}<button className={evidence==='all'?'selected':''} onClick={()=>setEvidence('all')}>All evidence</button><button className={evidence==='documented'?'selected':''} onClick={()=>setEvidence(evidence==='documented'?'all':'documented')}><span className="legend-line"/>Documented</button><button className={evidence==='inferred'?'selected':''} onClick={()=>setEvidence(evidence==='inferred'?'all':'inferred')}><span className="legend-line dashed"/>Inferred</button></div><span><ShieldCheck size={12}/>Click a connection to verify</span></div></>}
     {view==='dependencies'&&<DependenciesView analysis={analysis} rejected={rejectedLinks} onRestore={link=>reviewLink(link,null)} onSelect={openDependencyDetails}/>}{view==='operations'&&<OperationsView analysis={analysis} onTrace={startTrace}/>}{view==='study'&&<StudyView key={analysis.id} analysis={analysis} onExplore={explore}/>}{view==='scenarios'&&<ScenariosView key={analysis.id} analysis={analysis} initialEntityId={selected} sourceKey={sourceKeyFor(analysis.urls)} onEntityDetails={id=>{selectEntity(id);setView('graph');setDetailOpen(true)}}/>}{view==='patterns'&&<PatternsView analysis={analysis}/>}{view==='sources'&&<SourcesView analysis={analysis}/>}
    </div>{inspectorVisible&&<Inspector key={edge?.id||entity?.id} analysis={analysis} entity={entity} dependency={edge} reviewable={!analysis.demo} onReview={(link,verdict)=>{reviewLink(link,verdict);if(verdict==='rejected'){setEdge(null);setDetailOpen(false)}}} onSelect={openEntityDetails} onClose={()=>{setDetailOpen(false);setEdge(null)}} onDependency={openDependencyDetails} onTrace={startTrace}/>}</div>
   </section>}{view!=='workspace'&&<footer className="workspace-footer"><span><span className="connection-dot on"/>Specification engine ready<span className="footer-separator">/</span>{analysis.demo?'You’re exploring a curated example.':'Analyses are saved to your account.'}</span></footer>}
   </main>
  </div>
  {showChanges&&analysis.changes&&view!=='workspace'&&<ChangesPanel changes={analysis.changes} onClose={()=>setShowChanges(false)}/>}
  {touring&&view!=='workspace'&&<Tour onClose={()=>setTouring(false)}/>}
  {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  {modal&&<AppModals modal={modal} onClose={()=>setModal(null)} {...{url,setUrl,extraUrls,setExtraUrls,maxPages,setMaxPages,running:!!running,startAnalysis,setToast,view,setError,setTouring}}/>}
 </div>
}
