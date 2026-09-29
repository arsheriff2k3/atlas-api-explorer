import YAML from 'yaml';
import { buildClientSchema, buildSchema, getNamedType, isObjectType, isInputObjectType, isEnumType, isScalarType } from 'graphql';
import { XMLParser } from 'fast-xml-parser';
import protobuf from 'protobufjs';

const httpMethods = /^(get|post|put|patch|delete|head|options)$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const base = (title, format, version = '') => ({openapi:'3.1.0',info:{title:title || `${format} API`,version:version || format},paths:{},components:{schemas:{}},'x-atlas-format':format,'x-atlas-warnings':[]});
const refName = value => String(value || '').replace(/^.*[#/.]/, '');
function add(spec, path, method, operation) {
  if (!path || !method) return;
  const key=method.toLowerCase();
  if (!spec.paths[path]) spec.paths[path]={};
  if (!spec.paths[path][key]) spec.paths[path][key]={responses:{},...operation};
}
function schemaFromExample(value) {
  if (Array.isArray(value)) return {type:'array',items:value.length ? schemaFromExample(value[0]) : {}};
  if (value && typeof value === 'object') return {type:'object',properties:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,schemaFromExample(item)]))};
  return {type:typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'};
}
function parseBody(value) {
  try { return schemaFromExample(JSON.parse(typeof value==='string' ? value : JSON.stringify(value))); } catch { return null; }
}
function normalizePath(value) {
  try {const url=new URL(value);return url.pathname || '/';} catch {return `/${String(value||'').replace(/^\/+/, '').replace(/\/+$/, '')}` || '/';}
}

function postman(doc) {
  const schemaUrl=doc.info?.schema||doc.info?._postman_schema||'';
  const spec=base(doc.info?.name,'Postman',schemaUrl.match(/(?:v|#)(\d+(?:\.\d+)?)/)?.[1] || '2.x');
  function visit(items) { for(const item of items||[]) {
    if(Array.isArray(item.item)){visit(item.item);continue;}
    const request=typeof item.request==='string'?{method:'GET',url:item.request}:item.request;
    if(!request)continue;
    const method=String(request.method||'GET').toLowerCase();
    if(!httpMethods.test(method)){spec['x-atlas-warnings'].push(`Skipped non-HTTP Postman request: ${item.name}`);continue;}
    const raw=typeof request.url==='string'?request.url:request.url?.raw || `/${(Array.isArray(request.url?.path)?request.url.path:[request.url?.path||'']).join('/')}`;
    const path=normalizePath(raw).replace(/:([A-Za-z_][\w]*)/g,'{$1}');
    const parameters=(request.url?.query||[]).filter(q=>!q.disabled).map(q=>({name:q.key,in:'query',required:false,schema:{type:'string'},description:q.description?.content||q.description||''}));
    for(const p of path.matchAll(/\{([^}]+)\}/g))parameters.push({name:p[1],in:'path',required:true,schema:{type:'string'}});
    const body=parseBody(request.body?.raw);
    const responses={};
    for(const response of item.response||[]){const status=String(response.code||'200');const schema=parseBody(response.body);responses[status]={description:response.status||'',...(schema?{content:{'application/json':{schema}}}:{})};}
    add(spec,path,method,{summary:item.name||`${method.toUpperCase()} ${path}`,description:typeof request.description==='string'?request.description:request.description?.content||'',parameters,...(body?{requestBody:{content:{'application/json':{schema:body}}}}:{}),responses});
  }}
  visit(doc.item);
  spec['x-atlas-warnings'].push('Postman collection variables and scripts were not executed; JSON bodies are examples, not guaranteed validation schemas.');
  return spec;
}

function raml(doc) {
  const spec=base(doc.title,'RAML',doc.version||'1.0');
  if(doc.baseUri)spec.servers=[{url:doc.baseUri}];
  function walk(node,prefix='') {for(const [key,value] of Object.entries(object(node))) {
    if(!key.startsWith('/'))continue;
    const path=`${prefix}${key}`.replace(/:([A-Za-z_]\w*)/g,'{$1}');
    for(const [method,raw] of Object.entries(object(value)))if(httpMethods.test(method)){
      const op=object(raw);const parameters=[];
      for(const [name,param] of Object.entries(object(op.uriParameters)))parameters.push({name,in:'path',required:true,schema:{type:object(param).type||'string'},description:object(param).description||''});
      for(const [name,param] of Object.entries(object(op.queryParameters)))parameters.push({name,in:'query',required:!!object(param).required,schema:{type:object(param).type||'string'},description:object(param).description||''});
      const responses={};for(const [status,response] of Object.entries(object(op.responses)))responses[status]={description:object(response).description||''};
      add(spec,path,method,{summary:op.displayName||`${method.toUpperCase()} ${path}`,description:op.description||'',parameters,responses});
    }
    walk(value,path);
  }}
  walk(doc);
  if(doc.uses||doc.traits||doc.resourceTypes)spec['x-atlas-warnings'].push('RAML libraries, traits, and resource types are not expanded; review source for inherited operations and fields.');
  return spec;
}

function blueprint(text) {
  const title=text.match(/^#\s+(.+)$/m)?.[1];const spec=base(title,'API Blueprint','1A');
  let group='',path='',action=null;
  for(const line of text.split(/\r?\n/)){
    let match=line.match(/^#{1,3}\s+Group\s+(.+)$/i);if(match){group=match[1];continue;}
    match=line.match(/^#{1,3}\s+(.+?)\s*\[\s*(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/[^\]]+)\s*\]\s*$/i);
    if(match){path=match[3].trim();if(match[2])add(spec,path,match[2],{summary:match[1],tags:group?[group]:[]});continue;}
    const direct=line.match(/^#{1,3}\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)/i);
    if(direct){path=direct[2];add(spec,path,direct[1],{summary:`${direct[1]} ${path}`,tags:group?[group]:[]});continue;}
    match=line.match(/^#{2,4}\s+(.+?)\s*\[\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(?:\s+(\/[^\]]+))?\s*\]\s*$/i)
      ||line.match(/^#{2,4}\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*$/i);
    if(match&&path){const method=match[2]||match[1];const target=match[3]||path;add(spec,target,method,{summary:match[2]?match[1]:`${method} ${target}`,tags:group?[group]:[]});action=spec.paths[target][method.toLowerCase()];continue;}
    match=line.match(/^\s*\+\s+Response\s+(\d{3})\b/i);if(match&&action)action.responses[match[1]]={description:''};
  }
  spec['x-atlas-warnings'].push('API Blueprint body examples and MSON data structures are not expanded into schemas.');
  return spec;
}

function graphQL(doc) {
  const schema=typeof doc==='string'?buildSchema(doc):buildClientSchema(doc.data||doc);
  const spec=base('GraphQL API','GraphQL','schema');
  const roots=new Set([schema.getQueryType()?.name,schema.getMutationType()?.name,schema.getSubscriptionType()?.name]);
  const typeSchema=type=>{const named=getNamedType(type);return isScalarType(named)?{type:['Int','Float'].includes(named.name)?'number':named.name==='Boolean'?'boolean':'string'}:{'$ref':`#/components/schemas/${named.name}`};};
  for(const [name,type] of Object.entries(schema.getTypeMap())){
    if(name.startsWith('__')||roots.has(name)||(!isObjectType(type)&&!isInputObjectType(type)&&!isEnumType(type)))continue;
    if(isEnumType(type)){spec.components.schemas[name]={type:'string',enum:type.getValues().map(v=>v.name)};continue;}
    const fields=type.getFields();spec.components.schemas[name]={type:'object',description:type.description||'',properties:Object.fromEntries(Object.entries(fields).map(([field,value])=>[field,{...typeSchema(value.type),description:value.description||''}])),required:Object.entries(fields).filter(([,v])=>String(v.type).endsWith('!')).map(([field])=>field)};
  }
  for(const [method,root] of [['query',schema.getQueryType()],['mutation',schema.getMutationType()],['subscription',schema.getSubscriptionType()]])if(root)for(const [name,field] of Object.entries(root.getFields())){
    const result=getNamedType(field.type);const resource=isObjectType(result)?result.name:root.name;
    const path=`/${resource}/${name}`;add(spec,path,method,{summary:name,description:field.description||'',parameters:field.args.map(arg=>({name:arg.name,in:'argument',required:String(arg.type).endsWith('!'),schema:typeSchema(arg.type),description:arg.description||''})),responses:{'200':{description:'GraphQL result',content:{'application/json':{schema:typeSchema(field.type)}}}},tags:[root.name]});
  }
  return spec;
}

function asyncapi(doc) {
  const spec=base(doc.info?.title,'AsyncAPI',doc.info?.version||doc.asyncapi);
  const channels=object(doc.channels);const messages=object(doc.components?.messages);
  spec.components.schemas=object(doc.components?.schemas);
  const resolve=(value)=>value?.$ref?.startsWith('#/channels/')?channels[refName(value.$ref)]:value;
  const messageOf=value=>value?.$ref?.startsWith('#/components/messages/')?messages[refName(value.$ref)]:value;
  function emit(channelName,method,raw,name){const channel=resolve(raw),path=normalizePath(channel?.address||channelName);const message=messageOf(channel?.message||Object.values(object(channel?.messages))[0]);const payload=message?.payload;add(spec,path,method,{summary:name||`${method} ${channelName}`,description:channel?.description||'',tags:[channelName],...(payload?{requestBody:{content:{'application/json':{schema:payload}}}}:{})});}
  if(String(doc.asyncapi).startsWith('2'))for(const [name,channel] of Object.entries(channels))for(const method of ['publish','subscribe'])if(channel?.[method])emit(name,method,{...channel,message:channel[method].message},channel[method].summary);
  if(String(doc.asyncapi).startsWith('3'))for(const [name,op] of Object.entries(object(doc.operations))){const channelName=refName(op.channel?.$ref)||name;emit(channelName,op.action||'send',op.channel,name);}
  spec['x-atlas-warnings'].push('AsyncAPI operations are message flows, not HTTP endpoints; graph edges from matching IDs remain inferred.');
  return spec;
}

function openrpc(doc) {
  const spec=base(doc.info?.title,'OpenRPC',doc.info?.version||doc.openrpc);
  for(const method of doc.methods||[]){const path=`/${method.name.replace(/\./g,'/')}`;add(spec,path,'call',{summary:method.summary||method.name,description:method.description||'',parameters:(method.params||[]).map(param=>({name:param.name,in:'parameter',required:!!param.required,schema:param.schema||{},description:param.description||''})),responses:method.result?{'200':{description:'JSON-RPC result',content:{'application/json':{schema:method.result.schema||{}}}}}:{}});}
  spec.components.schemas=object(doc.components?.schemas);return spec;
}

function proto(text) {
  const parsed=protobuf.parse(text,{keepCase:true});const spec=base(parsed.root.name||'gRPC API','Protocol Buffers',parsed.syntax||'proto3');
  function visit(node,prefix='') {for(const [name,child] of Object.entries(node.nested||{})){
    if(child instanceof protobuf.Type){spec.components.schemas[name]={type:'object',properties:Object.fromEntries(Object.entries(child.fields).map(([field,value])=>[field,{type:value.type,description:value.comment||''}])),required:Object.entries(child.fields).filter(([,value])=>value.required).map(([field])=>field)};}
    if(child instanceof protobuf.Service)for(const [method,rpc] of Object.entries(child.methods)){const path=`/${prefix}${name}/${method}`;add(spec,path,'rpc',{summary:method,description:rpc.comment||'',requestBody:{content:{'application/json':{schema:{$ref:`#/components/schemas/${refName(rpc.requestType)}`}}}},responses:{'200':{description:'gRPC response',content:{'application/json':{schema:{$ref:`#/components/schemas/${refName(rpc.responseType)}`}}}}},tags:[name]});}
    visit(child,`${prefix}${name}/`);
  }}visit(parsed.root);
  spec['x-atlas-warnings'].push('Imported .proto service and message declarations only; external imports and custom options are not resolved.');
  return spec;
}

function wsdl(text) {
  const data=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true}).parse(text);const doc=data.definitions||data.description;
  const spec=base(doc?.['@_name']||'WSDL API','WSDL',data.description?'2.0':'1.1');
  for(const [,port] of Object.entries(object(doc)).filter(([key])=>['portType','interface'].includes(key))){for(const item of (Array.isArray(port)?port:[port]))for(const op of (Array.isArray(item.operation)?item.operation:[item.operation]).filter(Boolean)){const service=item['@_name']||'Service';const name=op['@_name'];if(name)add(spec,`/${service}/${name}`,'soap',{summary:name,description:op.documentation||'',tags:[service]});}}
  spec['x-atlas-warnings'].push('WSDL operations are mapped structurally; XSD imports, bindings, and SOAP payload fields are not expanded.');
  return spec;
}

function smithy(doc) {
  const spec=base('Smithy API','Smithy',doc.smithy||'2');const shapes=object(doc.shapes);
  for(const [id,shape] of Object.entries(shapes)){
    const name=id.split('#').pop();
    if(shape.type==='structure')spec.components.schemas[name]={type:'object',properties:Object.fromEntries(Object.entries(object(shape.members)).map(([field,value])=>[field,{type:refName(value.target),description:value.traits?.['smithy.api#documentation']||''}])),required:Object.entries(object(shape.members)).filter(([,value])=>value.traits?.['smithy.api#required']!==undefined).map(([field])=>field)};
  }
  for(const [id,shape] of Object.entries(shapes))if(shape.type==='operation'){
    const name=id.split('#').pop();const service=id.split('#')[0].split('.').pop();const http=shape.traits?.['smithy.api#http'];const path=http?.uri||`/${service}/${name}`;const method=http?.method||'rpc';add(spec,path,method,{summary:name,description:shape.traits?.['smithy.api#documentation']||'',tags:[service],...(shape.input?{requestBody:{content:{'application/json':{schema:{$ref:`#/components/schemas/${refName(shape.input.target)}`}}}}}:{}),responses:{'200':{description:'Smithy output',...(shape.output?{content:{'application/json':{schema:{$ref:`#/components/schemas/${refName(shape.output.target)}`}}}}:{})}}});
  }
  spec['x-atlas-warnings'].push('Smithy JSON AST operations imported; external model files and IDL syntax require a compiled model.');return spec;
}

export function parseApiSpecification(text,url='') {
  let doc;
  try {doc=text.trim().startsWith('{')?JSON.parse(text):YAML.parse(text,{maxAliasCount:30});} catch {doc=null;}
  try {
    if(doc?.openapi&&(doc.paths||doc.webhooks)){
      const paths={...object(doc.paths)};
      // Webhooks are events the provider sends to you, not endpoints you call; tag them so they stay out of the endpoint inventory.
      for(const [name,webhook] of Object.entries(object(doc.webhooks)))paths[`/webhooks/${name.replace(/^\/+/, '')}`]=Object.fromEntries(Object.entries(object(webhook)).map(([key,value])=>[key,['get','post','put','patch','delete'].includes(key)&&value&&typeof value==='object'?{...value,'x-atlas-webhook':true}:value]));
      return {spec:{...doc,paths,'x-atlas-format':'OpenAPI'},format:'OpenAPI'};
    }
    if(doc?.swagger&&doc.paths)return {spec:{...doc,'x-atlas-format':'Swagger'},format:'Swagger'};
    if((doc?.info?.schema||doc?.info?._postman_schema)&&Array.isArray(doc.item))return {spec:postman(doc),format:'Postman'};
    if(doc?.asyncapi&&doc.channels)return {spec:asyncapi(doc),format:'AsyncAPI'};
    if(doc?.openrpc&&Array.isArray(doc.methods))return {spec:openrpc(doc),format:'OpenRPC'};
    if(doc?.smithy&&doc.shapes)return {spec:smithy(doc),format:'Smithy'};
    if(doc?.__schema||doc?.data?.__schema)return {spec:graphQL(doc),format:'GraphQL'};
    if(/^#%RAML\s+1\.0/m.test(text)) {const parsed=YAML.parse(text.replace(/^#%RAML[^\n]*\n/,'').replace(/!include\s+\S+/g,'"external include"'),{maxAliasCount:30});return {spec:raml(parsed),format:'RAML'};}
    if(/^FORMAT:\s*1A\b/m.test(text))return {spec:blueprint(text),format:'API Blueprint'};
    if(/^\s*(?:syntax|edition)\s*=|^\s*service\s+\w+\s*\{/m.test(text))return {spec:proto(text),format:'Protocol Buffers'};
    if(/<(?:(?:\w+):)?(?:definitions|description)\b/.test(text)&&/wsdl|portType|interface/.test(text))return {spec:wsdl(text),format:'WSDL'};
    if(/\b(?:type|input|schema)\s+\w*\s*\{/.test(text)&&(/\.graphql$|\.gql$/i.test(url)||/\btype\s+Query\b/.test(text)))return {spec:graphQL(text),format:'GraphQL'};
  } catch(error) {return {spec:null,format:'unparsed',error:error.message};}
  return {spec:null,format:null};
}
