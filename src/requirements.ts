import type { Analysis, Dependency, Field } from './types';
import type { BacktrackResult, TraceDirection } from './backtrack';

export type Requirement = 'required' | 'optional' | 'conditional' | 'unknown';
export type RequirementFilter = 'call' | 'creation' | 'all' | Requirement;

const normalize = (value: string) => value.toLowerCase().replace(/\[\d+\]/g, '').replace(/[^a-z0-9]/g, '');
const leaf = (value: string) => normalize(value.split(/[.[\]]/).filter(Boolean).at(-1) || value);
const conditional = (text: string) => /\b(?:required|mandatory|optional)\s+(?:only\s+)?(?:if|when)\b|\b(?:if|when|only when)\b.{0,100}\b(?:enabled|configured|provided|available|supported)\b/i.test(text);

export const parentPath = (name: string) => name.match(/^(.*?)(?:\[\])?\.[^.]+$/)?.[1] || null;

/** A request field's real requirement once its parent objects are considered:
 * `notes[].fieldId` is only needed when the optional `notes` array is sent, while
 * an optional `accountOwner.userId` is one way to fill a required `accountOwner`.
 * Only optional arrays gate their children: specs such as Chargebee mark
 * `subscription_items` optional although `subscription_items.item_price_id` is
 * required on every call. */
export function inputRequirement(input: Field, inputs: Field[]): 'required' | 'optional' | 'one-of' | 'if-parent' {
  const byName = new Map(inputs.map(item => [item.name, item]));
  const ancestorsRequired = (name: string) => {
    for (let parent = parentPath(name); parent; parent = parentPath(parent)) if (byName.get(parent)?.required === false && name.startsWith(`${parent}[]`)) return false;
    return true;
  };
  if (input.required) return ancestorsRequired(input.name) ? 'required' : 'if-parent';
  const parent = parentPath(input.name);
  const parentInput = parent ? byName.get(parent) : undefined;
  return parentInput?.required && ancestorsRequired(parentInput.name) ? 'one-of' : 'optional';
}

function matchingInputs(inputs: Field[], field: string): Field[] {
  const full = normalize(field);
  const end = leaf(field);
  const exact = inputs.filter(input => normalize(input.name) === full);
  if (exact.length) return exact;
  const path = inputs.filter(input => {
    const name = normalize(input.name);
    return (full.length > 3 && name.endsWith(full)) || (name.length > 3 && full.endsWith(name));
  });
  if (path.length) return path;
  return end.length > 3 ? inputs.filter(input => normalize(input.name).endsWith(end)) : [];
}

export function requirementForDependency(analysis: Analysis, link: Dependency): Requirement {
  const target = analysis.entities.find(entity => entity.id === link.target);
  const namedOperation = link.targetOperation && analysis.operations.find(operation => operation.id === link.targetOperation);
  const createOperations = analysis.operations.filter(operation =>
    target?.operationIds.includes(operation.id) && operation.method === 'POST' && /\b(?:create|add|provision|register)\b/i.test(operation.name)
  );
  const directName = target?.name.toLowerCase() || '';
  const createName = (name: string) => name.toLowerCase().replace(/^create\s+(?:a|an|the)\s+/, 'create ');
  const exact = createOperations.filter(operation => createName(operation.name) === `create ${directName}`);
  const primary = createOperations.filter(operation => createName(operation.name).startsWith(`create ${directName}`));
  const operations = namedOperation ? [namedOperation] : exact.length ? exact : primary.length ? primary : createOperations;
  const matched = operations.flatMap(operation => matchingInputs(operation.inputs, link.field).map(input => ({input, requirement: inputRequirement(input, operation.inputs)})));
  const inputs = matched.map(({input}) => input);
  const fieldDescription = matchingInputs(target?.fields || [], link.field).map(field => field.description).join(' ');
  const evidence = [link.evidence, ...inputs.map(input => input.description), fieldDescription].join(' ');
  if (conditional(evidence)) return 'conditional';
  if (matched.length) {
    if (matched.every(({requirement}) => requirement === 'required')) return 'required';
    if (matched.every(({requirement}) => requirement === 'optional')) return 'optional';
    return 'conditional';
  }
  if (link.required === true) return 'required';
  if (link.required === false) return 'optional';
  return 'unknown';
}

export function filterTraceByRequirement(trace: BacktrackResult, direction: TraceDirection, filter: RequirementFilter, requirements: Map<string, Requirement>): BacktrackResult {
  if (filter === 'all' || filter === 'call' || filter === 'creation' || !trace.target) return trace;
  const selected = new Map(trace.links.filter(link => requirements.get(link.id) === filter).map(link => [link.id, link]));
  const pending = [...selected.values()].map(link => direction === 'prerequisites' ? link.target : link.source);
  const visited = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node) || node === trace.target.id) continue;
    visited.add(node);
    for (const link of trace.links) {
      if ((direction === 'prerequisites' ? link.source : link.target) !== node) continue;
      selected.set(link.id, link);
      pending.push(direction === 'prerequisites' ? link.target : link.source);
    }
  }
  const ids = new Set([trace.target.id, ...[...selected.values()].flatMap(link => [link.source, link.target])]);
  const groups = trace.groups.map(group => ({...group, entities: group.entities.filter(entity => ids.has(entity.id))})).filter(group => group.entities.length);
  return {...trace, groups, entities: groups.flatMap(group => group.entities), links: [...selected.values()]};
}
