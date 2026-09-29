import test from 'node:test';
import assert from 'node:assert/strict';
import { apiCatalogLinks, discoveryProbes, linkHeaderTargets, readmeIndex } from '../server/discovery.js';

test('a custom-domain ReadMe index yields reference pages and split indexes',()=>{
  const index=`# Example\n\nAppend .md to any documentation page URL.\n\n## Guides\n- [Overview](https://docs.example.com/docs/overview.md)\n\n## API Reference\n- [Invoices](https://docs.example.com/reference/invoices.md)\n- [Get invoice](https://docs.example.com/reference/get-invoice.md)\n- [Get invoice](https://docs.example.com/reference/get-invoice.md)\n- [More](https://docs.example.com/reference/llms.txt)`;
  const result=readmeIndex(index,'https://docs.example.com/llms.txt');
  assert.deepEqual(result.references,['https://docs.example.com/reference/invoices.md','https://docs.example.com/reference/get-invoice.md']);
  assert.ok(result.links.includes('https://docs.example.com/reference/llms.txt'));
  assert.ok(discoveryProbes('https://docs.example.com/reference/get-invoice').includes('https://docs.example.com/.well-known/api-catalog'));
  assert.ok(discoveryProbes('https://docs.example.com/project/docs/start').includes('https://docs.example.com/project/llms.txt'));
});

test('RFC 9727 service descriptions and catalog links are discovered',()=>{
  const json=JSON.stringify({linkset:[{anchor:'https://docs.example.com/', 'service-desc':[{href:'/openapi/core.yaml'}], 'api-catalog':[{href:'https://other.example.com/api-catalog'}]}]});
  assert.deepEqual(apiCatalogLinks(json,'https://docs.example.com/.well-known/api-catalog'),[
    {url:'https://docs.example.com/openapi/core.yaml',relation:'service-desc'},
    {url:'https://other.example.com/api-catalog',relation:'api-catalog'},
  ]);
  assert.deepEqual(linkHeaderTargets('</.well-known/api-catalog>; rel="api-catalog", </openapi/core.yaml>; rel="service-desc"','https://docs.example.com/'),['https://docs.example.com/.well-known/api-catalog','https://docs.example.com/openapi/core.yaml']);
});
