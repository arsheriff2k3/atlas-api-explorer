import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePayload, flattenPayload, mappedPayload, valueIssues } from '../src/payloadCompare.ts';
import { buildFlowPlan, withMissingSteps } from '../src/flows.ts';
import { flowToMermaid } from '../src/scenarioExport.ts';

const f=(name,type='string',required=false,extra={})=>({name,type,required,description:'',location:'body',...extra});
const sf=(name,need,extra={})=>({field:f(name,extra.type||'string',need==='required',extra),need,rules:[],...extra.more});

test('a CRM payload is flattened and mapped by name, synonym, and Dynamics conventions',()=>{
  const sources=flattenPayload(JSON.stringify({'@odata.etag':'x',name:'Acme',emailaddress1:'a@b.co',telephone1:'1',address1_city:'Austin',creditlimit:5,tags:[{label:'vip'}]}));
  assert.deepEqual(sources.map(item=>item.path),['name','emailaddress1','telephone1','address1_city','creditlimit','tags[].label']);
  const fields=[sf('email','required'),sf('company','optional'),sf('phone','optional'),sf('billing_address.city','optional'),sf('bank_account.company','optional'),sf('first_name','required')];
  const result=comparePayload(sources,fields);
  const pairs=Object.fromEntries(result.matches.map(match=>[match.source.path,match.target.field.name]));
  assert.deepEqual(pairs,{name:'company',emailaddress1:'email',telephone1:'phone',address1_city:'billing_address.city'});
  assert.deepEqual(result.missing.map(item=>item.field.name),['first_name']);
  assert.equal(result.coverage,.5);
  assert.deepEqual(result.extra.map(item=>item.path),['creditlimit','tags[].label']);
});

test('manual mappings override and "do not map" removes a match; values are type-checked',()=>{
  const sources=flattenPayload('amount: 10.5\nplan: gold');
  const fields=[sf('unit_amount','optional',{type:'integer'}),sf('tier','optional',{enum:['basic','pro']})];
  const result=comparePayload(sources,fields,{amount:'unit_amount',plan:'tier'});
  assert.equal(result.matches.length,2);
  assert.match(result.matches.find(match=>match.target.field.name==='unit_amount').issues[0],/smallest currency unit/);
  assert.match(valueIssues('gold',f('tier','string',false,{enum:['basic','pro']}))[0],/basic, pro/);
  assert.deepEqual(mappedPayload(result),{unit_amount:'10.5',tier:'gold'});
  assert.equal(comparePayload(sources,fields,{amount:''}).matches.some(match=>match.source.path==='amount'),false);
});

const resource=(id,name,operationIds)=>({id,name,api:'Shop',group:'Shop',description:'',fields:[],source:'',operationIds,kind:'resource'});
const op=(id,name,method,path,inputs,outputs=[])=>({id,name,method,path,description:'',inputs,outputs,entityIds:[],source:''});
const shop={id:'s',name:'Shop',version:'1',createdAt:'',urls:[],patterns:[],warnings:[],sources:[],mode:'structural',demo:false,coverage:{pagesRead:0,specifications:1,discovered:0,attempted:0,pageLimit:0,aiPages:0,complete:true},
  entities:[resource('customer','Customer',['c-create']),resource('order','Order',['o-create','o-pay'])],
  operations:[op('c-create','Create a customer','POST','/customers',[f('email','string',true)],[f('customer'),f('customer.id')]),
    op('o-create','Create an order','POST','/orders',[f('customer_id','string',true),f('id','string',true)],[f('order'),f('order.id')]),
    op('o-pay','Pay an order','POST','/orders/{order-id}/pay',[{...f('order-id','string',true),location:'path'}])],
  dependencies:[{id:'l',source:'customer',target:'order',field:'customer_id',type:'id',status:'inferred',evidence:'',sourceUrl:''}]};

test('flows bind each ID to an earlier response and can add missing create steps',()=>{
  const partial=buildFlowPlan(shop,['o-create','o-pay']);
  assert.deepEqual(partial.missing.map(item=>item.entity.name),['Customer']);
  assert.deepEqual(partial.calls[1].bindings.map(binding=>[binding.input.name,binding.fromStep,binding.responseField]),[['order-id',0,'order.id']]);
  assert.equal(partial.calls[0].bindings.some(binding=>binding.input.name==='id'),false,'a bare id is never a link');
  const full=withMissingSteps(shop,['o-create','o-pay']);
  assert.deepEqual(full,['c-create','o-create','o-pay']);
  assert.deepEqual(buildFlowPlan(shop,full).calls[1].bindings.map(binding=>[binding.input.name,binding.responseField]),[['customer_id','customer.id']]);
});

test('logic flows export as Mermaid',()=>{
  const text=flowToMermaid({nodes:[{id:'start',kind:'start',title:'Create "order"',lines:[],source:'plan'},{id:'end',kind:'end',title:'Send',lines:[],source:'plan'}],edges:[{id:'e',source:'start',target:'end',label:'Yes'}]});
  assert.equal(text,"flowchart TD\n  n0([\"Create 'order'\"])\n  n1([\"Send\"])\n  n0 -->|Yes| n1");
});

test('link reviews confirm or hide inferred links, keyed stably by source, target, and field',async()=>{
  const {applyLinkReviews,linkKey}=await import('../src/linkReviews.ts');
  const base={...shop,dependencies:[{id:'a',source:'customer',target:'order',field:'customer_id',type:'id',status:'inferred',evidence:'',sourceUrl:''},{id:'b',source:'order',target:'customer',field:'last_order_id',type:'id',status:'inferred',evidence:'',sourceUrl:''}]};
  const {analysis,rejected}=applyLinkReviews(base,{[linkKey(base.dependencies[0])]:'confirmed','order|customer|last_order_id':'rejected'});
  assert.deepEqual(analysis.dependencies.map(link=>[link.id,link.status,link.review]),[['a','documented','confirmed']]);
  assert.deepEqual(rejected.map(link=>link.id),['b']);
  assert.equal(applyLinkReviews(base,{}).analysis,base,'no reviews returns the same object (no re-render churn)');
});

test('reruns report added, removed, and changed endpoints, fields, and links',async()=>{
  const {diffAnalyses,changeCount}=await import('../src/analysisDiff.ts');
  const next={...shop,createdAt:'2',entities:[...shop.entities,resource('refund','Refund',[])],
    operations:[{...shop.operations[0],inputs:[f('email','string',true),f('phone')]},{...shop.operations[1],inputs:[f('customer_id','string',true)]},op('r','Create a refund','POST','/refunds',[])],dependencies:[]};
  const changes=diffAnalyses({...shop,createdAt:'1'},next);
  assert.deepEqual(changes.entities,{added:['Refund'],removed:[]});
  assert.deepEqual(changes.endpoints.added,['POST /refunds']);
  assert.deepEqual(changes.endpoints.removed,['POST /orders/{order-id}/pay']);
  assert.deepEqual(changes.endpoints.changed.map(item=>[item.endpoint,item.addedFields,item.removedFields]),[['POST /customers',['phone'],[]],['POST /orders',[],['id']]]);
  assert.deepEqual(changes.links.removed,['Customer → Order (customer_id)']);
  assert.equal(changeCount(changes),6);
});

test('try-it form encoding follows both bracket conventions',async()=>{
  const {formEncode}=await import('../server/tryRequest.js');
  const body={id:'a',items:[{price_id:'p',qty:2}],address:{city:'X'}};
  assert.equal(decodeURIComponent(formEncode(body)),'id=a&items[price_id][0]=p&items[qty][0]=2&address[city]=X');
  assert.equal(decodeURIComponent(formEncode(body,'index')),'id=a&items[0][price_id]=p&items[0][qty]=2&address[city]=X');
});
