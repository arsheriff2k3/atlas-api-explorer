import test from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.ts';
import { traceConnections, traceDependents, tracePrerequisites } from '../src/backtrack.ts';

test('subscription backtrack follows the full product catalog and customer branches', () => {
  const trace = tracePrerequisites(demo, 'subscription');
  assert.deepEqual(trace.groups.map(group => group.entities.map(entity => entity.id)), [
    ['item-family'],
    ['item'],
    ['customer', 'item-price'],
    ['subscription'],
  ]);
  assert.deepEqual(trace.links.filter(link => link.source === 'item-family').map(link => link.field), ['item_family_id']);
  assert.equal(trace.links.some(link => link.source === 'item-price' && link.target === 'subscription' && link.field === 'subscription_items[].item_price_id'), true);
  assert.equal(trace.entities.some(entity => entity.id === 'invoice'), false);
});

test('backtrack stops safely at cycles and reports a bounded partial trace', () => {
  const entities = ['a', 'b', 'c'].map(id => ({ id, name: id }));
  const analysis = { entities, dependencies: [
    { id: 'ab', source: 'a', target: 'b', field: 'a_id' },
    { id: 'bc', source: 'b', target: 'c', field: 'b_id' },
    { id: 'ca', source: 'c', target: 'a', field: 'c_id' },
  ] };
  const trace = tracePrerequisites(analysis, 'c');
  assert.equal(trace.entities.length, 3);
  assert.equal(trace.truncated, false);
  assert.equal(tracePrerequisites(analysis, 'c', 2).truncated, true);
});

test('prerequisites and dependents stay separate, with direct and full-chain scopes', () => {
  const prerequisites = traceConnections(demo, 'subscription', 'prerequisites', 1);
  assert.deepEqual(new Set(prerequisites.entities.map(entity => entity.id)), new Set(['subscription', 'customer', 'item-price']));
  assert.equal(prerequisites.links.every(link => link.target === 'subscription'), true);
  const full = tracePrerequisites(demo, 'subscription');
  assert.equal(full.entities.some(entity => entity.id === 'item-family'), true);
  assert.equal(full.entities.some(entity => entity.id === 'invoice'), false);

  const directDependents = traceConnections(demo, 'subscription', 'dependents', 1);
  assert.deepEqual(new Set(directDependents.entities.map(entity => entity.id)), new Set(['subscription', 'invoice', 'event']));
  assert.equal(directDependents.links.every(link => link.source === 'subscription'), true);
  const fullDependents = traceDependents(demo, 'subscription');
  assert.equal(fullDependents.entities.some(entity => entity.id === 'credit-note'), true);
  assert.equal(fullDependents.entities.some(entity => entity.id === 'item-price'), false);
});
