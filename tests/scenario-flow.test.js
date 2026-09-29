import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogicFlow } from '../src/scenarioFlow.ts';

const entity=(id,name)=>({id,name,fields:[],operationIds:[]});
const step=(e,terminal)=>({entity:e,operation:{method:'POST',path:`/${e.id}`,name:`Create ${e.name}`},requiredInputs:[],matches:[],unmatchedInputs:[{name:'name'}],terminal,terminalReason:terminal?'root':null});
const scenario={plan:{trace:{entities:[{id:'customer',name:'Customer'},{id:'sub',name:'Subscription'}],links:[{source:'customer',target:'sub',field:'customer_id'}]}},operation:{name:'Create a subscription',method:'POST',path:'/subs'},fields:[{field:{name:'plan_id'},need:'required'}],pathParams:[],
  cases:[{id:'c',label:'Item type',source:'',values:[{value:'plan',rules:[{field:'x',text:'Exactly one.'}],fields:[]},{value:'charge',rules:[],fields:[]}]}]};
const steps=[{step:step(entity('customer','Customer'),true),stage:'build'},{step:step(entity('sub','Subscription'),false),stage:'call'}];

test('prerequisites become yes/no checks and spec cases become a decision with branches',()=>{
  const flow=buildLogicFlow(scenario,steps);
  assert.deepEqual(flow.nodes.map(node=>node.kind),['start','check','create','decision','branch','branch','end']);
  const check=flow.nodes.find(node=>node.kind==='check');
  assert.equal(check.title,'Have a Customer?');
  assert.equal(check.lines[0],'Starting point: needs nothing else. Needed by Subscription (customer_id).');
  assert.deepEqual(flow.edges.filter(edge=>edge.source===check.id).map(edge=>edge.label).sort(),['No','Yes']);
  assert.equal(flow.edges.filter(edge=>edge.target==='end').length,2,'every branch reaches the request');
});
