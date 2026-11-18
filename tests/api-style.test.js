import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMixedStyles, sliceByStyle } from '../src/apiStyle.ts';

const op=(id,method,entityIds)=>({id,name:id,method,path:`/${id}`,description:'',inputs:[],outputs:[],entityIds,source:''});
const entity=(id,operationIds)=>({id,name:id,api:'x',group:'',description:'',fields:[],source:'',operationIds,kind:'resource'});
const link=(source,target)=>({id:`${source}>${target}`,source,target,field:'id',type:'id',status:'inferred',evidence:''});
const analysis={id:'a',name:'QB',version:'',createdAt:'',urls:[],patterns:[],warnings:[],sources:[],coverage:{},
  entities:[entity('employee',['get-employee']),entity('time',['get-time','create-time']),entity('project',['projects'])],
  operations:[op('get-employee','GET',['employee']),op('get-time','GET',['time']),op('create-time','MUTATION',['time']),op('projects','QUERY',['project','employee'])],
  dependencies:[link('employee','time'),link('employee','project')]};

test('REST and GraphQL slices keep their endpoints, resources, and the prerequisites linked into them',()=>{
  assert.equal(hasMixedStyles(analysis),true);
  const rest=sliceByStyle(analysis,'rest');
  assert.deepEqual(rest.operations.map(o=>o.id),['get-employee','get-time']);
  assert.deepEqual(rest.entities.map(e=>[e.id,e.operationIds]),[['employee',['get-employee']],['time',['get-time']]]);
  assert.deepEqual(rest.dependencies.map(d=>d.id),['employee>time']);
  const graphql=sliceByStyle(analysis,'graphql');
  // Employee has no GraphQL endpoint but is a prerequisite of GraphQL resources: kept as context.
  assert.deepEqual(graphql.entities.map(e=>[e.id,e.operationIds]),[['time',['create-time']],['project',['projects']],['employee',[]]]);
  assert.deepEqual(graphql.operations.find(o=>o.id==='projects').entityIds,['project']);
  assert.deepEqual(graphql.dependencies.map(d=>d.id),['employee>time','employee>project']);
  assert.equal(sliceByStyle(analysis,'all'),analysis);
  assert.equal(hasMixedStyles(rest),false);
});
