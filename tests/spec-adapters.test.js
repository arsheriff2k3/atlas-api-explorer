import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApiSpecification } from '../server/spec-adapters.js';
import { analyzeSpec } from '../server/parser.js';

const fixtures=[
  ['OpenAPI',JSON.stringify({openapi:'3.1.0',info:{title:'Shop'},paths:{'/items':{get:{responses:{'200':{description:'ok'}}}}}}),'GET'],
  ['Swagger',JSON.stringify({swagger:'2.0',info:{title:'Shop'},paths:{'/items':{get:{responses:{'200':{description:'ok'}}}}}}),'GET'],
  ['Postman',JSON.stringify({info:{name:'Shop',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},item:[{name:'List items',request:{method:'GET',url:'https://api.example.com/items'},response:[{code:200,body:'{"items":[]}'},{code:404,body:'{}'}]},{name:'Create item',request:{method:'POST',url:'https://api.example.com/items'},response:[]}]}),'GET'],
  ['RAML','#%RAML 1.0\ntitle: Shop\n/items:\n  get:\n    description: List items\n  post:\n    description: Create item\n','GET'],
  ['API Blueprint','FORMAT: 1A\n# Shop\n# Group Items\n## Items [/items]\n### List [GET]\n+ Response 200\n### Create [POST]\n+ Response 201\n','GET'],
  ['GraphQL','type Query { items: [Item!]! }\ntype Mutation { createItem(name: String!): Item }\ntype Item { id: ID! name: String! }','QUERY'],
  ['AsyncAPI','asyncapi: 2.6.0\ninfo:\n  title: Events\n  version: 1.0.0\nchannels:\n  /items:\n    publish:\n      summary: Item created\n      message:\n        payload:\n          type: object\n          properties:\n            itemId:\n              type: string\n','PUBLISH'],
  ['OpenRPC',JSON.stringify({openrpc:'1.3.2',info:{title:'RPC',version:'1'},methods:[{name:'item.list',params:[],result:{name:'result',schema:{type:'array'}}}]}),'CALL'],
  ['Protocol Buffers','syntax = "proto3"; message ItemRequest { string item_id = 1; } message ItemResponse { string id = 1; } service ItemService { rpc Get (ItemRequest) returns (ItemResponse); }','RPC'],
  ['WSDL','<?xml version="1.0"?><definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name="Shop"><portType name="ItemPort"><operation name="GetItem"/></portType></definitions>','SOAP'],
  ['Smithy',JSON.stringify({smithy:'2.0',shapes:{'example#GetItem':{type:'operation',traits:{'smithy.api#http':{method:'GET',uri:'/items/{id}'}}}}}),'GET'],
];

for(const [format,source,method] of fixtures)test(`${format} adapter yields a sourced operation`,()=>{
  const {spec,error}=parseApiSpecification(source,`https://example.com/${format.toLowerCase().replaceAll(' ','-')}.txt`);
  assert.ok(spec,error);
  assert.equal(spec['x-atlas-format'],format);
  const result=analyzeSpec(spec,'https://example.com/spec');
  assert.ok(result.operations.some(op=>op.method===method),`${format}: ${JSON.stringify(result.operations)}`);
  assert.ok(result.operations.every(op=>op.source==='https://example.com/spec'));
});

test('GraphQL introspection JSON is recognized',()=>{
  const result=parseApiSpecification(JSON.stringify({data:{__schema:{queryType:{name:'Query'},mutationType:null,subscriptionType:null,types:[{kind:'OBJECT',name:'Query',fields:[{name:'hello',args:[],type:{kind:'SCALAR',name:'String'},isDeprecated:false}],interfaces:[]},{kind:'SCALAR',name:'String'}],directives:[]}}}));
  assert.equal(result.format,'GraphQL');
  assert.equal(result.spec.paths['/Query/hello'].query.summary,'hello');
});

test('OpenAPI webhooks and additional HTTP methods remain visible',()=>{
  const {spec}=parseApiSpecification(JSON.stringify({openapi:'3.2.0',info:{title:'Webhooks',version:'1'},webhooks:{orderCreated:{post:{summary:'Order created',responses:{'200':{description:'ok'}}}}},paths:{'/items':{trace:{responses:{'200':{description:'ok'}}}}}}));
  const result=analyzeSpec(spec,'https://example.com/openapi.json');
  assert.deepEqual(result.operations.map(op=>op.method).sort(),['POST','TRACE']);
});

test('Postman 2.0 schema marker and request-string shorthand are recognized',()=>{
  const {spec}=parseApiSpecification(JSON.stringify({info:{name:'Collection',_postman_schema:'https://schema.getpostman.com/#2.0.0'},item:[{name:'Status',request:'https://example.com/status'}]}));
  assert.equal(spec.paths['/status'].get.summary,'Status');
});

test('AsyncAPI 3 channel references retain all declared operations',()=>{
  const {spec}=parseApiSpecification('asyncapi: 3.1.0\ninfo:\n  title: Events\n  version: 1\nchannels:\n  itemCreated:\n    address: items.created\n    messages:\n      item:\n        payload:\n          type: object\n          properties:\n            itemId:\n              type: string\noperations:\n  publishItem:\n    action: send\n    channel:\n      $ref: "#/channels/itemCreated"\n  consumeItem:\n    action: receive\n    channel:\n      $ref: "#/channels/itemCreated"\n');
  assert.equal(Object.keys(spec.paths['/items.created']).length,2);
});

test('OpenAPI webhooks are tagged as events and wide request bodies keep every top-level field',()=>{
  const nested=Object.fromEntries(Array.from({length:40},(_,i)=>[`n${i}`,{type:'object',properties:Object.fromEntries(Array.from({length:10},(_,j)=>[`f${j}`,{type:'string'}]))}]));
  const body={type:'object',properties:{...nested,discounts:{type:'array',items:{type:'object',properties:{amount:{type:'integer'}}}}}};
  const doc={openapi:'3.1.0',info:{title:'Billing'},
    paths:{'/invoices':{post:{summary:'Create an invoice',parameters:[{name:'x-origin-ip',in:'header'}],requestBody:{content:{'application/x-www-form-urlencoded':{schema:body}}},responses:{'200':{description:'ok'}}}}},
    webhooks:{invoice_generated:{post:{summary:'Triggered when an invoice is generated',responses:{'200':{description:'ok'}}}}}};
  const {spec}=parseApiSpecification(JSON.stringify(doc),'https://docs.example.com/openapi.json');
  const result=analyzeSpec(spec,'https://docs.example.com/openapi.json');
  const create=result.operations.find(operation=>operation.path==='/invoices');
  assert.equal(create.kind,undefined);
  assert.ok(create.inputs.some(input=>input.name==='discounts'),'a top-level field after 400 nested fields is kept');
  assert.equal(create.inputs.find(input=>input.name==='x-origin-ip').location,'header');
  assert.equal(result.operations.find(operation=>operation.path==='/webhooks/invoice_generated').kind,'webhook');
});
