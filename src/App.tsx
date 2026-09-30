'use client';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Share2, ArrowRight, ArrowUpRight, BookOpen, Box, Boxes, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Code2, Command, FileText, Focus, GitBranch, Globe2, Layers3, Link2, ListFilter, LoaderCircle, Maximize2, Menu, MoreHorizontal, Network, Plus, RotateCcw, Search, Settings2, Sparkles, Workflow, X } from 'lucide-react';
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
import BrandMark from './components/BrandMark';
import Tour, { TOUR_KEY } from './components/Tour';
import { useAnalysisJob } from './useAnalysisJob';
import { changeCount, diffAnalyses } from './analysisDiff';
import ChangesPanel from './components/ChangesPanel';
import SharePanel from './components/SharePanel';
import { readMap } from './savedAnalyses';
import { readBrandStorage } from './brandStorage';
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
const tabs:{id:View;label:string;icon:typeof Network}[]=[{id:'graph',label:'Map',icon:Network},{id:'operations',label:'Endpoints',icon:Code2},{id:'scenarios',label:'Scenarios',icon:Workflow},{id:'study',label:'Study',icon:BookOpen}];
const moreTabs:{id:View;label:string;icon:typeof Network}[]=[{id:'dependencies',label:'ID lineage',icon:GitBranch},{id:'patterns',label:'Design patterns',icon:Workflow},{id:'sources',label:'Sources and coverage',icon:FileText}];

export default function App(){
 const [rawAnalysis,setAnalysis]=useState<Analysis>(demo);
 // Every view works on the reviewed map: confirmed links count as documented, rejected links are hidden.
 const linkReviews=useConvexQuery(api.linkReviews.list,rawAnalysis.demo?'skip':{sourceKey:sourceKeyFor(rawAnalysis.urls)});const setLinkReview=useConvexMutation(api.linkReviews.set);
 const {analysis,rejected:rejectedLinks}=useMemo(()=>applyLinkReviews(rawAnalysis,(linkReviews||{}) as Record<string,LinkVerdict>),[rawAnalysis,linkReviews]);
 const [view,setView]=useState<View>('workspace');const [selected,setSelected]=useState<string|null>('subscription');const [edge,setEdge]=useState<Dependency|null>(null);
 const [detailOpen,setDetailOpen]=useState(false);
 const [traceTarget,setTraceTarget]=useState<string|null>(null);const [selectedCallId,setSelectedCallId]=useState<string|null>(null);const [traceDirection,setTraceDirection]=useState<TraceDirection>('prerequisites');const [traceScope,setTraceScope]=useState<'direct'|'full'>('direct');const [requirementFilter,setRequirementFilter]=useState<RequirementFilter>('all');
 const [url,setUrl]=useState('');const [extraUrls,setExtraUrls]=useState('');const [query,setQuery]=useState('');const [group,setGroup]=useState('all');const [evidence,setEvidence]=useState('all');const [focus,setFocus]=useState(false);const [dimension,setDimension]=useState('2d');
 const [modal,setModal]=useState<string|null>(null);const [fullGraph,setFullGraph]=useState(false);const [showProjectMenu,setShowProjectMenu]=useState(false);const [showViewMore,setShowViewMore]=useState(false);const [showGraphFilters,setShowGraphFilters]=useState(false);const [showSidebar,setShowSidebar]=useState(false);
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
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();searchInput.current?.focus()}if(event.key==='Escape'){setModal(null);setShowProjectMenu(false);setShowViewMore(false);setShowGraphFilters(false);setFullGraph(false)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
 useEffect(()=>{if(!toast)return;const timeout=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(timeout)},[toast]);
 useEffect(()=>{if(!fullGraph)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[fullGraph]);
 const loadAnalysis=useCallback((next:Analysis)=>{if(!readBrandStorage(TOUR_KEY,'atlas-tour-done'))setTouring(true);const first=orderEntities(next.entities,next.dependencies,'dependency')[0];setAnalysis(next);setTourStep(0);setTourActive(!!first);setSelected(first?.id||null);setEdge(null);setDetailOpen(false);setTraceTarget(null);setGroup('all');setQuery('');setEvidence('all');setView('graph');setEntitySort('dependency');setLinkScope('key');setNodeLimit(30);setFitKey(k=>k+1);setShowSidebar(false);},[]);
 const openSaved=useCallback(async (saved:SavedAnalysis,tab?:View|null)=>{setError('');setOpeningSaved(true);try{loadAnalysis(await openSavedAnalysis(saved));if(tab&&tab!=='workspace')setView(tab)}catch(e){setError((e as Error).message)}finally{setOpeningSaved(false)}},[loadAnalysis,openSavedAnalysis]);
 const {job,starting,running:jobRunning,launch:launchAnalysis,cancel}=useAnalysisJob({maxPages,
  onStart:()=>{setError('');setModal(null)},
  onError:message=>setError(message),
  onToast:message=>setToast(message),
  onComplete:async (fresh,replaced,previousResultUrl)=>{
   // On a rerun, record what changed since the previous map before it is replaced.
   let result=fresh;const previousSaved=replaced?history.find(item=>item.id===replaced):null;
   if(previousResultUrl){try{const response=await fetch(previousResultUrl);if(response.ok)result={...fresh,changes:diffAnalyses(await readMap(response),fresh)}}catch{}}
   else if(previousSaved){try{const previous=await openSavedAnalysis(previousSaved);result={...fresh,changes:diffAnalyses(previous,fresh)}}catch{}}
   loadAnalysis(result);if(result.changes)setShowChanges(true);setToast(replaced?'Analysis refreshed and saved to your account.':'Your API map is ready and saved to your account.');setSaveFailure(null)},
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
  if(routeAnalysis){setError('That saved project was not found in your account.');setView('workspace');router.replace('/');return}
  const template=templateFor(routeProject);
  if(template){startTemplate(template);return}
  setView('workspace');
 },[historyReady,routeKey,routeAnalysis,routeProject,routeShare,routeTab,history,analysis.id,openSaved,startTemplate,convexClient,loadAnalysis,router]);
 // Keep the URL in step with the open project and tab so reload, back, and shared links restore it.
 useEffect(()=>{
  if(!historyReady)return;
  const saved=!analysis.demo&&history.some(item=>item.id===analysis.id);
  if(routeAnalysis&&analysis.id!==routeAnalysis&&view==='workspace')return;
  const next=view==='workspace'||!saved?'/':`/?analysis=${encodeURIComponent(analysis.id)}${view==='graph'?'':`&tab=${view}`}`;
  const current=`${window.location.pathname}${window.location.search}`;
  if(routeShare&&view!=='workspace')return;
  if(next===current||(next==='/'&&(routeProject||(routeAnalysis&&view!=='workspace'))))return;
  handledRoute.current=next==='/'?'|':`${analysis.id}|`;
  router.replace(next,{scroll:false});
 },[historyReady,view,analysis.id,analysis.demo,history,router,routeProject,routeAnalysis,routeShare]);
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
 const activeFilterCount=[group!=='all',entitySort!=='dependency',evidence!=='all',focus,dimension==='3d',!tourActive&&linkScope==='all'].filter(Boolean).length;
 const entity=analysis.entities.find(e=>e.id===selected)||null;
 const documented=analysis.dependencies.filter(d=>d.status==='documented').length;
 const inspectorVisible=detailOpen&&(view==='graph'||view==='dependencies')&&(!!entity||!!edge);
 function exportData(format:string){setShowProjectMenu(false);if(format==='json')download('apipassage-analysis.json',JSON.stringify(analysis,null,2),'application/json');else{const text=`# ${analysis.name}\n\nAnalyzed: ${analysis.createdAt}\nMode: ${analysis.mode}\n\n## Entities\n\n${analysis.entities.map(e=>`### ${e.name}\n${e.description}\nSource: ${e.source}\n\n${e.fields.map(f=>`- ${f.name} (${f.type}${f.required?', required':''}): ${f.description}`).join('\n')}`).join('\n\n')}\n\n## Dependencies\n\n${analysis.dependencies.map(d=>`- ${analysis.entities.find(e=>e.id===d.source)?.name} → ${analysis.entities.find(e=>e.id===d.target)?.name}: ${d.field} [${d.status}]\n  ${d.evidence}\n  Source: ${d.sourceUrl}`).join('\n')}\n\n## Coverage\n${analysis.warnings.join('\n')}`;download('apipassage-study-notes.md',text,'text/markdown')}setToast('Export downloaded.')}
 return <div className={`app-shell ${fullGraph?'full-graph':''}`}>
  {showSidebar&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setShowSidebar(false)}/>}
  <aside className={`sidebar ${showSidebar?'mobile-open':''}`}>
   <Link className="brand" href="/" onClick={showProjects} aria-label="APIPassage home"><span className="brand-mark"><BrandMark/></span><span className="brand-wordmark"><span>API</span>Passage</span></Link>
   <button className="new-analysis" onClick={()=>{setModal('new');setShowSidebar(false)}}><Plus size={15}/>New analysis<span>↗</span></button>
   <nav className="main-nav" aria-label="Projects"><Link href="/" onClick={showProjects} className={view==='workspace'?'active':''}><Layers3 size={17}/>All projects</Link></nav>
   <div className="nav-section-label sources-label">PROJECTS</div>
   <div className="project-nav">{history.slice(0,8).map(item=>{const template=templateForUrls(item.urls);return <Link key={item.id} href={`/?analysis=${encodeURIComponent(item.id)}`} onClick={openFromNav(item)} className={view!=='workspace'&&analysis.id===item.id?'active':''} aria-current={view!=='workspace'&&analysis.id===item.id?'page':undefined}><span className="project-nav-icon">{(template?.badge||item.name).charAt(0).toUpperCase()}</span><span>{template?.name||displayName(item.name)}<small>{item.entityCount} entities · {item.operationCount} endpoints</small></span><ChevronRight size={13}/></Link>})}{historyReady&&!history.length&&<p className="project-nav-empty">No projects yet. Start with a URL or example.</p>}{history.length>8&&<Link href="/" onClick={showProjects}>All {history.length} projects<ArrowRight size={12}/></Link>}</div>
   <div className="sidebar-bottom"><ThemeToggle/><button className="bottom-nav" onClick={()=>setModal('settings')}><Settings2 size={16}/>Settings</button><button className="bottom-nav" onClick={()=>setModal('help')}><CircleHelp size={16}/>How APIPassage works</button><div className="profile"><UserButton/><div><strong>{user?.fullName||user?.username||'Your workspace'}</strong><small>{user?.primaryEmailAddress?.emailAddress||'Signed in'}</small></div></div></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setShowSidebar(true)}><Menu size={19}/></button><Layers3 size={15}/><Link href="/" onClick={showProjects}>Projects</Link>{view!=='workspace'&&<><ChevronRight size={12}/><strong>{displayName(analysis.name)}</strong></>}</div><div className="topbar-actions"><span className="top-avatar"><UserButton/></span></div></header>
   <main className="main-content">{view==='workspace'&&<section className="intro"><div className="intro-copy"><div><h1>See the whole API<span>.</span></h1><p>Turn documentation into connections. Turn connections into understanding.</p></div></div><div className={`url-bar ${running?'analyzing':''}`}><span className="url-icon"><Globe2 size={20}/></span><input ref={urlInput} aria-label="API documentation URL" placeholder="Paste any API documentation or OpenAPI URL…" value={url} disabled={!!running} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')startAnalysis()}}/><button className="add-source-button" title="Add sources and configure analysis" aria-label="Add sources and configure analysis" onClick={()=>setModal('new')} disabled={!!running}><Plus size={17}/></button><button className="analyze-button" onClick={startAnalysis} disabled={!!running}>{running?<LoaderCircle size={16} className="spin"/>:<Sparkles size={16}/>} {running?'Analyzing…':'Analyze API'}{!running&&<ArrowRight size={15}/>}</button></div><div className="url-hints"><span><Link2 size={12}/>OpenAPI, Swagger, or a documentation website</span><button onClick={()=>{loadAnalysis(demo);setToast('Curated example loaded. Paste a URL to analyze your own API.')}}>Explore an example <ArrowUpRight size={11}/></button></div></section>}
   {sharedBy&&view!=='workspace'&&<div className="info-banner shared-banner" role="status"><Share2 size={16}/><span>Shared with you by <b>{sharedBy}</b> · read-only. <button className="text-button" onClick={()=>{setSharedBy(null);router.replace('/');setView('workspace')}}>Back to your projects</button></span></div>}
   {saveFailure&&<div className="error-banner" role="alert"><span>This map is not saved to your account yet, so it will be lost when you leave. </span><button className="outline-button" onClick={()=>{const failed=saveFailure;setSaveFailure(null);void saveAnalysis(failed.analysis,failed.replaceId).then(()=>setToast('Saved to your account.')).catch(()=>setSaveFailure(failed))}}>Retry save</button></div>}
   {error&&<div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
   {openingSaved&&!running&&<div className="analysis-progress" role="status"><div className="progress-orb"><LoaderCircle size={20} className="spin"/></div><div className="progress-main"><div><strong>Opening your saved analysis…</strong></div><p>Loaded from your account · no regeneration needed</p></div></div>}
   {running&&<div className="analysis-progress" role="status"><div className="progress-orb"><Sparkles size={20}/></div><div className="progress-main"><div><strong>{job?.message||'Starting analysis…'}</strong><span>{Math.round(job?.progress||1)}%</span></div><div className="progress-track"><i style={{width:`${job?.progress||1}%`}}/></div><p>Discover → Read → Map dependencies → Build your study path</p></div><button className="outline-button" onClick={cancel} disabled={starting}>Cancel</button></div>}
   {view==='workspace'?<WorkspaceHome history={history} ready={historyReady} running={!!running||openingSaved} onNew={()=>setModal('new')} onOpen={item=>void openSaved(item)} onStart={startTemplate} onRerun={rerunAnalysis} onDelete={item=>{if(!window.confirm(`Delete the saved analysis “${item.name}”? You will need to run it again to reopen it.`))return;removeSavedAnalysis(item.id).then(()=>setToast('Saved analysis deleted.')).catch(()=>setError('Could not delete the analysis. Try again.'))}}/>:<section className="workspace-panel"><div className="workspace-heading"><div className="api-title"><span className="api-logo">{analysis.demo?'c':displayName(analysis.name).charAt(0).toLowerCase()}<span/></span><div><div className="api-title-top"><h2>{analysis.name}</h2><span className={`example-badge ${analysis.demo?'':'live'}`}>{analysis.demo?'EXAMPLE MAP':'STRUCTURAL MAP'}</span></div><p>{analysis.demo?'Subscription billing, connected.':`${analysis.urls.length} source${analysis.urls.length>1?'s':''} · ${analysis.version}`}</p></div></div><div className="analysis-heading-actions"><button className="outline-button" onClick={()=>setModal('new')}><Plus size={14}/>New analysis</button><div className="project-menu-anchor"><button className="outline-button" onClick={()=>setShowProjectMenu(value=>!value)} aria-expanded={showProjectMenu} aria-controls="project-actions"><MoreHorizontal size={16}/>Project actions</button>{showProjectMenu&&<div className="project-menu" id="project-actions"><button onClick={()=>{setView('sources');setShowProjectMenu(false)}}><FileText size={14}/>Sources and coverage</button>{!analysis.demo&&!sharedBy&&history.some(item=>item.id===analysis.id)&&<button onClick={()=>{setShowShare(true);setShowProjectMenu(false)}}><Share2 size={14}/>Share project</button>}{analysis.changes&&<button onClick={()=>{setShowChanges(true);setShowProjectMenu(false)}}><RotateCcw size={14}/>What changed ({changeCount(analysis.changes)})</button>}{!analysis.demo&&!sharedBy&&<button onClick={()=>{rerunAnalysis(analysis);setShowProjectMenu(false)}} disabled={!!running}><RotateCcw size={14}/>Rerun analysis</button>}<span className="project-menu-divider"/><button onClick={()=>exportData('json')}><Code2 size={14}/>Export analysis JSON</button><button onClick={()=>exportData('md')}><FileText size={14}/>Export study notes</button></div>}{showShare&&<SharePanel sourceKey={sourceKeyFor(analysis.urls)} onClose={()=>setShowShare(false)}/>}</div></div></div>
    <details className="analysis-summary"><summary>{analysis.entities.length} entities <span>·</span> {analysis.operations.filter(isEndpoint).length} endpoints <span>·</span> Analysis summary <ChevronDown size={13}/></summary><div className="metrics-row"><Metric icon={Boxes} value={analysis.entities.length} label="entities"/><Metric icon={GitBranch} value={analysis.dependencies.length} label="dependencies"/><Metric icon={Code2} value={analysis.operations.filter(isEndpoint).length} label="endpoints"/><Metric icon={CheckCheck} value={documented} label="documented links"/><button className="coverage-link" onClick={()=>setView('sources')}>{analysis.demo?'Example · partial coverage':'Review coverage'} <ArrowUpRight size={12}/></button></div></details>
    <div className="view-tabs"><div className="tab-buttons">{tabs.map(t=><button data-tab={t.id} className={view===t.id?'active':''} key={t.id} onClick={()=>{setView(t.id);setShowViewMore(false)}}><t.icon size={15}/>{t.label}</button>)}</div><div className="view-more-anchor"><button className={`view-more-button ${moreTabs.some(tab=>tab.id===view)?'active':''}`} onClick={()=>setShowViewMore(value=>!value)} aria-expanded={showViewMore} aria-controls="more-views">More <ChevronDown size={14}/></button>{showViewMore&&<div className="view-more-menu" id="more-views">{moreTabs.map(tab=><button key={tab.id} className={view===tab.id?'active':''} onClick={()=>{setView(tab.id);setShowViewMore(false)}}><tab.icon size={15}/>{tab.label}</button>)}</div>}</div></div>
    <div className={`workspace-body ${inspectorVisible?'details-open':''}`}>{view==='graph'&&!!orderedEntities.length&&trace&&<BacktrackPanel trace={trace} direction={traceDirection} scope={traceScope} requirementFilter={requirementFilter} onRequirementFilter={filter=>{setRequirementFilter(filter);if(filter==='call'||filter==='creation'){setTraceDirection('prerequisites');setTraceScope('direct');setEvidence(analysis.dependencies.some(d=>d.target===traceTarget&&d.status==='documented')?'documented':'all')}setFitKey(k=>k+1)}} requirementById={requirementById} callOperations={callOperations} callOperation={callOperation} creationPlan={creationPlan} onCallOperation={id=>{setSelectedCallId(id);setFitKey(k=>k+1)}} onFullBacktrack={()=>{setRequirementFilter('creation');setTraceScope('full');setFitKey(k=>k+1)}} onScope={scope=>{setTraceScope(scope);if(scope==='full'&&(requirementFilter==='call'||requirementFilter==='creation'))setRequirementFilter('all');setFitKey(k=>k+1)}} onDirection={direction=>{setTraceDirection(direction);if(direction==='dependents'&&(requirementFilter==='call'||requirementFilter==='creation'))setRequirementFilter('all');setEvidence(analysis.dependencies.some(d=>(direction==='prerequisites'?d.target:d.source)===traceTarget&&d.status==='documented')?'documented':'all');setFitKey(k=>k+1)}} onExit={stopTrace} onDetails={openEntityDetails} onTrace={startTrace}/>}<div className="workspace-main">
     {view==='graph'&&<><div className="graph-toolbar"><label className="graph-search"><Search size={15}/><input ref={searchInput} aria-label="Search entities" placeholder="Search entities…" value={query} onChange={event=>{setTraceTarget(null);setQuery(event.target.value);if(event.target.value)setTourActive(false)}}/>{query?<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={13}/></button>:<kbd><Command size={9}/>K</kbd>}</label><div className="graph-primary-actions">{!trace&&<div className="map-mode" role="group" aria-label="Map mode"><button className={tourActive?'active':''} onClick={()=>goEntityStep(tourStep)}>Guided</button><button className={!tourActive?'active':''} onClick={()=>{setTourActive(false);setLinkScope('key');setNodeLimit(30);setFitKey(key=>key+1)}}>Full map</button></div>}<button className={`graph-filter-toggle ${showGraphFilters?'active':''}`} onClick={()=>setShowGraphFilters(value=>!value)} aria-expanded={showGraphFilters} aria-controls="graph-filter-panel"><ListFilter size={15}/>Filters{activeFilterCount>0&&<span>{activeFilterCount}</span>}</button><button className="icon-button expand-button" title={fullGraph?'Exit full screen':'Full screen graph'} aria-label={fullGraph?'Exit full screen':'Full screen graph'} onClick={()=>{setFullGraph(value=>!value);setFitKey(key=>key+1)}}>{fullGraph?<X size={16}/>:<Maximize2 size={16}/>}</button></div></div>
     {showGraphFilters&&<div className="graph-filter-panel" id="graph-filter-panel"><label>Group<select value={group} onChange={event=>{setTraceTarget(null);setGroup(event.target.value);setTourActive(false);setFitKey(key=>key+1)}}><option value="all">All groups</option>{groups.map(item=><option key={item}>{item}</option>)}</select></label><label>Order<select value={entitySort} onChange={event=>{const sort=event.target.value as EntitySort;const first=orderEntities(analysis.entities,analysis.dependencies,sort)[0];setTraceTarget(null);setEntitySort(sort);setTourStep(0);setSelected(first?.id||null);setTourActive(!!first);setNodeLimit(30);setFitKey(key=>key+1)}}><option value="dependency">Prerequisites first</option><option value="connected">Most connected</option><option value="alphabetical">A–Z</option></select></label><label>Evidence<select value={evidence} onChange={event=>setEvidence(event.target.value)}><option value="all">All evidence</option><option value="documented">Documented only</option><option value="inferred">Inferred only</option></select></label><label>Connections<select value={linkScope} disabled={!!trace||tourActive} onChange={event=>{setLinkScope(event.target.value as 'key'|'all');setFitKey(key=>key+1)}}><option value="key">Key connections</option><option value="all">Every connection</option></select></label><div className="filter-button-group"><span>Display</span><div><button className={dimension==='2d'?'active':''} onClick={()=>setDimension('2d')}>2D</button><button className={dimension==='3d'?'active':''} onClick={()=>setDimension('3d')}><Box size={13}/>3D</button><button className={focus?'active':''} onClick={()=>setFocus(value=>!value)}><Focus size={13}/>Focus</button></div></div><button className="filter-reset" onClick={()=>{setGroup('all');setEntitySort('dependency');setEvidence('all');setLinkScope('key');setDimension('2d');setFocus(false);setFitKey(key=>key+1)}}>Reset filters</button></div>}
     {activeFilterCount>0&&<div className="active-filter-chips">{group!=='all'&&<button onClick={()=>setGroup('all')}>Group: {group} <X size={12}/></button>}{entitySort!=='dependency'&&<button onClick={()=>setEntitySort('dependency')}>Order: {entitySort==='connected'?'Most connected':'A–Z'} <X size={12}/></button>}{evidence!=='all'&&<button onClick={()=>setEvidence('all')}>{evidence==='documented'?'Documented':'Inferred'} <X size={12}/></button>}{!tourActive&&linkScope==='all'&&<button onClick={()=>setLinkScope('key')}>Every connection <X size={12}/></button>}{dimension==='3d'&&<button onClick={()=>setDimension('2d')}>3D <X size={12}/></button>}{focus&&<button onClick={()=>setFocus(false)}>Focus <X size={12}/></button>}</div>}
     {trace&&<div className="graph-order-hint"><strong>{requirementFilter==='creation'?'Creation chain':requirementFilter==='call'?'This API call':traceDirection==='prerequisites'?'Needs to create':'Used by'}</strong> {trace.entities.length} entities in this path. <button onClick={stopTrace}>Return to guide <ArrowRight size={12}/></button></div>}
<div className="graph-canvas">{visibleEntities.length?(dimension==='2d'?<Graph entities={visibleEntities} dependencies={visibleDependencies} ranks={traceRanks} selected={selected} onSelect={openEntityDetails} onEdgeSelect={openDependencyDetails} focus={focus} fitKey={fitKey} trace={!!trace} overview={!trace&&!tourActive&&linkScope==='key'}/>:<GraphBoundary onFallback={()=>setDimension('2d')}><Suspense fallback={<div className="loading-3d"><LoaderCircle size={26} className="spin"/><h3>Entering your API universe…</h3><p>Preparing the 3D constellation</p></div>}><Graph3D entities={visibleEntities} dependencies={visibleDependencies} ranks={traceRanks} selected={selected} onSelect={openEntityDetails}/></Suspense></GraphBoundary>):<Empty title="No entities match your search" text="Try another name or select a different group."/>}{!trace&&filteredEntities.length>nodeLimit&&<button className="load-more-nodes" onClick={()=>{setNodeLimit(n=>n+30);setFitKey(k=>k+1)}}>Showing {visibleEntities.length} of {filteredEntities.length} · Show 30 more <Plus size={12}/></button>}</div>{tourActive&&!trace&&!!orderedEntities.length&&<EntityStepper entities={orderedEntities} step={tourStep} connectionCount={tourData.connectionCount} onStep={goEntityStep} onDetails={()=>{if(tourData.current)openEntityDetails(tourData.current.id)}}/>}</>}
     {view==='dependencies'&&<DependenciesView analysis={analysis} rejected={rejectedLinks} onRestore={link=>reviewLink(link,null)} onSelect={openDependencyDetails}/>}{view==='operations'&&<OperationsView analysis={analysis} onTrace={startTrace}/>}{view==='study'&&<StudyView key={analysis.id} analysis={analysis} onExplore={explore}/>}{view==='scenarios'&&<ScenariosView key={analysis.id} analysis={analysis} initialEntityId={selected} sourceKey={sourceKeyFor(analysis.urls)} onEntityDetails={id=>{selectEntity(id);setView('graph');setDetailOpen(true)}}/>}{view==='patterns'&&<PatternsView analysis={analysis}/>}{view==='sources'&&<SourcesView analysis={analysis}/>}
    </div>{inspectorVisible&&<Inspector key={edge?.id||entity?.id} analysis={analysis} entity={entity} dependency={edge} reviewable={!analysis.demo} onReview={(link,verdict)=>{reviewLink(link,verdict);if(verdict==='rejected'){setEdge(null);setDetailOpen(false)}}} onSelect={openEntityDetails} onClose={()=>{setDetailOpen(false);setEdge(null)}} onDependency={openDependencyDetails} onTrace={startTrace}/>}</div>
   </section>}
   </main>
  </div>
  {showChanges&&analysis.changes&&view!=='workspace'&&<ChangesPanel changes={analysis.changes} onClose={()=>setShowChanges(false)}/>}
  {touring&&view!=='workspace'&&<Tour onClose={()=>setTouring(false)}/>}
  {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  {modal&&<AppModals modal={modal} onClose={()=>setModal(null)} {...{url,setUrl,extraUrls,setExtraUrls,maxPages,setMaxPages,running:!!running,startAnalysis,setToast,view,setError,setTouring}}/>}
 </div>
}
