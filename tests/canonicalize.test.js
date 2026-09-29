import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalizeAnalysis, reconcileResourceEndpoints } from '../server/canonicalize.js';

const root='https://docs.example.com/reference';
const entity=(id,name,operationIds,fields=[{name:'id',type:'string',required:true,description:''}])=>({id,name,rawName:name,api:'Example API',group:'Resources',description:'',fields,source:`${root}/${id}`,operationIds,kind:'schema'});
const operation=(id,path,name,entityIds=[])=>({id,path,name,method:'GET',source:`${root}/${id}`,entityIds,inputs:[],outputs:[],description:''});

test('request, response, error and pagination schemas do not inflate endpoint resources',()=>{
  const analysis={entities:[
    entity('project-request','ProjectPublicAPIRequestEntity',['get-project']),
    entity('project-response','ProjectPublicAPIResponseEntity',['get-project']),
    entity('task-response','TaskPublicAPIResponseEntity',['get-task'],[{name:'projectId',type:'string',required:true,description:'Identifier of the Project.'}]),
    entity('page','ExamplePaginationProjects',[]),
    entity('error','Example400',[]),
  ],operations:[operation('get-project','/1.0/projects/{projectId}','Get project',['project-request','project-response']),operation('get-task','/1.0/tasks/{taskId}','Get task',['task-response'])],dependencies:[{id:'project-task',source:'project-response',target:'task-response',field:'projectId',type:'id',status:'documented',evidence:'Task projectId identifies the project.',sourceUrl:root}],coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  assert.deepEqual(analysis.entities.map(item=>item.name).sort(),['Project','Task']);
  assert.equal(analysis.coverage.schemaCount,5);
  assert.equal(analysis.coverage.resourceCount,2);
  assert.equal(analysis.dependencies.length,1);
  assert.equal(analysis.dependencies[0].source,analysis.entities.find(item=>item.name==='Project').id);
  assert.equal(analysis.dependencies[0].target,analysis.entities.find(item=>item.name==='Task').id);
  assert.ok(analysis.operations.every(item=>item.entityIds.every(id=>analysis.entities.some(entity=>entity.id===id))));
});

test('resource details use the entity definition instead of an endpoint action',()=>{
  const analysis={entities:[entity('price-variant','PriceVariant',['delete-variant'],[{name:'id',type:'string',required:true,description:'Identifier of the price variant.'}])],operations:[{...operation('delete-variant','/price_variants/{id}','Delete a price variant',['price-variant']),method:'DELETE',description:'Deletes the price variant. This is not allowed when it is attached to an item price.'}],dependencies:[],coverage:{},warnings:[]};
  analysis.entities[0].description='A price variant represents a pricing variation for an item. It can reflect geography or another sales context. See also: Setup instructions.';
  canonicalizeAnalysis(analysis);
  assert.equal(analysis.entities[0].description,'A price variant represents a pricing variation for an item. It can reflect geography or another sales context.');
});

test('a resource without a definition does not inherit a delete endpoint description',()=>{
  const analysis={entities:[],operations:[{...operation('delete-widget','/widgets/{id}','Delete widget'),method:'DELETE',description:'Deletes this widget permanently.'}],dependencies:[],coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  assert.match(analysis.entities[0].description,/does not describe its purpose/);
  assert.doesNotMatch(analysis.entities[0].description,/Deletes/);
});

test('nested collection endpoints stay in their parent reference resource',()=>{
  const roots=['projects','tasks','budgets','fields','time-entries','companies','phases','spaces','space-documents','invoices','time-offs','custom-revenue-recognition-configs','users','resource-allocations'];
  const operations=roots.map(root=>operation(root,`/1.0/${root}`,`Get all ${root}`));
  operations.push(operation('invoice-lines','/1.0/invoices/{invoiceId}/lines','Get invoice line items by invoice Id'));
  operations.push(operation('invoice-payments','/1.0/invoices/{invoiceId}/payments','Get invoice payments by invoice Id'));
  const analysis={entities:roots.map(root=>entity(root,`${root.replaceAll('-','')}PublicAPIResponseEntity`,[root])),operations,dependencies:[],coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  assert.equal(analysis.entities.length,14);
  assert.equal(analysis.entities.some(item=>item.name==='Invoice line item'),false);
  assert.equal(analysis.entities.some(item=>item.name==='Invoice payment'),false);
  const invoice=analysis.entities.find(item=>item.name==='Invoice');
  assert.equal(invoice.operationIds.length,3);
  assert.deepEqual(invoice.operationIds,analysis.operations.filter(item=>item.entityIds.includes(invoice.id)).map(item=>item.id));
});

test('saved maps collapse a legacy nested node into Invoice without losing its endpoints or links',()=>{
  const analysis={entities:[],operations:[operation('invoice','/1.0/invoices/{invoiceId}','Get invoice'),operation('payments','/1.0/invoices/{invoiceId}/payments','Get invoice payments')],dependencies:[],coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  const invoice=analysis.entities.find(item=>item.name==='Invoice');
  const childId=`resource:${createHash('sha256').update('docs.example.com|invoices/payments').digest('hex').slice(0,12)}`;
  analysis.entities.push({...invoice,id:childId,name:'Invoice payment',rawName:'Invoice payment',operationIds:['payments'],schemaNames:['ExampleAPIResponseInvoicePayments']});
  invoice.operationIds=['invoice'];
  analysis.operations.find(item=>item.id==='payments').entityIds=[childId];
  analysis.coverage.canonicalVersion=undefined;
  reconcileResourceEndpoints(analysis);
  assert.deepEqual(invoice.operationIds,['invoice','payments']);
  assert.equal(analysis.entities.length,1);
  assert.equal(analysis.coverage.resourceCount,1);
  assert.ok(invoice.schemaNames.includes('ExampleAPIResponseInvoicePayments'));
  assert.equal(analysis.coverage.canonicalVersion,8);
});

test('documented catalog prerequisites outrank required but inferred matches',()=>{
  const names=['ItemFamily','Item','ItemPrice','Subscription'];
  const paths=['/item_families','/items','/item_prices','/subscriptions'];
  const entities=names.map(name=>entity(name,name,[name]));
  const operations=names.map((name,index)=>operation(name,paths[index],`Create ${name}`,[name]));
  const pairs=[['ItemFamily','Item','item_family_id'],['Item','ItemPrice','item_id'],['ItemPrice','Subscription','item_price_id']];
  const dependencies=pairs.flatMap(([source,target,field])=>[
    {id:`${source}-${target}-documented`,source,target,field:`data[].${field}`,type:'id',status:'documented',evidence:'The source ID is required.',sourceUrl:root},
    {id:`${source}-${target}-inferred`,source,target,field,type:'operation',status:'inferred',required:true,evidence:'Name match only.',sourceUrl:root},
  ]);
  const analysis={entities,operations,dependencies,coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  for(const [source,target,field] of pairs){const same=(name,value)=>name.replaceAll(' ','').toLowerCase()===value.toLowerCase();const from=analysis.entities.find(item=>same(item.name,source));const to=analysis.entities.find(item=>same(item.name,target));assert.ok(analysis.dependencies.some(link=>link.source===from.id&&link.target===to.id&&link.field===field&&link.status==='documented'));}
});

test('IDs inside DTO-named schemas link to the final resource (customer.companyId -> Company)',()=>{
  const analysis={entities:[
    entity('company-response','CustomerCompanyPublicAPIResponseEntity',['get-company']),
    entity('project-response','ProjectPublicAPIResponseEntity',['get-project'],[{name:'customer',type:'object',required:true,description:''},{name:'customer.companyId',type:'integer',required:false,description:'The company identifier.'}]),
  ],operations:[operation('get-company','/1.0/companies/{companyId}','Get company',['company-response']),operation('get-project','/1.0/projects/{projectId}','Get project',['project-response'])],dependencies:[],coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  const company=analysis.entities.find(item=>item.name==='Company'),project=analysis.entities.find(item=>item.name==='Project');
  const link=analysis.dependencies.find(item=>item.field==='customer.companyId');
  assert.equal(link?.source,company.id);
  assert.equal(link?.target,project.id);
  assert.equal(link?.status,'inferred');
});

test('webhook events do not become a resource or count as its endpoints',()=>{
  const analysis={entities:[],operations:[{...operation('create-invoice','/invoices','Create an invoice'),method:'POST'},{...operation('invoice-generated','/webhooks/invoice_generated','Invoice generated'),method:'POST',kind:'webhook'}],dependencies:[],coverage:{},warnings:[]};
  canonicalizeAnalysis(analysis);
  assert.deepEqual(analysis.entities.map(item=>item.name),['Invoice']);
  assert.deepEqual(analysis.entities[0].operationIds,['create-invoice']);
  assert.equal(analysis.coverage.canonicalVersion,10);
});
