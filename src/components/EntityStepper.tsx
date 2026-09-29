import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, List, Search } from 'lucide-react';
import type { Entity } from '../types';

export default function EntityStepper({ entities, step, connectionCount, onStep, onDetails }: {
  entities: Entity[];
  step: number;
  connectionCount: number;
  onStep: (step: number) => void;
  onDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const activeButton = useRef<HTMLButtonElement>(null);
  const current = entities[step];
  const matches = entities.map((entity, index) => ({ entity, index })).filter(({ entity }) =>
    `${entity.name} ${entity.group}`.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    if (open && !filter) activeButton.current?.scrollIntoView({ block: 'nearest' });
  }, [open, filter, step]);

  return <div className="entity-stepper" aria-label="Entity walkthrough">
    {open && <div className="entity-stepper-drawer" id="entity-step-list">
      <div className="stepper-drawer-title"><strong>All entities</strong><span>{entities.length} in reading order</span></div>
      <label className="entity-stepper-search"><Search size={14}/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find an entity" aria-label="Find an entity step"/></label>
      <div className="entity-stepper-list" role="list">{matches.map(({ entity, index }) =>
        <button key={entity.id} ref={index === step ? activeButton : undefined} role="listitem" className={index === step ? 'active' : ''} onClick={() => { onStep(index); setOpen(false); }} aria-current={index === step ? 'step' : undefined} title={`${index + 1}. ${entity.name}`}>
          <span className="stepper-number">{String(index + 1).padStart(2, '0')}</span><span className="stepper-copy"><strong>{entity.name}</strong><small>{entity.group}</small></span>
        </button>
      )}{!matches.length && <p className="entity-stepper-empty">No matching entities</p>}</div>
    </div>}
    <div className="stepper-summary"><span>Step {step + 1} of {entities.length}</span><button onClick={onDetails} title={`Open details for ${current?.name || 'entity'}`}>{current?.name || 'No entities'} <ArrowRight size={13}/></button><small>{connectionCount} {connectionCount === 1 ? 'connection' : 'connections'} in view</small></div>
    <div className="stepper-actions"><button onClick={() => onStep(step - 1)} disabled={step === 0}><ArrowLeft size={14}/>Back</button><button className="next" onClick={() => onStep(step + 1)} disabled={step === entities.length - 1}>Next<ArrowRight size={14}/></button></div>
    <button className="stepper-list-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="entity-step-list"><List size={15}/>All entities<ChevronDown size={14}/></button>
  </div>;
}
