import test from 'node:test';
import assert from 'node:assert/strict';
import { entityTourSlice } from '../src/entityTour.ts';

const entities = Array.from({ length: 257 }, (_, index) => ({ id: `entity-${index + 1}`, name: `Entity ${index + 1}`, group: 'API', fields: [], operationIds: [] }));
const analysis = { entities, dependencies: [
  { source: 'entity-1', target: 'entity-2', type: 'id' },
  { source: 'entity-256', target: 'entity-257', type: 'schema' },
] };

test('each ordered entity has its own step, including first and last', () => {
  for (let step = 0; step < entities.length; step++) {
    assert.equal(entityTourSlice(analysis, entities, step).current.id, entities[step].id);
  }
  assert.deepEqual(entityTourSlice(analysis, entities, 0).all.map(entity => entity.id), ['entity-1', 'entity-2']);
  assert.deepEqual(entityTourSlice(analysis, entities, 256).all.map(entity => entity.id), ['entity-257', 'entity-256']);
});
