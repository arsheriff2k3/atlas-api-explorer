import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Compass, GitBranch, Layers3, Search } from 'lucide-react';
import type { Entity } from '../types';
import type { TraceDirection } from '../backtrack';

export default function EntityStepper({ entities, step, active, connectionCount, onStep, onDetails, onTrace, onFullMap, onResume }: { entities: Entity[]; step: number; active: boolean; connectionCount: number; onStep: (step: number) => void; onDetails: () => void; onTrace: (direction: TraceDirection) => void; onFullMap: () => void; onResume: () => void }) {
  const [filter, setFilter] = useState('');
  const current = entities[step];
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!filter) activeButton.current?.scrollIntoView({ block: 'nearest' }); }, [step, filter]);
  const matches = entities.map((entity, index) => ({ entity, index })).filter(({ entity }) => `${entity.name} ${entity.group}`.toLowerCase().includes(filter.toLowerCase()));
  return <aside className="entity-stepper" aria-label="Entity walkthrough">
    <div className="stepper-heading"><span className="stepper-icon"><Compass size={17}/></span><div><strong>Entity walkthrough</strong><small>One step for every entity</small></div></div>
    <div className="stepper-progress"><span>{active ? `STEP ${step + 1} OF ${entities.length}` : 'FULL MAP'}</span><strong>{active ? `${Math.round((step + 1) / entities.length * 100)}%` : 'Explore'}</strong></div>
    <div className="stepper-track"><i style={{ width: active ? `${(step + 1) / entities.length * 100}%` : '100%' }}/></div>
    <div className="stepper-actions">{active ? <><button onClick={() => onStep(step - 1)} disabled={step === 0}><ArrowLeft size={14}/>Back</button><button className="next" onClick={() => onStep(step + 1)} disabled={step === entities.length - 1}>{step === entities.length - 1 ? 'Complete' : 'Next'}<ArrowRight size={14}/></button></> : <button className="next resume" onClick={onResume}><ArrowLeft size={14}/>Resume step {step + 1}</button>}</div>
    <div className="entity-stepper-current"><span>{active ? `ENTITY ${step + 1}` : 'PAUSED AT'}</span><strong>{current?.name || 'No entities'}</strong><small>{current?.group} · {connectionCount} {connectionCount === 1 ? 'link' : 'links'}</small><button onClick={onDetails}>Entity details <ArrowRight size={12}/></button><button onClick={() => onTrace('prerequisites')}><GitBranch size={12}/>Needs to create <ArrowRight size={12}/></button><button onClick={() => onTrace('dependents')}><ArrowUpRight size={12}/>Used by <ArrowRight size={12}/></button></div>
    <button className={`stepper-full ${active ? '' : 'active'}`} onClick={active ? onFullMap : onResume}><Layers3 size={14}/>{active ? 'View full map' : 'Return to walkthrough'}<ArrowRight size={13}/></button>
    <label className="entity-stepper-search"><Search size={13}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a step…" aria-label="Find an entity step"/></label>
    <div className="entity-stepper-list" role="list" aria-label="All entity steps">{matches.map(({ entity, index }) => <button key={entity.id} ref={index === step ? activeButton : undefined} role="listitem" className={`${active && index === step ? 'active' : ''} ${active && index < step ? 'complete' : ''}`} onClick={() => onStep(index)} aria-current={active && index === step ? 'step' : undefined} title={`${index + 1}. ${entity.name}`}><span className="stepper-number">{String(index + 1).padStart(2, '0')}</span><span className="stepper-copy"><strong>{entity.name}</strong><small>{entity.group}</small></span></button>)}{!matches.length && <p className="entity-stepper-empty">No matching entities</p>}</div>
  </aside>;
}
