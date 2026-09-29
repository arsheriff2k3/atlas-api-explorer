import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseApiSpecification } from '../server/spec-adapters.js';
import { analyzeSpec } from '../server/parser.js';
import { canonicalizeAnalysis } from '../server/canonicalize.js';
import { mergeExtraction } from '../server/agent.js';
import { normalizeAnalysis, validateAnalysis, SCHEMA_VERSION } from '../server/analysisSchema.js';

// Reuse the adapter fixtures so every supported format is held to the same schema.
const source=readFileSync(new URL('./spec-adapters.test.js',import.meta.url),'utf8');
const start=source.indexOf('const fixtures=')+'const fixtures='.length;
const fixtures=(0,eval)(source.slice(start,source.indexOf('];',start)+1));
const wrap=(result,url)=>({id:'a',name:result.name||'API',version:result.version||'1',createdAt:new Date(0).toISOString(),urls:[url],entities:result.entities,operations:result.operations,dependencies:result.dependencies,patterns:result.patterns||[],warnings:result.warnings||[],sources:[],coverage:{pagesRead:0,specifications:1,discovered:0,attempted:0,pageLimit:24,aiPages:0,complete:false},mode:'structural',demo:false});

for(const [format,text] of fixtures)test(`${format} output matches the canonical analysis schema`,()=>{
  const url=`https://example.com/${format.replaceAll(' ','-')}`;
  const {spec}=parseApiSpecification(text,url);
  const analysis=normalizeAnalysis(canonicalizeAnalysis(wrap(analyzeSpec(spec,url),url)));
  assert.deepEqual(validateAnalysis(analysis),[]);
  assert.equal(analysis.schemaVersion,SCHEMA_VERSION);
});

test('AI prose extraction is normalized into the same schema',()=>{
  const page='https://docs.example.com/orders';
  const analysis=wrap({entities:[],operations:[],dependencies:[]},page);
  mergeExtraction(analysis,{entities:[{name:'Order',description:'',group:'Orders',fields:[{name:'customer_id',type:'string',required:true,description:''}],source:page},{name:'Customer',description:'',group:'Customers',fields:[],source:page}],
    operations:[{name:'Get order',method:'GET',path:'/orders/{order_id}',description:'',entityNames:['Order'],inputs:[{name:'order_id',type:'string',required:true,description:''},{name:'expand',type:'string',required:false,description:''}],outputs:[],source:page}],
    relationships:[{producer:'Customer',consumer:'Order',field:'customer_id',explanation:'Orders belong to customers.',quote:'',source:page}],patterns:[]},[{url:page,text:''}]);
  normalizeAnalysis(analysis);
  assert.deepEqual(validateAnalysis(analysis),[]);
  assert.equal('entityNames' in analysis.operations[0],false);
  assert.deepEqual(analysis.operations[0].inputs.map(input=>input.location),['path','query']);
});

test('referential problems are reported',()=>{
  const analysis=wrap({entities:[],operations:[],dependencies:[{id:'d',source:'x',target:'y',field:'x_id',type:'id',status:'inferred',evidence:'',sourceUrl:''}]},'https://e.com');
  assert.match(validateAnalysis(analysis).join(' '),/missing entity/);
});
