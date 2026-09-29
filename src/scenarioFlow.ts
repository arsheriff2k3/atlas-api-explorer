import type { CreationStep } from './callFlow.ts';
import type { Scenario } from './scenarios.ts';

// The if/else logic of a scenario comes from prerequisite checks and specification cases.

export type FlowNodeKind = 'start' | 'check' | 'create' | 'decision' | 'branch' | 'end';
export interface FlowNode { id: string; kind: FlowNodeKind; title: string; lines: string[]; source: 'spec' | 'plan'; step?: CreationStep }
export interface FlowEdge { id: string; source: string; target: string; label?: string; kind?: 'yes' | 'no' | 'branch' }
export interface LogicFlow { nodes: FlowNode[]; edges: FlowEdge[] }

export interface FlowStep { step: CreationStep; stage: 'existing' | 'build' | 'call' }

const clip = (text: string, max = 110) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function buildLogicFlow(scenario: Scenario, steps: FlowStep[]): LogicFlow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const link = (source: string, target: string, label?: string, kind?: FlowEdge['kind']) => edges.push({id: `${source}->${target}:${label || ''}`, source, target, label, kind});
  const {operation} = scenario;
  nodes.push({id: 'start', kind: 'start', title: operation.name, lines: [`${operation.method} ${operation.path}`], source: 'plan'});
  // Open ends that the next node joins: [nodeId, edge label, edge kind].
  let open: [string, string | undefined, FlowEdge['kind']][] = [['start', undefined, undefined]];
  const join = (target: string) => { for (const [source, label, kind] of open) link(source, target, label, kind); };

  // An existing record implies its own prerequisites: only ask about the record itself.
  const existing = steps.filter(item => item.stage === 'existing');
  const existingTarget = existing.at(-1);
  const visible = steps.filter(item => item.stage !== 'existing' || item === existingTarget);
  const ends = new Map<string, [string, string | undefined, FlowEdge['kind']][]>();
  for (const current of visible) {
    const {step, stage} = current;
    if (stage === 'call') continue;
    const entity = step.entity;
    const check = `check:${entity.id}:${stage}`;
    const users = [...new Set(scenario.plan.trace.links.filter(item => item.source === entity.id).map(item => `${scenario.plan.trace.entities.find(other => other.id === item.target)?.name} (${item.field})`))];
    const needed = stage === 'existing' ? `The endpoint works on an existing ${entity.name} (its ID is in the path).` : `${step.terminal ? 'Starting point: needs nothing else. ' : ''}Needed by ${users.join(', ') || 'a later step'}.`;
    nodes.push({id: check, kind: 'check', title: stage === 'existing' ? `Have an existing ${entity.name}?` : `Have ${/^[aeiou]/i.test(entity.name) ? 'an' : 'a'} ${entity.name}?`, lines: [needed], source: 'plan', step});
    // Parallel lanes: a check waits only for the prerequisites it actually depends on.
    const preds = visible.filter(other => other.stage !== 'call' && other !== current && scenario.plan.trace.links.some(item => item.source === other.step.entity.id && item.target === entity.id)).map(other => ends.get(other.step.entity.id)!).filter(Boolean);
    if (preds.length) for (const [source, label, kind] of preds.flat()) link(source, check, label, kind);
    else for (const [source, label, kind] of open) link(source, check, label, kind);
    const create = `create:${entity.id}:${stage}`;
    const values = step.unmatchedInputs.filter(input => !/(?:^|\.)id$/i.test(input.name)).map(input => input.name);
    nodes.push({id: create, kind: 'create', title: `Create ${entity.name}`, lines: step.operation ? [`${step.operation.method} ${step.operation.path}`, ...(values.length ? [`Provide: ${clip(values.slice(0, 5).join(', '), 90)}`] : [])] : ['No create endpoint found; use an existing ID'], source: 'plan', step});
    if (stage === 'existing' && existing.length > 1) nodes.at(-1)!.lines.push(`First: ${existing.slice(0, -1).map(item => item.step.entity.name).join(' → ')}`);
    link(check, create, 'No', 'no');
    ends.set(entity.id, [[check, 'Yes', 'yes'], [create, undefined, undefined]]);
  }
  // Lanes that nothing else in the chain waits for join into the next stage.
  const laneEnds = visible.filter(item => item.stage !== 'call' && ends.has(item.step.entity.id) && !visible.some(other => other.stage !== 'call' && other !== item && ends.has(other.step.entity.id) && scenario.plan.trace.links.some(link => link.source === item.step.entity.id && link.target === other.step.entity.id)));
  if (laneEnds.length) open = laneEnds.flatMap(item => ends.get(item.step.entity.id)!);

  const decisions: {question: string; source: 'spec'; branches: {answer: string; lines: string[]}[]}[] = [];
  for (const item of scenario.cases.slice(0, 3)) decisions.push({question: `${item.label}?`, source: 'spec', branches: item.values.slice(0, 7).map(value => ({answer: value.value, lines: value.rules.length ? value.rules.slice(0, 2).map(rule => clip(`${rule.field.split('.').at(-1)}: ${rule.text}`, 120)) : ['No extra rules in the specification']}))});
  decisions.forEach((decision, index) => {
    const id = `decision:${index}`;
    nodes.push({id, kind: 'decision', title: decision.question, lines: [], source: decision.source});
    join(id);
    open = [];
    decision.branches.forEach((branch, branchIndex) => {
      const branchId = `${id}:branch:${branchIndex}`;
      nodes.push({id: branchId, kind: 'branch', title: branch.answer, lines: branch.lines, source: decision.source});
      link(id, branchId, clip(branch.answer, 28), 'branch');
      open.push([branchId, undefined, undefined]);
    });
  });

  const required = scenario.fields.filter(item => item.need === 'required' || item.need === 'one-of').map(item => item.field.name);
  nodes.push({id: 'end', kind: 'end', title: 'Send the request', lines: [required.length ? `Always send: ${clip(required.join(', '), 120)}` : 'No body fields are always required', ...(scenario.pathParams.length ? [`Path: ${scenario.pathParams.map(param => `{${param.name}}`).join(', ')}`] : [])], source: 'plan'});
  join('end');
  return {nodes, edges};
}
