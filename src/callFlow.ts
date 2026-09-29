import type { Analysis, Dependency, Entity, Field, Operation } from './types';
import type { BacktrackResult } from './backtrack';
import { inputRequirement, parentPath } from './requirements.ts';

const key = (value: string) => value.toLowerCase().replace(/\[\d+\]/g, '').replace(/[^a-z0-9]/g, '');
const createName = (name: string) => name.toLowerCase().replace(/^create\s+(?:a|an|the)\s+/, 'create ');

export function operationsForEntity(analysis: Analysis, entityId: string): Operation[] {
  const entity = analysis.entities.find(item => item.id === entityId);
  if (!entity) return [];
  const name = key(entity.name);
  const candidates = analysis.operations.filter(operation => entity.operationIds.includes(operation.id) &&
    (key(operation.name).includes(name) || operation.path.split('/').some(part => key(part).startsWith(name))));
  return candidates.sort((a, b) => {
    const rank = (operation: Operation) => createName(operation.name) === `create ${entity.name.toLowerCase()}` ? 0 : /^create\b/i.test(operation.name) ? 1 : operation.method === 'POST' ? 2 : 3;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
}

export function creationOperationForEntity(analysis: Analysis, entityId: string): Operation | null {
  return operationsForEntity(analysis, entityId).find(operation =>
    operation.method === 'POST' && /\b(?:create|add|provision|register)\b/i.test(operation.name)
  ) || null;
}

function matchScore(input: Field, link: Dependency): number {
  const inputName = key(input.name);
  const fieldName = key(link.field);
  if (inputName === fieldName) return 3;
  if (fieldName.length > 4 && inputName.endsWith(fieldName)) return 2;
  const inputLeaf = input.name.split(/[.[\]]/).filter(Boolean).at(-1) || input.name;
  return key(inputLeaf).length > 4 && fieldName === key(inputLeaf) ? 1 : 0;
}

export function requiredCallFlow(analysis: Analysis, entityId: string, operation: Operation, eligibleLinks = analysis.dependencies) {
  const requirement = new Map(operation.inputs.map(input => [input, inputRequirement(input, operation.inputs)]));
  const requiredInputs = operation.inputs.filter(input => requirement.get(input) === 'required');
  // Identifier options of a required object (owner.userId / owner.emailId) are
  // followed as links, but are not listed as values the caller must provide.
  const identifierInputs = operation.inputs.filter(input => requirement.get(input) === 'one-of');
  const candidates = eligibleLinks.filter(link => link.target === entityId && link.source !== entityId && (!link.targetOperation || link.targetOperation === operation.id));
  const chosen = new Map<string, Dependency>();
  const matchedInputs = new Set<string>();
  const matches: {input: Field; links: Dependency[]}[] = [];
  for (const input of [...requiredInputs, ...identifierInputs]) {
    const scored = candidates.map(link => ({link, score: matchScore(input, link)})).filter(item => item.score > 0);
    if (!scored.length) continue;
    const best = Math.max(...scored.map(item => item.score));
    const winners = scored.filter(item => item.score === best);
    // A generic field such as item_price_id cannot identify which nested
    // request parameter it represents when a precise path is available.
    const links = winners.map(({link}) => link);
    for (const link of links) chosen.set(link.id, link);
    matchedInputs.add(input.name);
    if (requirement.get(input) === 'one-of') { const parent = parentPath(input.name); if (parent) matchedInputs.add(parent); }
    matches.push({input, links});
  }
  const target = analysis.entities.find(entity => entity.id === entityId) || null;
  const sources = analysis.entities.filter(entity => [...chosen.values()].some(link => link.source === entity.id)).sort((a, b) => a.name.localeCompare(b.name));
  const groups = target ? [...(sources.length ? [{distance: 1, entities: sources}] : []), {distance: 0, entities: [target]}] : [];
  const trace: BacktrackResult = {target, groups, entities: groups.flatMap(group => group.entities), links: [...chosen.values()], truncated: false};
  return {trace, requiredInputs, unmatchedInputs: requiredInputs.filter(input => !matchedInputs.has(input.name)), matches};
}

export interface CreationStep {
  entity: Entity;
  operation: Operation | null;
  requiredInputs: Field[];
  matches: {input: Field; links: Dependency[]}[];
  unmatchedInputs: Field[];
  terminal: boolean;
  terminalReason: 'root' | 'existing' | null;
}

export interface CreationPlan {
  trace: BacktrackResult;
  steps: CreationStep[];
  terminalEntityIds: string[];
}

/** Follow required IDs through each resource's create endpoint until no earlier
 * documented creation dependency remains. Required scalar inputs stay on the
 * step so the UI can show data the caller must supply directly. */
export function buildCreationPlan(analysis: Analysis, entityId: string, rootOperation?: Operation | null, eligibleLinks = analysis.dependencies): CreationPlan {
  const byId = new Map(analysis.entities.map(entity => [entity.id, entity]));
  const steps = new Map<string, CreationStep>();
  const chosenLinks = new Map<string, Dependency>();
  const visiting = new Set<string>();

  const visit = (currentId: string, operation: Operation | null) => {
    const entity = byId.get(currentId);
    if (!entity || steps.has(currentId) || visiting.has(currentId)) return;
    visiting.add(currentId);
    const flow = operation ? requiredCallFlow(analysis, currentId, operation, eligibleLinks) : null;
    const matches = flow?.matches || [];
    for (const {links} of matches) for (const link of links) chosenLinks.set(link.id, link);
    const sourceIds = [...new Set(matches.flatMap(match => match.links.map(link => link.source)))];
    const terminal = sourceIds.length === 0;
    steps.set(currentId, {
      entity,
      operation,
      requiredInputs: flow?.requiredInputs || [],
      matches,
      unmatchedInputs: flow?.unmatchedInputs || [],
      terminal,
      terminalReason: terminal ? (operation ? 'root' : 'existing') : null,
    });
    for (const sourceId of sourceIds) visit(sourceId, creationOperationForEntity(analysis, sourceId));
    visiting.delete(currentId);
  };

  visit(entityId, rootOperation === undefined ? creationOperationForEntity(analysis, entityId) : rootOperation);
  const target = byId.get(entityId) || null;
  const distances = new Map<string, number>(target ? [[entityId, 0]] : []);
  const queue = target ? [entityId] : [];
  for (let index = 0; index < queue.length; index++) {
    const currentId = queue[index];
    for (const link of chosenLinks.values()) {
      if (link.target !== currentId || distances.has(link.source) || !byId.has(link.source)) continue;
      distances.set(link.source, distances.get(currentId)! + 1);
      queue.push(link.source);
    }
  }
  // Layer by depth from the roots: anything that needs nothing starts in the first
  // column (Customer beside Item family, not beside Item price), and every entity sits
  // one column after its deepest prerequisite. The pass cap stops cycles.
  const depth = new Map([...distances.keys()].map(id => [id, 0]));
  for (let pass = 0, changed = true; changed && pass < depth.size; pass++) {
    changed = false;
    for (const link of chosenLinks.values()) {
      if (!depth.has(link.source) || !depth.has(link.target) || link.source === link.target) continue;
      const next = depth.get(link.source)! + 1;
      if (next > depth.get(link.target)!) { depth.set(link.target, next); changed = true; }
    }
  }
  const deepest = target ? depth.get(entityId)! : 0;
  for (const [id, value] of depth) distances.set(id, id === entityId ? 0 : Math.max(1, deepest - value));
  const links = [...chosenLinks.values()].filter(link => distances.has(link.source) && distances.has(link.target) && distances.get(link.source)! > distances.get(link.target)!);
  const groups = [...new Set(distances.values())].sort((a, b) => b - a).map(distance => ({
    distance,
    entities: analysis.entities.filter(entity => distances.get(entity.id) === distance).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const trace: BacktrackResult = {target, groups, entities: groups.flatMap(group => group.entities), links, truncated: false};
  const orderedSteps = trace.entities.map(entity => steps.get(entity.id)).filter((step): step is CreationStep => !!step);
  return {trace, steps: orderedSteps, terminalEntityIds: orderedSteps.filter(step => step.terminal).map(step => step.entity.id)};
}
