import type { Analysis, Entity, Field, Operation } from './types';
import { buildScenario, scenariosForEntity } from './scenarios.ts';
import type { Scenario } from './scenarios.ts';
import { creationOperationForEntity } from './callFlow.ts';

// A flow is an ordered list of endpoint calls. Each call's linked-ID inputs are
// bound to the response of an earlier call that creates that entity, so the
// flow reads like an integration script: step 2 uses step 1's customer id.

export interface Binding { input: Field; entity: Entity; fromStep: number | null; responseField: string | null }
export interface FlowCall { index: number; operation: Operation; entity: Entity; scenario: Scenario; bindings: Binding[]; creates: Entity | null }
export interface FlowPlan { calls: FlowCall[]; missing: {step: number; entity: Entity; create: Operation | null}[] }

const key = (value: string) => value.toLowerCase().replace(/ies$/, 'y').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
const leaf = (name: string) => name.split(/[.[\]]/).filter(Boolean).at(-1) || name;

/** The entity an endpoint is "about": the one it creates, changes, or belongs to. */
export function primaryEntity(analysis: Analysis, operation: Operation): Entity | null {
  const candidates = analysis.entities.filter(entity => operation.entityIds.includes(entity.id) || entity.operationIds.includes(operation.id));
  const named = candidates.find(entity => key(operation.name).includes(key(entity.name)));
  return named || candidates[0] || null;
}

/** Response field that carries the new record's ID (id, customer.id, customer_id…). */
export function responseIdField(operation: Operation, entity: Entity): string | null {
  const name = key(entity.name);
  const outputs = operation.outputs.map(output => output.name);
  return outputs.find(output => key(output) === `${name}id` && /\.id$|^id$/i.test(output) === false && /\.?id$/i.test(output) && output.split('.').length === 2)
    || outputs.find(output => output.split('.').length === 2 && key(output.split('.')[0]) === name && /^id$/i.test(output.split('.')[1]))
    || outputs.find(output => /^id$/i.test(output))
    || outputs.find(output => key(leaf(output)) === `${name}id`)
    || null;
}

export function buildFlowPlan(analysis: Analysis, operationIds: string[]): FlowPlan {
  const calls: FlowCall[] = [];
  const missing: FlowPlan['missing'] = [];
  const createdAt = new Map<string, number>();
  operationIds.forEach(id => {
    const operation = analysis.operations.find(item => item.id === id);
    if (!operation) return;
    const entity = primaryEntity(analysis, operation);
    if (!entity) return;
    const summary = scenariosForEntity(analysis, entity.id).find(item => item.operation.id === id);
    const scenario = buildScenario(analysis, entity.id, operation, summary?.group || 'create');
    if (!scenario) return;
    const index = calls.length;
    const bindings: Binding[] = [];
    const seen = new Set<string>();
    // Linked body fields plus path parameters such as {customer-id}.
    const linked = scenario.fields.filter(item => item.link && (item.need === 'required' || item.need === 'one-of')).map(item => ({input: item.field, entity: item.link!}));
    for (const param of scenario.pathParams) {
      const target = analysis.entities.find(item => key(param.name.replace(/[-_]?id$/i, '')) === key(item.name));
      if (target) linked.unshift({input: param, entity: target});
    }
    for (const {input, entity: needed} of linked) {
      if (seen.has(needed.id)) continue; seen.add(needed.id);
      const fromStep = createdAt.get(needed.id) ?? null;
      const source = fromStep === null ? null : calls[fromStep];
      bindings.push({input, entity: needed, fromStep, responseField: source ? responseIdField(source.operation, needed) : null});
      if (fromStep === null) missing.push({step: index, entity: needed, create: creationOperationForEntity(analysis, needed.id)});
    }
    const creates = summary?.group === 'create' ? entity : null;
    if (creates && !createdAt.has(creates.id)) createdAt.set(creates.id, index);
    calls.push({index, operation, entity, scenario, bindings, creates});
  });
  return {calls, missing};
}

/** Adds the create calls for missing prerequisites (recursively), before the step that needs them. */
export function withMissingSteps(analysis: Analysis, operationIds: string[]): string[] {
  let ids = [...operationIds];
  for (let pass = 0; pass < 12; pass++) {
    const plan = buildFlowPlan(analysis, ids);
    const next = plan.missing.find(item => item.create && !ids.includes(item.create.id));
    if (!next?.create) break;
    const at = ids.indexOf(plan.calls[next.step].operation.id);
    ids = [...ids.slice(0, at), next.create.id, ...ids.slice(at)];
  }
  return ids;
}

export function flowMarkdown(analysis: Analysis, name: string, plan: FlowPlan): string {
  const out = [`# ${name}`, '', `**${analysis.name}** · ${plan.calls.length} calls`, ''];
  for (const call of plan.calls) {
    out.push(`## ${call.index + 1}. ${call.operation.name}`, '', `\`${call.operation.method} ${call.operation.path}\``, '');
    for (const binding of call.bindings) out.push(binding.fromStep === null ? `- \`${binding.input.name}\`: **existing ${binding.entity.name} ID** (not created in this flow)` : `- \`${binding.input.name}\` ← step ${binding.fromStep + 1} response \`${binding.responseField || 'id'}\``);
    out.push('', '```json', JSON.stringify(call.scenario.payload, null, 2), '```', '');
  }
  return out.join('\n');
}
