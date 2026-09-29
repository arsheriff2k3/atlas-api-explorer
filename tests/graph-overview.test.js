import test from 'node:test';
import assert from 'node:assert/strict';
import { keyOverviewLinks } from '../src/graphOverview.ts';

test('overview keeps one meaningful incoming link per entity', () => {
  const entities=['user','project','task'].map(id=>({id}));
  const links=[
    {id:'meta',source:'user',target:'task',field:'createdBy.userId',status:'inferred',type:'id'},
    {id:'project',source:'project',target:'task',field:'projectId',status:'documented',type:'id'},
    {id:'task-project',source:'user',target:'project',field:'owner.userId',status:'inferred',type:'id'},
  ];
  assert.deepEqual(keyOverviewLinks(links,entities).map(link=>link.id),['project','task-project']);
});
