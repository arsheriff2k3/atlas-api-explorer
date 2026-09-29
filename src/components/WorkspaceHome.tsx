import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BookOpen, Boxes, Clock3, Code2, GitBranch, Globe2, LoaderCircle, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { SavedAnalysis } from '../types';
import { EXAMPLE_PROJECTS, MIN_CANONICAL_VERSION, sourceKeyFor, templateForUrls } from '../projectSources';
import type { ProjectTemplate } from '../projectSources';

const hostOf=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url}};
const tone=(name:string)=>{let hash=0;for(const c of name)hash=(hash*31+c.charCodeAt(0))>>>0;return `tone-${hash%6}`};

export default function WorkspaceHome({history,ready,running,onNew,onOpen,onStart,onRerun,onDelete}:{history:SavedAnalysis[];ready:boolean;running:boolean;onNew:()=>void;onOpen:(analysis:SavedAnalysis)=>void;onStart:(template:ProjectTemplate)=>void;onRerun:(analysis:SavedAnalysis)=>void;onDelete:(analysis:SavedAnalysis)=>void}) {
  const savedKeys=new Set(history.map(item=>item.sourceKey));
  const examples=EXAMPLE_PROJECTS.filter(template=>!savedKeys.has(sourceKeyFor(template.urls)));
  return <section className="project-workspace" aria-labelledby="workspace-title">
    <div className="project-workspace-heading"><div><span className="workspace-eyebrow"><Sparkles size={13}/> YOUR API WORKSPACE</span><h2 id="workspace-title">Your projects<span>.</span></h2><p>Every analysis is saved to your account once. Open a project to explore its map, scenarios, and flows, or start a new one from any documentation or specification URL.</p></div><button className="outline-button" onClick={onNew}><Plus size={15}/>New project</button></div>
    {!ready&&<div className="workspace-note"><span><LoaderCircle size={15} className="spin"/>Loading your saved projects…</span></div>}
    {ready&&<div className="project-grid">
      {history.map(item=>{
        const template=templateForUrls(item.urls);
        const outdated=item.canonicalVersion<MIN_CANONICAL_VERSION;
        return <article className={`project-card ${tone(item.name)}`} key={item.id}>
          <div className="project-card-top"><span className="project-card-logo">{(template?.badge||item.name).charAt(0).toUpperCase()}</span><span className={`project-card-status ${outdated?'ready':'saved'}`}>{outdated?'UPDATE AVAILABLE':'SAVED'}</span></div>
          <div className="project-card-copy"><span>{template?.kind||(item.mode==='ai'?'AI + specification analysis':'Specification analysis')}</span><h3>{template?.name||item.name}</h3><p>{template?.description||item.urls.map(hostOf).join(' · ')}</p></div>
          <div className="project-card-metrics"><span><Boxes size={14}/><strong>{item.entityCount.toLocaleString()}</strong> entities</span><span><GitBranch size={14}/><strong>{item.dependencyCount.toLocaleString()}</strong> links</span><span><Code2 size={14}/><strong>{item.operationCount.toLocaleString()}</strong> endpoints</span><span><Clock3 size={14}/>{new Date(item.createdAt).toLocaleDateString()}</span></div>
          {outdated&&<p className="project-card-note">Built with an older extractor. Rerun to get complete fields, webhooks, and the latest links.</p>}
          <div className="project-card-actions"><Link className="project-open" href={`/?analysis=${encodeURIComponent(item.id)}`} onClick={event=>{event.preventDefault();onOpen(item)}}>Open project<ArrowRight size={16}/></Link><button className="project-rerun" onClick={()=>onRerun(item)} disabled={running} title="Rerun the analysis from its sources"><RotateCcw size={14}/>Rerun</button><button className="project-rerun" onClick={()=>onDelete(item)} disabled={running} aria-label={`Delete ${item.name}`} title="Delete"><Trash2 size={14}/></button><a className="project-docs" href={template?.homepage||item.urls[0]} target="_blank" rel="noreferrer"><Globe2 size={14}/>Source<ArrowUpRight size={13}/></a></div>
        </article>;
      })}
      <button className="project-card project-card-new" onClick={onNew}><Plus size={22}/><strong>New project</strong><span>Paste an OpenAPI, Swagger, Postman, GraphQL, AsyncAPI, RAML… URL or a documentation site.</span></button>
    </div>}
    {ready&&examples.length>0&&<><h3 className="workspace-subheading">Start from an example</h3><div className="project-grid">{examples.map(template=><article className={`project-card ${tone(template.name)}`} key={template.key}>
      <div className="project-card-top"><span className="project-card-logo">{template.badge}</span><span className="project-card-status ready">EXAMPLE</span></div>
      <div className="project-card-copy"><span>{template.kind}</span><h3>{template.name}</h3><p>{template.description}</p></div>
      <div className="project-card-metrics"><span><BookOpen size={14}/>{template.urls.map(hostOf).join(' · ')} · builds once, then saved</span></div>
      <div className="project-card-actions"><Link className="project-open" href={`/?project=${template.key}`} onClick={event=>{event.preventDefault();onStart(template)}}>Analyze {template.name}<ArrowRight size={16}/></Link><a className="project-docs" href={template.homepage} target="_blank" rel="noreferrer"><Globe2 size={14}/>Documentation<ArrowUpRight size={13}/></a></div>
    </article>)}</div></>}
    <div className="workspace-note"><span><Clock3 size={15}/>{running?'An analysis is running. Its map opens and is saved when ready.':'A project is generated once and reopened from your account on any browser. Rerun refreshes it from its sources.'}</span></div>
  </section>;
}
