import type { Analysis, Dependency, Entity, Field, Operation } from './types';
import { buildCreationPlan, creationOperationForEntity } from './callFlow.ts';
import type { CreationPlan } from './callFlow.ts';
import { inputRequirement, parentPath } from './requirements.ts';

// A scenario is one way to create, change, or use an entity through a single
// endpoint, with everything derived from the specification: build order,
// the cases that change its logic, rule sentences, and a minimal payload.

export type ScenarioGroup = 'create' | 'change' | 'uses' | 'preview';
export const SCENARIO_GROUPS: {id: ScenarioGroup; label: string}[] = [
  {id: 'create', label: 'Create or import'},
  {id: 'change', label: 'Change an existing record'},
  {id: 'uses', label: 'Other endpoints that use it'},
  {id: 'preview', label: 'Previews and estimates'},
];
export interface ScenarioSummary { operation: Operation; group: ScenarioGroup }

export type FieldNeed = 'required' | 'one-of' | 'conditional' | 'optional';
export interface ScenarioField { field: Field; need: FieldNeed; link?: Entity; rules: ScenarioRule[]; choice?: string }
export interface ScenarioRule { field: string; text: string; kind: 'applies-to' | 'condition' | 'constraint' | 'default'; when?: {field: string; value: string}; appliesTo: string[] }
export interface ScenarioCaseValue { value: string; rules: ScenarioRule[]; fields: string[] }
export interface ScenarioCase { id: string; label: string; source: string; values: ScenarioCaseValue[] }
export interface Scenario {
  entity: Entity;
  operation: Operation;
  group: ScenarioGroup;
  existing: boolean;
  plan: CreationPlan;
  existingPlan: CreationPlan | null;
  fields: ScenarioField[];
  rules: ScenarioRule[];
  cases: ScenarioCase[];
  payload: unknown;
  pathParams: Field[];
  response: Field[];
}

const key = (value: string) => value.toLowerCase().replace(/\[\]/g, '').replace(/ies$/, 'y').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
const leaf = (name: string) => name.split(/[.[\]]/).filter(Boolean).at(-1) || name;
const isWrite = (operation: Operation) => operation.kind !== 'webhook' && operation.method !== 'GET' && operation.method !== 'HEAD' && operation.method !== 'OPTIONS';
const isEstimate = (operation: Operation) => /\b(?:estimate|preview|dry.?run)s?\b/i.test(`${operation.name} ${operation.path}`);
const ownIdParam = (operation: Operation, entity: Entity) => (operation.path.match(/\{([^}]+)\}/g) || []).some(param => key(param.replace(/[{}]/g, '').replace(/[-_]?id$/i, '')) === key(entity.name));
const takesEntityId = (operation: Operation, entity: Entity, requiredOnly = false) => operation.inputs.some(input => (!requiredOnly || inputRequirement(input, operation.inputs) === 'required') && key(leaf(input.name).replace(/[-_]?ids?$/i, '')) === key(entity.name) && /ids?$/i.test(leaf(input.name)));

/** Every write endpoint that creates, changes, or references the entity. */
export function scenariosForEntity(analysis: Analysis, entityId: string): ScenarioSummary[] {
  const entity = analysis.entities.find(item => item.id === entityId);
  if (!entity) return [];
  const name = key(entity.name);
  const result: ScenarioSummary[] = [];
  for (const operation of analysis.operations) {
    if (!isWrite(operation)) continue;
    const mentions = key(operation.name).includes(name) || operation.path.split('/').some(part => key(part).includes(name));
    let group: ScenarioGroup | null = null;
    if (ownIdParam(operation, entity)) group = 'change';
    else if (takesEntityId(operation, entity, true)) group = 'uses';
    else if (entity.operationIds.includes(operation.id) && mentions && /^(?:create|import|add|new|register|provision)\b/i.test(operation.name)) group = 'create';
    else if (takesEntityId(operation, entity)) group = 'uses';
    if (!group) continue;
    if (isEstimate(operation)) group = 'preview';
    result.push({operation, group});
  }
  const order = SCENARIO_GROUPS.map(item => item.id);
  const primary = creationOperationForEntity(analysis, entityId)?.id;
  return result.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || Number(b.operation.id === primary) - Number(a.operation.id === primary) || a.operation.name.localeCompare(b.operation.name));
}

const RULE = /\b(?:only (?:applies|applicable|relevant|used|valid)|appl(?:y|ies) (?:only )?to|applicable (?:only )?(?:when|if|for)|relevant only|required (?:if|when|only)|mandatory (?:if|when)|only (?:if|when)|if not (?:provided|specified|passed)|must(?: not)? be|must\b|cannot|can't|can not|not allowed|at least one|exactly one|either\b|mutually exclusive|defaults? to|is ignored)\b/i;
const sentences = (text: string) => text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z`(])/).map(item => item.trim()).filter(Boolean);
const whenPattern = /\b(?:when|if)\s+`?([a-z_][\w.[\]]*)`?\s*(?:=|is set to|is|equals)\s*`?([a-z0-9_-]+)`?/i;

function ruleKind(text: string): ScenarioRule['kind'] {
  if (/\bappl(?:y|ies)\b.*\bto\b|\bonly applies\b/i.test(text)) return 'applies-to';
  if (/\b(?:when|if)\b/i.test(text)) return 'condition';
  if (/\bdefaults? to\b|\bif not provided\b|autogenerated/i.test(text)) return 'default';
  return 'constraint';
}

/** Rule sentences stated in request field descriptions. */
export function specRules(fields: Field[]): ScenarioRule[] {
  const rules: ScenarioRule[] = [];
  for (const field of fields) {
    for (const text of sentences(field.description || '')) {
      if (!RULE.test(text) || text.length > 400) continue;
      const when = text.match(whenPattern);
      rules.push({field: field.name, text, kind: ruleKind(text), when: when ? {field: when[1], value: when[2]} : undefined, appliesTo: []});
    }
  }
  return rules;
}

const TYPE_FIELD = /^(?:type|item_?type|kind|category|pricing_?model|model|mode|plan_?type)$/i;
const valuePattern = (value: string) => new RegExp(`\\b${value.replace(/[-_]/g, '[-_ ]?')}(?:[- ]?(?:items?|type|s))?\\b`, 'i');

/** Case dimensions: enum type fields of the target and its prerequisites, plus
 * enum inputs that other rules depend on ("only when `apply_on` = ..."). */
export function scenarioCases(entities: Entity[], operation: Operation, rules: ScenarioRule[]): ScenarioCase[] {
  const cases: ScenarioCase[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string, source: string, values: string[]) => {
    const signature = values.slice().sort().join('|');
    if (seen.has(signature) || values.length < 2 || values.length > 12) return;
    // Item.type and Item.item_type repeat the same plan/addon/charge split.
    if (cases.some(existing => { const known = new Set(existing.values.map(item => item.value)); return values.filter(value => known.has(value)).length >= Math.min(known.size, values.length) * 0.6; })) return;
    const built = values.map(value => {
      const matching = rules.filter(rule => (rule.when && key(rule.when.value) === key(value)) || (value.length > 2 && valuePattern(value).test(rule.text) && rule.kind !== 'default'));
      return {value, rules: matching, fields: [...new Set(matching.map(rule => rule.field))]};
    });
    if (built.filter(item => item.rules.length).length < 2) return;
    seen.add(signature);
    cases.push({id, label, source, values: built});
  };
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (!field.enum?.length || !TYPE_FIELD.test(leaf(field.name))) continue;
      add(`${entity.id}:${field.name}`, `${entity.name} ${leaf(field.name).replace(/_/g, ' ')}`, `${entity.name}.${field.name}`, field.enum);
    }
  }
  const conditionFields = new Set(rules.map(rule => rule.when?.field).filter((item): item is string => !!item).map(key));
  for (const input of operation.inputs) {
    if (!input.enum?.length) continue;
    if (!conditionFields.has(key(leaf(input.name))) && !conditionFields.has(key(input.name)) && !TYPE_FIELD.test(leaf(input.name))) continue;
    add(`input:${input.name}`, input.name, 'Request field', input.enum);
  }
  for (const item of cases) for (const value of item.values) for (const rule of value.rules) if (!rule.appliesTo.includes(value.value)) rule.appliesTo.push(value.value);
  return cases;
}

function placeholder(field: Field, link?: Entity): unknown {
  if (link) return `<${link.name} id>`;
  if (field.enum?.length) return field.enum[0];
  const type = field.type.toLowerCase();
  if (/int|number|long|double|float|decimal/.test(type)) return 1;
  if (/bool/.test(type)) return false;
  if (/date|time/.test(type) || /(?:_at|_date|date)$/i.test(leaf(field.name))) return '2026-01-01T00:00:00Z';
  if (type === 'array') return [];
  if (type === 'object') return {};
  return `<${leaf(field.name)}>`;
}

/** The smallest request body that satisfies required and one-of fields. */
export function minimalPayload(fields: ScenarioField[]): unknown {
  const root: Record<string, unknown> = {};
  const chosen = fields.filter(item => item.need === 'required' || item.need === 'one-of');
  // For "choose one" groups prefer the option linked to an earlier step (owner.userId over owner.emailId).
  const groupOf = (item: ScenarioField) => item.choice || parentPath(item.field.name);
  const preferred = new Map<string, ScenarioField>();
  for (const item of chosen) if (item.need === 'one-of') { const group = groupOf(item); if (group && (!preferred.has(group) || (item.link && !preferred.get(group)!.link))) preferred.set(group, item); }
  for (const item of chosen) {
    const name = item.field.name;
    const group = groupOf(item);
    if (item.need === 'one-of' && group && preferred.get(group) !== item) continue;
    if (chosen.some(other => parentPath(other.field.name) === name)) continue;
    const path = name.split('.');
    // Form-encoded specs (Chargebee) type a list as an object whose members are
    // arrays: subscription_items[item_price_id][0] -> [{item_price_id}].
    const formList = path.length > 1 && item.field.type === 'array' && !name.includes('[]');
    if (formList) path[path.length - 2] += '[]';
    let node: Record<string, unknown> = root;
    for (const [index, raw] of path.entries()) {
      const array = raw.endsWith('[]'); const part = raw.replace(/\[\]$/, '');
      const last = index === path.length - 1;
      const value = placeholder(formList ? {...item.field, type: 'string'} : item.field, item.link);
      if (last) { node[part] = array ? [value] : value; break; }
      // Parent segments without "[]" may still be arrays in form-encoded specs; keep them as objects.
      if (array) { const list = (node[part] as Record<string, unknown>[] | undefined) || [{}]; node[part] = list; node = list[0]; }
      else { node[part] = (node[part] as Record<string, unknown>) || {}; node = node[part] as Record<string, unknown>; }
    }
  }
  return root;
}

function linkForInput(input: Field, links: Dependency[], byId: Map<string, Entity>, byName: Map<string, Entity>) {
  const exact = links.find(link => key(link.field) === key(input.name));
  const endsWith = exact || links.find(link => key(leaf(link.field)) === key(leaf(input.name)) && /ids?$/i.test(leaf(input.name)));
  // Fall back to the ID's name: subscription_id -> Subscription.
  return endsWith ? byId.get(endsWith.source) : byName.get(key(leaf(input.name).replace(/[-_]?ids?$/i, '')));
}

export function buildScenario(analysis: Analysis, entityId: string, operation: Operation, group: ScenarioGroup): Scenario | null {
  const entity = analysis.entities.find(item => item.id === entityId);
  if (!entity) return null;
  const byId = new Map(analysis.entities.map(item => [item.id, item]));
  const entityByName = new Map(analysis.entities.map(item => [key(item.name), item]));
  const existing = group === 'change' || ownIdParam(operation, entity);
  // The endpoint's own resource owns its required links (e.g. Invoice for an invoicing call).
  const owner = entity.operationIds.includes(operation.id) || existing ? entity : analysis.entities.find(item => item.operationIds.includes(operation.id)) || entity;
  const plan = buildCreationPlan(analysis, owner.id, operation);
  const existingPlan = existing || owner.id !== entity.id ? buildCreationPlan(analysis, entity.id, creationOperationForEntity(analysis, entity.id)) : null;
  const incoming = analysis.dependencies.filter(link => link.target === owner.id);
  const body = operation.inputs.filter(input => input.location !== 'path' && input.location !== 'header' && input.location !== 'cookie');
  const rules = specRules(body);
  const rulesByField = new Map<string, ScenarioRule[]>();
  for (const rule of rules) rulesByField.set(rule.field, [...(rulesByField.get(rule.field) || []), rule]);
  const byName = new Map(body.map(field => [field.name, field]));
  const optionalAncestor = (name: string) => { for (let parent = parentPath(name); parent; parent = parentPath(parent)) if (byName.get(parent)?.required === false) return parent; return null; };
  const either = new Map<string, string>();
  for (const rule of rules) {
    const other = rule.text.match(/\beither this or `?([a-z_][\w.]*)`?\b.*\b(?:must|should) be (?:provided|passed|specified)/i)?.[1];
    if (other && byName.has(other)) { const group = [rule.field, other].sort().join('|'); either.set(rule.field, group); either.set(other, group); }
  }
  const fields: ScenarioField[] = body.map(field => {
    const requirement = inputRequirement(field, body);
    const fieldRules = rulesByField.get(field.name) || [];
    // A bare `id` is the record's own identifier, never a reference to another entity.
    const link = /ids?$/i.test(leaf(field.name)) && !/^ids?$/i.test(leaf(field.name)) ? linkForInput(field, incoming, byId, entityByName) : undefined;
    const gate = requirement === 'required' ? optionalAncestor(field.name) : null;
    // Specs such as Chargebee mark the list optional but its item ID required; keep linked IDs
    // required (the creation chain relies on them) and make other members conditional.
    if (gate && !link) fieldRules.push({field: field.name, text: `Required when \`${gate}\` is sent.`, kind: 'condition', appliesTo: []});
    const choice = either.get(field.name);
    const need: FieldNeed = choice ? 'one-of' : requirement === 'required' && (!gate || link) ? 'required' : requirement === 'one-of' ? 'one-of' : requirement === 'if-parent' || gate || fieldRules.some(rule => rule.kind === 'condition' || rule.kind === 'applies-to') ? 'conditional' : 'optional';
    return {field, need, link, rules: fieldRules, choice};
  });
  const chainEntities = [...new Set([...plan.trace.entities, ...(existingPlan?.trace.entities || [])])];
  const cases = scenarioCases(chainEntities, operation, rules);
  return {
    entity, operation, group, existing, plan, existingPlan, fields, rules, cases,
    payload: minimalPayload(fields),
    pathParams: operation.inputs.filter(input => input.location === 'path'),
    response: operation.outputs.filter(output => !/[.[]/.test(output.name.replace(/^\[\]\.?/, ''))),
  };
}
