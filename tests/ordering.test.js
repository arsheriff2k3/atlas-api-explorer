import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEntities } from '../src/ordering.ts';

const entities = ['Invoice', 'Subscription', 'Customer', 'Item'].map(name => ({id:name.toLowerCase(),name}));
const links = [
  {source:'customer',target:'subscription'},
  {source:'subscription',target:'invoice'},
  {source:'item',target:'subscription'},
];

test('dependency order puts prerequisites before their consumers', () => {
  const ordered = orderEntities(entities, links).map(e => e.id);
  assert.ok(ordered.indexOf('customer') < ordered.indexOf('subscription'));
  assert.ok(ordered.indexOf('item') < ordered.indexOf('subscription'));
  assert.ok(ordered.indexOf('subscription') < ordered.indexOf('invoice'));
  assert.deepEqual(ordered, orderEntities([...entities].reverse(), [...links].reverse()).map(e => e.id));
});

test('cycles stay deterministic and alternate orders are explicit', () => {
  const cyclic = [...links, {source:'invoice',target:'customer'}];
  assert.equal(new Set(orderEntities(entities, cyclic).map(e => e.id)).size, entities.length);
  assert.deepEqual(orderEntities(entities, links, 'alphabetical').map(e => e.name), ['Customer','Invoice','Item','Subscription']);
  assert.equal(orderEntities(entities, links, 'connected')[0].id, 'subscription');
});
