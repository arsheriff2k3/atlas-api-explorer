import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSpec, parseSpec, embeddedSpecs, combineSpecFragments } from '../server/parser.js';
import { publicAddress, validateUrl } from '../server/network.js';

const fixture = {
  openapi: '3.1.0',
  info: { title: 'Orders API', version: '1.0.0' },
  paths: {
    '/customers': { post: {
      operationId: 'createCustomer', responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } } },
    } },
    '/orders': { post: {
      operationId: 'createOrder', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
      responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } }, 400: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } } },
    } },
  },
  components: { schemas: {
    Customer: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } },
    Order: { type: 'object', required: ['customer_id'], properties: { id: { type: 'string' }, customer_id: { type: 'string', description: 'Identifier of the Customer.' } } },
    ApiError: { type: 'object', properties: { code: { type: 'string' } } },
  } },
};

test('OpenAPI JSON and YAML are accepted; unrelated text is rejected', () => {
  assert.equal(parseSpec(JSON.stringify(fixture))?.info.title, 'Orders API');
  assert.equal(parseSpec('openapi: 3.1.0\npaths: {}')?.openapi, '3.1.0');
  assert.equal(parseSpec('<html>not a specification</html>'), null);
});

test('entity and ID lineage keep evidence and exclude generic error responses', () => {
  const result = analyzeSpec(fixture, 'https://example.com/openapi.json');
  const customer = result.entities.find(e => e.rawName === 'Customer');
  const order = result.entities.find(e => e.rawName === 'Order');
  const error = result.entities.find(e => e.rawName === 'ApiError');
  assert.deepEqual(order.fields.find(f => f.name === 'customer_id')?.required, true);
  assert.ok(result.dependencies.some(d => d.source === customer.id && d.target === order.id && d.field === 'customer_id' && d.status === 'documented'));
  assert.equal(error.operationIds.length, 0);
  assert.equal(result.operations.find(o => o.operationId === 'createOrder').entityIds.includes(error.id), false);
});

test('ReadMe-style fenced OpenAPI fragments combine across endpoint pages', () => {
  const first={openapi:'3.0.1',info:{title:'Example API',version:'1'},paths:{'/customers':{post:{operationId:'createCustomer',responses:{201:{content:{'application/json':{schema:{$ref:'#/components/schemas/Customer'}}}}}}}},components:{schemas:{Customer:{type:'object',properties:{id:{type:'string'}}}}}};
  const second={openapi:'3.0.1',info:{title:'Example API',version:'1'},paths:{'/orders':{post:{operationId:'createOrder',requestBody:{content:{'application/json':{schema:{$ref:'#/components/schemas/Order'}}}},responses:{201:{content:{'application/json':{schema:{$ref:'#/components/schemas/Order'}}}}}}}},components:{schemas:{Order:{type:'object',properties:{customer_id:{type:'string',description:'Identifier of the Customer.'}}},Customer:first.components.schemas.Customer}}};
  const a='https://docs.example.com/reference/create-customer.md';
  const b='https://docs.example.com/reference/create-order.md';
  const markdown=`# Create customer\n\n# OpenAPI definition\n\n\`\`\`json\n${JSON.stringify(first)}\n\`\`\``;
  const fragments=[{spec:embeddedSpecs(markdown)[0],url:a},{spec:second,url:b}];
  assert.equal(fragments[0].spec.openapi,'3.0.1');
  const result=analyzeSpec(combineSpecFragments(fragments),a);
  assert.equal(result.operations.length,2);
  assert.equal(result.operations.find(o=>o.operationId==='createOrder').source,b);
  assert.ok(result.dependencies.some(d=>d.field==='customer_id'&&d.sourceUrl===b));
});

test('an earlier empty Markdown fence does not hide a later OpenAPI endpoint', () => {
  const spec={openapi:'3.0.1',info:{title:'Rocketlane API',version:'1'},paths:{'/1.0/companies':{get:{summary:'Get all companies',responses:{200:{description:'OK'}}}}}};
  const markdown=`# Get all companies\n\n\`\`\`\n\nSome prose.\n\n\`\`\`\n\n# OpenAPI definition\n\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``;
  const fragments=embeddedSpecs(markdown);
  assert.equal(fragments.length,1);
  assert.equal(analyzeSpec(fragments[0],'https://developer.rocketlane.com/reference/get-all-companies.md').operations[0].name,'Get all companies');
});

test('a full OpenAPI definition and a ReadMe endpoint page keep one operation with the readable page as its source',()=>{
  const spec={openapi:'3.0.1',info:{title:'Example API',version:'1'},paths:{'/invoices':{get:{summary:'Get all invoices',responses:{200:{description:'OK'}}}}}};
  const merged=combineSpecFragments([{spec,url:'https://docs.example.com/openapi.json'},{spec,url:'https://docs.example.com/reference/get-all-invoices.md'}]);
  const operations=analyzeSpec(merged,'https://docs.example.com/openapi.json').operations;
  assert.equal(operations.length,1);
  assert.equal(operations[0].source,'https://docs.example.com/reference/get-all-invoices.md');
});

test('generated ReadMe response names still resolve resource IDs', () => {
  const spec={openapi:'3.0.1',info:{title:'Projects API',version:'1'},components:{schemas:{ProjectPublicAPIResponseEntity:{type:'object',properties:{projectId:{type:'string'}}},TaskPublicAPIResponseEntity:{type:'object',properties:{projectId:{type:'string',description:'Identifier of the Project.'}}}}},paths:{'/1.0/projects':{post:{responses:{201:{content:{'application/json':{schema:{$ref:'#/components/schemas/ProjectPublicAPIResponseEntity'}}}}}}},'/1.0/tasks/{projectId}':{get:{parameters:[{name:'projectId',in:'path',required:true,schema:{type:'string'}}],responses:{200:{content:{'application/json':{schema:{$ref:'#/components/schemas/TaskPublicAPIResponseEntity'}}}}}}}}};
  const result=analyzeSpec(spec,'https://docs.example.com/project.md');
  const project=result.entities.find(e=>e.rawName==='ProjectPublicAPIResponseEntity');
  const task=result.entities.find(e=>e.rawName==='TaskPublicAPIResponseEntity');
  assert.ok(result.dependencies.some(d=>d.type==='id'&&d.source===project.id&&d.target===task.id));
  assert.ok(result.dependencies.some(d=>d.type==='operation'&&d.field==='projectId'&&d.sourceOperation&&d.targetOperation));
});

test('an export is not inferred as the producer of an item price ID',()=>{
  const schema={type:'object',properties:{id:{type:'string'},item_price_id:{type:'string',description:'The ID of the Item Price.'}}};
  const spec={openapi:'3.1.0',info:{title:'Catalog',version:'1'},components:{schemas:{ItemPrice:schema,Subscription:schema}},paths:{
    '/exports/item_prices':{post:{summary:'Export item prices',responses:{200:{content:{'application/json':{schema:{$ref:'#/components/schemas/ItemPrice'}}}}}}},
    '/item_prices':{post:{summary:'Create an item price',responses:{200:{content:{'application/json':{schema:{$ref:'#/components/schemas/ItemPrice'}}}}}}},
    '/subscriptions':{post:{summary:'Create a subscription',requestBody:{content:{'application/json':{schema:{$ref:'#/components/schemas/Subscription'}}}},responses:{200:{content:{'application/json':{schema:{$ref:'#/components/schemas/Subscription'}}}}}}},
  }};
  const result=analyzeSpec(spec,'https://example.com/spec.json');
  const links=result.dependencies.filter(link=>link.type==='operation'&&link.field==='item_price_id'&&link.targetOperation);
  assert.ok(links.length);
  assert.ok(links.every(link=>result.operations.find(operation=>operation.id===link.sourceOperation)?.path==='/item_prices'));
});

test('network gate permits public hosts and rejects private or loopback destinations', async () => {
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('64:ff9b::8.8.8.8'), true);
  assert.equal(publicAddress('64:ff9b::127.0.0.1'), false);
  assert.equal(publicAddress('127.0.0.1'), false);
  assert.equal(publicAddress('10.1.2.3'), false);
  assert.equal(publicAddress('::1'), false);
  await assert.rejects(validateUrl('http://127.0.0.1/docs'), /Private and local/);
  await assert.rejects(validateUrl('https://user:pass@example.com/docs'), /public HTTP or HTTPS/);
});
