import test from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/demo.ts';
import { buildCreationPlan, operationsForEntity, requiredCallFlow } from '../src/callFlow.ts';

test('the create-subscription call shows its required IDs without catalog setup or invoice outcomes', () => {
  const operation = operationsForEntity(demo, 'subscription')[0];
  assert.equal(operation.id, 'create-subscription');
  const {trace, unmatchedInputs} = requiredCallFlow(demo, 'subscription', operation);
  assert.deepEqual(new Set(trace.entities.map(entity => entity.id)), new Set(['customer', 'item-price', 'subscription']));
  assert.deepEqual(new Set(trace.links.map(link => link.field)), new Set(['customer_id', 'subscription_items[].item_price_id']));
  assert.equal(trace.entities.some(entity => entity.id === 'item'), false);
  assert.equal(trace.entities.some(entity => entity.id === 'invoice'), false);
  assert.deepEqual(unmatchedInputs, []);
  assert.equal(operation.outputs.some(output => output.name === 'invoice'), true);
});

test('the call matches a precise nested input before a generic ID link', () => {
  const operation = operationsForEntity(demo, 'subscription')[0];
  const generic = {id: 'generic-price', source: 'item-price', target: 'subscription', field: 'item_price_id'};
  const {trace} = requiredCallFlow({...demo, dependencies: [...demo.dependencies, generic]}, 'subscription', operation);
  assert.equal(trace.links.some(link => link.id === generic.id), false);
});

test('the creation plan follows required inputs to terminal roots and keeps scalar data', () => {
  const operation = operationsForEntity(demo, 'subscription')[0];
  const plan = buildCreationPlan(demo, 'subscription', operation);
  assert.deepEqual(new Set(plan.trace.entities.map(entity => entity.id)), new Set(['customer', 'item', 'item-price', 'subscription']));
  assert.equal(plan.trace.entities.some(entity => entity.id === 'item-family'), false, 'conditional prerequisites are not in the required chain');
  assert.deepEqual(new Set(plan.terminalEntityIds), new Set(['customer', 'item']));

  const item = plan.steps.find(step => step.entity.id === 'item');
  assert.equal(item.operation.id, 'create-item');
  assert.deepEqual(item.requiredInputs.map(input => input.name), ['id', 'name']);
  assert.deepEqual(item.unmatchedInputs.map(input => input.name), ['id', 'name']);

  const price = plan.steps.find(step => step.entity.id === 'item-price');
  assert.deepEqual(price.matches.map(match => match.input.name), ['item_id']);
  assert.equal(price.matches[0].links[0].source, 'item');
});

test('the creation plan stops at an existing entity when no create endpoint is documented', () => {
  const analysis = {
    ...demo,
    entities: demo.entities.map(entity => entity.id === 'customer' ? {...entity, operationIds: []} : entity),
  };
  const plan = buildCreationPlan(analysis, 'subscription', operationsForEntity(analysis, 'subscription')[0]);
  const customer = plan.steps.find(step => step.entity.id === 'customer');
  assert.equal(customer.terminal, true);
  assert.equal(customer.terminalReason, 'existing');
  assert.equal(customer.operation, null);
});

test('creation chains follow required objects by their ID and ignore IDs inside optional arrays',()=>{
  const field=(name,required)=>({name,type:'string',required,description:''});
  const resource=(id,name,operationIds)=>({id,name,api:'Example',group:'Resources',description:'',fields:[],source:'https://docs.example.com',operationIds,kind:'resource'});
  const create=(id,name,path,inputs)=>({id,name,method:'POST',path,description:'',inputs,outputs:[],entityIds:[],source:'https://docs.example.com'});
  const link=(source,target,fieldName)=>({id:`${source}>${target}:${fieldName}`,source,target,field:fieldName,type:'id',status:'inferred',evidence:'',sourceUrl:'https://docs.example.com'});
  const analysis={id:'x',name:'Example',version:'1',createdAt:'',urls:[],patterns:[],warnings:[],sources:[],mode:'structural',demo:false,
    coverage:{pagesRead:0,specifications:1,discovered:0,attempted:0,pageLimit:0,aiPages:0,complete:true},
    entities:[resource('user','User',['create-user']),resource('field','Field',['create-field']),resource('company','Company',['create-company']),resource('project','Project',['create-project'])],
    operations:[create('create-user','Create a user','/users',[field('email',true)]),create('create-field','Create a field','/fields',[field('fieldLabel',true)]),
      create('create-company','Create a company','/companies',[field('companyName',true),field('accountOwner',true),field('accountOwner.userId',false),field('notes',false),field('notes[].fieldId',true)]),
      create('create-project','Create a project','/projects',[field('projectName',true),field('owner',true),field('owner.userId',false),field('customer',true),field('customer.companyId',false)])],
    dependencies:[link('user','company','accountOwner.userId'),link('field','company','notes[].fieldId'),link('user','project','owner.userId'),link('company','project','customer.companyId')]};
  const plan=buildCreationPlan(analysis,'project');
  assert.deepEqual(plan.trace.groups.map(group=>group.entities.map(entity=>entity.id)),[['user'],['company'],['project']]);
  assert.deepEqual(plan.terminalEntityIds,['user']);
  assert.equal(plan.trace.entities.some(entity=>entity.id==='field'),false);
  const company=plan.steps.find(step=>step.entity.id==='company');
  assert.deepEqual(company.unmatchedInputs.map(input=>input.name),['companyName']);
});
