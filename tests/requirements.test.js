import test from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.ts';
import { traceConnections } from '../src/backtrack.ts';
import { filterTraceByRequirement, requirementForDependency } from '../src/requirements.ts';

const link = field => demo.dependencies.find(dependency => dependency.field === field);

test('creation inputs distinguish mandatory, conditional, optional, and unspecified links', () => {
  assert.equal(requirementForDependency(demo, link('subscription_items[].item_price_id')), 'required');
  assert.equal(requirementForDependency(demo, link('item_id')), 'required');
  assert.equal(requirementForDependency(demo, link('item_family_id')), 'conditional');
  assert.equal(requirementForDependency(demo, link('subscription_id')), 'optional');
  assert.equal(requirementForDependency(demo, link('content.subscription')), 'unknown');
});

test('requirement filter keeps paths to matching links without unrelated branches', () => {
  const requirements = new Map(demo.dependencies.map(dependency => [dependency.id, requirementForDependency(demo, dependency)]));
  const upstream = traceConnections(demo, 'subscription', 'prerequisites');
  const flow = filterTraceByRequirement(upstream, 'prerequisites', 'required', requirements);
  assert.equal(flow.entities.some(entity => entity.id === 'item-price'), true);
  assert.equal(flow.entities.some(entity => entity.id === 'item'), true);
  assert.equal(flow.entities.some(entity => entity.id === 'item-family'), false);
  const conditional = filterTraceByRequirement(upstream, 'prerequisites', 'conditional', requirements);
  assert.deepEqual(conditional.entities.map(entity => entity.id), ['item-family', 'item', 'item-price', 'subscription']);
  assert.equal(conditional.links.some(link => link.source === 'customer'), false);
  const optional = filterTraceByRequirement(traceConnections(demo, 'subscription', 'dependents'), 'dependents', 'optional', requirements);
  assert.deepEqual(new Set(optional.entities.map(entity => entity.id)), new Set(['subscription', 'invoice']));
});

test('a generic required id does not make an unrelated reference mandatory', () => {
  const analysis = {entities: [{id: 'family', name: 'Item family', operationIds: []}, {id: 'price', name: 'Item price', operationIds: ['create-price'], fields: []}], operations: [{id: 'create-price', name: 'Create an item price', method: 'POST', inputs: [{name: 'id', required: true, description: ''}]}], dependencies: []};
  const dependency = {id: 'family-price', source: 'family', target: 'price', field: 'item_family_id', evidence: 'Id of the item family'};
  assert.equal(requirementForDependency(analysis, dependency), 'unknown');
});
