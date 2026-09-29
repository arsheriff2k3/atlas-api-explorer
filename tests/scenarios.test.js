import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, minimalPayload, scenariosForEntity, specRules } from '../src/scenarios.ts';

const field=(name,type,required,description='',extra={})=>({name,type,required,description,location:'body',...extra});
const resource=(id,name,operationIds,fields=[])=>({id,name,api:'Billing',group:'Billing',description:'',fields,source:'https://docs.example.com',operationIds,kind:'resource'});
const op=(id,name,method,path,inputs)=>({id,name,method,path,description:'',inputs,outputs:[field('id','string',false)],entityIds:[],source:'https://docs.example.com/spec.json'});
const analysis={id:'a',name:'Billing',version:'1',createdAt:'',urls:[],patterns:[],warnings:[],sources:[],mode:'structural',demo:false,
  coverage:{pagesRead:0,specifications:1,discovered:0,attempted:0,pageLimit:0,aiPages:0,complete:true},
  entities:[
    resource('item','Item',['create-item'],[field('type','string',true,'',{enum:['plan','addon','charge']})]),
    resource('price','Item price',['create-price']),
    resource('customer','Customer',['create-customer']),
    resource('subscription','Subscription',['create-sub','charge-sub']),
    resource('invoice','Invoice',['create-invoice']),
  ],
  operations:[
    op('create-item','Create an item','POST','/items',[field('name','string',true)]),
    op('create-price','Create an item price','POST','/item_prices',[field('item_id','string',true)]),
    op('create-customer','Create a customer','POST','/customers',[field('email','string',true)]),
    op('create-sub','Create a subscription','POST','/customers/{customer-id}/subscription_for_items',[
      {...field('customer-id','string',true),location:'path'},
      field('subscription_items','object',false),
      field('subscription_items.item_price_id','array',true,'The item price.'),
      field('subscription_items.charge_once','array',false,'This parameter only applies to charge-items.'),
      field('subscription_items.trial_end','array',false,'Applies to plan-items and addon-items as well.'),
      field('discounts','object',false),
      field('discounts.duration_type','array',true),
    ]),
    op('charge-sub','Add charge at term end','POST','/subscriptions/{subscription-id}/add_charge_at_term_end',[{...field('subscription-id','string',true),location:'path'},field('amount','integer',false)]),
    op('create-invoice','Create invoice for charges','POST','/invoices/create_for_charges',[field('customer_id','string',false,'Either this or subscription_id must be provided.'),field('subscription_id','string',false,'Either this or customer_id must be provided.')]),
  ],
  dependencies:[
    {id:'l1',source:'item',target:'price',field:'item_id',type:'id',status:'inferred',evidence:'',sourceUrl:''},
    {id:'l2',source:'price',target:'subscription',field:'subscription_items.item_price_id',type:'id',status:'inferred',evidence:'',sourceUrl:''},
    {id:'l3',source:'customer',target:'subscription',field:'customer_id',type:'id',status:'inferred',evidence:'',sourceUrl:''},
  ]};

test('scenarios are grouped by what the endpoint does with the entity',()=>{
  const groups=Object.fromEntries(scenariosForEntity(analysis,'subscription').map(item=>[item.operation.id,item.group]));
  assert.deepEqual(groups,{'create-sub':'create','charge-sub':'change','create-invoice':'uses'});
});

test('a create scenario builds its chain, cases, and a minimal form-encoded payload',()=>{
  const scenario=buildScenario(analysis,'subscription',analysis.operations.find(item=>item.id==='create-sub'),'create');
  assert.deepEqual(scenario.plan.trace.groups.map(group=>group.entities.map(entity=>entity.name)),[['Customer','Item'],['Item price'],['Subscription']],'Customer has no prerequisites, so it starts in the first column');
  assert.deepEqual(scenario.payload,{subscription_items:[{item_price_id:'<Item price id>'}]},'optional discounts are left out');
  assert.equal(scenario.fields.find(item=>item.field.name==='discounts.duration_type').need,'conditional');
  const itemType=scenario.cases.find(item=>item.label==='Item type');
  assert.deepEqual(itemType.values.map(value=>[value.value,value.rules.length]),[['plan',1],['addon',1],['charge',1]]);
});

test('"either this or" fields become a single choice and existing-record actions keep the entity chain',()=>{
  const invoice=buildScenario(analysis,'subscription',analysis.operations.find(item=>item.id==='create-invoice'),'uses');
  assert.deepEqual(invoice.fields.map(item=>item.need),['one-of','one-of']);
  assert.equal(Object.keys(invoice.payload).length,1);
  const charge=buildScenario(analysis,'subscription',analysis.operations.find(item=>item.id==='charge-sub'),'change');
  assert.equal(charge.existing,true);
  assert.ok(charge.existingPlan.trace.entities.some(entity=>entity.name==='Item price'));
});

test('rule sentences come from field descriptions and nested payloads keep arrays',()=>{
  const rules=specRules([field('a','string',false,'The ID. If not provided, it is autogenerated. Relevant only when `apply_on` = `specific_item_price`.')]);
  assert.deepEqual(rules.map(rule=>rule.kind),['condition','condition']);
  assert.deepEqual(rules[1].when,{field:'apply_on',value:'specific_item_price'});
  assert.deepEqual(minimalPayload([{field:field('lines[].price_id','string',true),need:'required',rules:[]}]),{lines:[{price_id:'<price_id>'}]});
});
