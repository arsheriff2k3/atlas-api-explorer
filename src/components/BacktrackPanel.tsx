import { ArrowLeft, ArrowRight, GitBranch, Link2 } from 'lucide-react';
import type { BacktrackResult, TraceDirection } from '../backtrack';
import type { Requirement, RequirementFilter } from '../requirements';
import type { Operation } from '../types';
import type { CreationPlan } from '../callFlow';

interface Props {
  trace: BacktrackResult;
  direction: TraceDirection;
  scope: 'direct' | 'full';
  requirementFilter: RequirementFilter;
  requirementById: Map<string, Requirement>;
  callOperations: Operation[];
  callOperation: Operation | null;
  creationPlan: CreationPlan | null;
  onCallOperation: (id: string) => void;
  onFullBacktrack: () => void;
  onRequirementFilter: (filter: RequirementFilter) => void;
  onScope: (scope: 'direct' | 'full') => void;
  onDirection: (direction: TraceDirection) => void;
  onExit: () => void;
  onDetails: (id: string) => void;
  onTrace: (id: string, direction: TraceDirection) => void;
}

const requirementOptions: {value: RequirementFilter; label: string}[] = [
  {value: 'creation', label: 'Creation chain'},
  {value: 'call', label: 'This API call'},
  {value: 'all', label: 'All'},
  {value: 'required', label: 'Mandatory'},
  {value: 'optional', label: 'Optional'},
  {value: 'conditional', label: 'Conditional'},
  {value: 'unknown', label: 'Unspecified'},
];
const requirementLabels: Record<Requirement, string> = {required: 'mandatory', optional: 'optional', conditional: 'conditional', unknown: 'unspecified'};

export default function BacktrackPanel({ trace, direction, scope, requirementFilter, requirementById, callOperations, callOperation, creationPlan, onCallOperation, onFullBacktrack, onRequirementFilter, onScope, onDirection, onExit, onDetails, onTrace }: Props) {
  const prerequisites = direction === 'prerequisites';
  const callOnly = prerequisites && requirementFilter === 'call';
  const creationOnly = prerequisites && requirementFilter === 'creation';
  const displayedOperations = creationOnly ? callOperations.filter(operation => operation.method === 'POST' && /\b(?:create|add|provision|register)\b/i.test(operation.name)) : callOperations;
  const displayedOperation = creationOnly ? creationPlan?.steps.find(step => step.entity.id === trace.target?.id)?.operation || null : callOperation;
  const count = trace.entities.length - 1;
  const groups = prerequisites ? trace.groups : [...trace.groups].reverse();
  return <aside className="backtrack-panel" aria-label="Entity connection trace">
    <div className="backtrack-heading"><span><GitBranch size={17}/></span><div><strong>Entity connections</strong><small>Explore one direction at a time</small></div></div>
    <button className="backtrack-exit" onClick={onExit}><ArrowLeft size={13}/>Back to walkthrough</button>
    <div className="trace-switch" role="group" aria-label="Connection direction"><button className={prerequisites ? 'active' : ''} onClick={() => onDirection('prerequisites')}>Needs to create</button><button className={!prerequisites ? 'active' : ''} onClick={() => onDirection('dependents')}>Used by</button></div>
    <div className="backtrack-intro"><span>{creationOnly ? 'CREATION PLAN' : callOnly ? 'SELECTED API CALL' : 'SELECTED ENTITY'}</span><h3>{trace.target?.name}</h3><p>{creationOnly ? `${count} prerequisite ${count === 1 ? 'entity is' : 'entities are'} traced through required inputs to ${creationPlan?.terminalEntityIds.length || 0} root ${creationPlan?.terminalEntityIds.length === 1 ? 'entity' : 'entities'}.` : callOnly ? `${count} required entity ${count === 1 ? 'ID is' : 'IDs are'} passed to this endpoint.` : count ? `${count} ${prerequisites ? 'prerequisite' : 'dependent'} ${count === 1 ? 'entity' : 'entities'} in this view.` : `No ${prerequisites ? 'prerequisites' : 'dependents'} identified in this analysis.`}</p></div>
    {(callOnly || creationOnly) ? <div className="call-operation"><label htmlFor="trace-operation">TARGET API ENDPOINT</label><select id="trace-operation" value={displayedOperation?.id || ''} onChange={event => onCallOperation(event.target.value)}>{displayedOperations.length ? displayedOperations.map(operation => <option key={operation.id} value={operation.id}>{operation.method} · {operation.name}</option>) : <option value="">No create endpoint documented</option>}</select>{displayedOperation && <code>{displayedOperation.path}</code>}</div> : <div className="trace-switch trace-scope" role="group" aria-label="Connection depth"><button className={scope === 'direct' ? 'active' : ''} onClick={() => onScope('direct')}>Direct links</button><button className={scope === 'full' ? 'active' : ''} onClick={() => onScope('full')}>Full chain</button></div>}
    <div className="trace-requirements"><strong>REQUIREMENT</strong><div role="group" aria-label="Filter by requirement">{requirementOptions.map(option => <button key={option.value} className={requirementFilter === option.value ? 'active' : ''} onClick={() => onRequirementFilter(option.value)} aria-pressed={requirementFilter === option.value}>{option.label}</button>)}</div></div>
    <div className="backtrack-explainer">{creationOnly ? 'Create the farthest upstream resources first. Each card lists required request data; linked IDs come from the preceding entity, while “provide value” fields come from you.' : callOnly ? 'Only required linked IDs passed into this endpoint are shown. Earlier setup steps and response outcomes are outside this call.' : prerequisites ? 'These resources provide IDs referenced by the selected entity. Full chain follows their prerequisites too.' : 'These resources reference the selected entity. Full chain follows where they are used next.'}</div>
    <div className="backtrack-groups">{groups.map(group => <section key={group.distance} className="backtrack-group"><h4>{group.distance === 0 ? 'SELECTED' : group.distance === 1 ? (prerequisites ? 'DIRECT INPUTS' : 'DIRECT USERS') : `${group.distance} LINKS ${prerequisites ? 'UPSTREAM' : 'DOWNSTREAM'}`}</h4>{group.entities.map(entity => {
      const connections = trace.links.filter(link => prerequisites ? link.source === entity.id : link.target === entity.id).map(link => ({ link, other: trace.entities.find(item => item.id === (prerequisites ? link.target : link.source)) })).filter(item => item.other);
      const step = creationOnly ? creationPlan?.steps.find(item => item.entity.id === entity.id) : null;
      return <div className={`backtrack-card ${group.distance === 0 ? 'target' : ''}`} key={entity.id}><button className="backtrack-card-main" onClick={() => onDetails(entity.id)}><span className="backtrack-card-icon"><Link2 size={13}/></span><span><strong>{entity.name}</strong><small>{entity.group}</small></span><ArrowRight size={13}/></button>{step && <div className="creation-step"><span className="creation-endpoint">{step.operation ? <><b>{step.operation.method}</b><code>{step.operation.path}</code></> : <em>Existing ID required · no create endpoint documented</em>}</span>{step.requiredInputs.length ? <div className="creation-inputs">{step.requiredInputs.slice(0, 6).map(input => { const match = step.matches.find(item => item.input.name === input.name); const sources = [...new Set((match?.links || []).map(link => creationPlan?.steps.find(item => item.entity.id === link.source)?.entity.name).filter(Boolean))]; return <div key={input.name}><code>{input.name}</code><small>{sources.length ? `from ${sources.join(', ')}` : 'provide value'}</small></div> })}{step.requiredInputs.length > 6 && <small>+{step.requiredInputs.length - 6} more required fields</small>}</div> : <small className="creation-empty">No required request fields documented.</small>}{step.terminal && <span className="creation-root">ROOT · STOP BACKTRACKING</span>}</div>}{!creationOnly && connections.length > 0 && <div className="backtrack-fields">{connections.slice(0, 4).map(({ link, other }) => <div key={link.id}><code>{link.field}</code><span>{prerequisites ? `referenced by ${other!.name}` : `references ${other!.name}`}{link.status === 'inferred' ? ' · inferred' : ''} · {requirementLabels[requirementById.get(link.id) || 'unknown']}</span></div>)}{connections.length > 4 && <small>+{connections.length - 4} more links</small>}</div>}{group.distance > 0 && !creationOnly && <button className="backtrack-branch" onClick={() => onTrace(entity.id, direction)}>Explore from here</button>}</div>;
    })}</section>)}</div>
    {callOnly && <div className="call-outcomes"><p>Response objects and side effects are separate from the inputs needed for this call.</p><button onClick={onFullBacktrack}>Trace required data to roots <ArrowRight size={12}/></button></div>}
    {trace.truncated && <p className="backtrack-note">Showing a limited trace. The source analysis contains more links.</p>}
    {!callOnly && <p className="backtrack-note">Mandatory means the creation request requires this ID. Conditional applies only under documented conditions. Other links may appear to connect a matching entity back to your selection.</p>}
  </aside>;
}
