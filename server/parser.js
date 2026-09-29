import { createHash } from 'node:crypto';
import { parseApiSpecification } from './spec-adapters.js';

export const clean = (s = '') => String(s).replace(/<[^>]+>/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[`*#]/g,'').replace(/\s+/g,' ').trim();
export const normalize = (s = '') => s.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/ies$/,'y').replace(/s$/,'');
const title = s => s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./, x => x.toUpperCase());
const resourceName = s => normalize(s.replace(/(?:Public)?(?:API)?(?:Request|Response)(?:API)?(?:Entity|Model)?(?:\d+)?$/i,'').replace(/(?:Public)?(?:API)?Entity$/i,''));
const methods = ['get','post','put','patch','delete','head','options','trace','connect','query','mutation','subscription','publish','subscribe','send','receive','rpc','soap','call'];
export function parseSpec(text,url) {
  return parseApiSpecification(text,url).spec;
}
export function embeddedSpecs(text) {
  const found=[];
  // Fence boundaries must be whole lines. ReadMe pages can contain earlier
  // empty code blocks; a loose matcher consumes the later OpenAPI fence as
  // that block's closing delimiter and silently drops the endpoint.
  for (const match of text.matchAll(/^```(?:json|ya?ml)?[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*$/gim)) {
    const spec=parseSpec(match[1]);
    if(spec) found.push(spec);
  }
  return found;
}
export function combineSpecFragments(fragments) {
  const first=fragments[0];
  const merged={...first.spec,paths:{},components:{...(first.spec.components||{}),schemas:{},securitySchemes:{}}};
  for(const {spec,url} of fragments) {
    for(const [name,schema] of Object.entries(spec.components?.schemas||spec.definitions||{})) {
      if(!merged.components.schemas[name]) merged.components.schemas[name]={...schema,'x-atlas-source':url};
    }
    Object.assign(merged.components.securitySchemes,spec.components?.securitySchemes||{});
    for(const [path,pathItem] of Object.entries(spec.paths||{})) {
      const existing=merged.paths[path]||{};
      for(const [key,value] of Object.entries(pathItem||{})) {
        if(methods.includes(key)) {
          if(!existing[key])existing[key]={...value,'x-atlas-source':url};
          else if(url.endsWith('.md')&&!String(existing[key]['x-atlas-source']||'').endsWith('.md'))existing[key]['x-atlas-source']=url;
        }
        else existing[key] ||= value;
      }
      merged.paths[path]=existing;
    }
  }
  return merged;
}
function pointer(doc, ref) {
  if (!ref?.startsWith('#/')) return null;
  return ref.slice(2).split('/').reduce((obj, key) => obj?.[key.replace(/~1/g,'/').replace(/~0/g,'~')], doc);
}
function deref(doc, value, seen = new Set()) {
  if (!value?.$ref || seen.has(value.$ref)) return value || {};
  const next = pointer(doc, value.$ref); if (!next) return value;
  return deref(doc, next, new Set([...seen, value.$ref]));
}
function fieldsOf(doc, raw, prefix = '', depth = 0, visited = new Set()) {
  if (depth > 3 || !raw || (raw.$ref && visited.has(raw.$ref))) return [];
  const seen = new Set(visited); if (raw.$ref) seen.add(raw.$ref);
  const schema = deref(doc, raw); let list = [];
  for (const combo of ['allOf','oneOf','anyOf']) for (const part of schema[combo] || []) list.push(...fieldsOf(doc, part, prefix, depth+1, seen));
  if (schema.items) list.push(...fieldsOf(doc, schema.items, prefix ? `${prefix}[]` : '[]', depth+1, seen));
  for (const [name, rawField] of Object.entries(schema.properties || {})) {
    const field = deref(doc, rawField); const path = prefix ? `${prefix}.${name}` : name;
    list.push({ name: path, type: field.type || (field.properties ? 'object' : rawField.$ref?.split('/').pop() || 'unknown'), required: (schema.required || []).includes(name), description: clean(field.description).slice(0,260), enum: field.enum, ref: rawField.$ref });
    if (field.properties || field.items || field.allOf) list.push(...fieldsOf(doc, rawField, path, depth+1, seen));
  }
  return [...new Map(list.map(f => [f.name,f])).values()];
}
// Keep every top-level field (a request's real parameter list) and cap only the
// nested members that large specs such as Chargebee repeat on hundreds of endpoints.
function boundedFields(fields, nestedLimit = 300) {
  let nested = 0;
  return [...new Map(fields.map(f => [f.name,f])).values()].filter(f => !/[.[]/.test(f.name.replace(/^\[\]\.?/,'')) || nested++ < nestedLimit);
}
function refsOf(obj, refs = new Set()) {
  if (!obj || typeof obj !== 'object') return refs;
  if (obj.$ref) refs.add(obj.$ref);
  for (const value of Object.values(obj)) refsOf(value, refs);
  return refs;
}
export function analyzeSpec(spec, url) {
  const api = createHash('sha256').update(url).digest('hex').slice(0,8);
  const schemas = spec.components?.schemas || spec.definitions || {};
  const result = { name: spec.info?.title || new URL(url).hostname, version: spec.info?.version || spec.openapi || spec.swagger, api, source: url, entities: [], operations: [], dependencies: [], patterns: [], warnings: [] };
  result.warnings.push(...(spec['x-atlas-warnings']||[]));
  const schemaPrefix = spec.components?.schemas ? '#/components/schemas/' : '#/definitions/';
  const id = name => `${api}:${name}`;
  for (const [name, raw] of Object.entries(schemas)) {
    const fields = fieldsOf(spec, raw);
    if (!fields.length && !raw.properties && !raw.allOf) continue;
    const kind=/^\d{3}$/.test(name)?'error':/Event$/.test(name)?'event':/(Request|Response|List)$/.test(name)?'supporting schema':'schema';
    result.entities.push({ id:id(name), name:title(name), rawName:name, api:result.name, group:kind==='error'?'Errors':kind==='event'?'Events':'Resources', description:clean(raw.description).slice(0,700) || `The ${title(name)} schema defined by ${result.name}.`, fields, source:raw['x-atlas-source']||url, pointer:`${schemaPrefix}${name}`, operationIds:[], kind });
  }
  const byName = new Map(result.entities.map(e => [normalize(e.rawName),e]));
  for(const entity of result.entities) {
    const alias=resourceName(entity.rawName);
    const current=byName.get(alias);
    if(alias && (!current || (/Request/i.test(current.rawName) && /Response/i.test(entity.rawName))))byName.set(alias,entity);
  }
  function addDependency(source, target, field, type, evidence, status = 'documented', extras = {}) {
    if (!source || !target || source === target) return;
    result.dependencies.push({ id:`${source}>${target}:${field}:${type}`, source,target,field,type,status,evidence,sourceUrl:url,...extras });
  }
  for (const entity of result.entities) {
    for (const ref of refsOf(schemas[entity.rawName])) {
      const targetName = ref.startsWith(schemaPrefix) ? ref.slice(schemaPrefix.length) : null;
      if (targetName && result.entities.some(e => e.id === id(targetName))) addDependency(id(targetName),entity.id,'$ref','schema',`${entity.rawName} references ${targetName} in its schema.`,'documented',{sourceUrl:entity.source});
    }
    for (const field of entity.fields) {
      const leaf = field.name.split('.').pop().replace(/\[\]/g,'');
      if (!/(?:_id|Id|_ids|Ids)$/.test(leaf)) continue;
      const name = leaf.replace(/(?:_ids?|Ids?)$/,''); const target = byName.get(normalize(name));
      if (!target) continue;
      const documented = /\b(identifier|identifies|id of|id for)\b/i.test(field.description) && normalize(field.description).includes(normalize(target.rawName));
      addDependency(target.id,entity.id,field.name,'id',field.description || `${leaf} matches the ${target.name} resource name. Verify this relationship in the API documentation.`,documented ? 'documented' : 'inferred',{sourceUrl:entity.source});
    }
  }
  for (const [path, rawPath] of Object.entries(spec.paths)) {
    const pathObject = deref(spec, rawPath);
    for (const method of methods) {
      const op = pathObject[method]; if (!op) continue;
      const operationId = `${api}:${method}:${path}`;
      const params = [...(pathObject.parameters || []), ...(op.parameters || [])].map(p => deref(spec,p));
      const body = deref(spec, op.requestBody);
      const inputs = params.flatMap(p => p.in === 'body' ? fieldsOf(spec,p.schema) : [{ name:p.name, type:p.schema?.type || p.type || 'string',required:!!p.required,description:clean(p.description),location:p.in }]);
      for (const content of Object.values(body.content || {})) inputs.push(...fieldsOf(spec,content.schema).map(f => ({...f,location:'body'})));
      const responses = Object.entries(op.responses || {}).filter(([code]) => /^2/.test(code)).map(([,r]) => deref(spec,r));
      let outputs = []; const responseRefs = new Set();
      for (const response of responses) {
        for (const ref of refsOf(response)) responseRefs.add(ref);
        if (response.schema) outputs.push(...fieldsOf(spec,response.schema));
        for (const content of Object.values(response.content || {})) outputs.push(...fieldsOf(spec,content.schema));
      }
      const entityRefs = refsOf({requestBody:op.requestBody,responses:Object.fromEntries(Object.entries(op.responses||{}).filter(([code])=>/^2/.test(code))),parameters:params});
      const entityIds = [];
      for (const entity of result.entities) {
        const exact = entityRefs.has(`${schemaPrefix}${entity.rawName}`);
        const pathMatch = entity.kind!=='error' && path.split('/').some(p => normalize(p) === resourceName(entity.rawName));
        if (exact || pathMatch) { entityIds.push(entity.id);entity.operationIds.push(operationId); if (op.tags?.[0]) entity.group = op.tags[0]; }
      }
      result.operations.push({ id:operationId,name:op.summary || op.operationId || `${method.toUpperCase()} ${path}`,operationId:op.operationId || '',method:method.toUpperCase(),path,description:clean(op.description).slice(0,800),...(op['x-atlas-webhook']?{kind:'webhook'}:{}),...(Object.keys(body.content||{})[0]?{contentType:Object.keys(body.content||{})[0]}:op.consumes?.[0]||spec.consumes?.[0]?{contentType:op.consumes?.[0]||spec.consumes?.[0]}:{}),inputs:boundedFields(inputs),outputs:boundedFields(outputs),entityIds,tags:op.tags||[],source:op['x-atlas-source']||url,security:op.security ?? spec.security ?? [],responseRefs:[...responseRefs],links:responses.flatMap(r => Object.entries(r.links || {}).map(([name,link]) => ({name,...deref(spec,link)}))) });
    }
  }
  for (const op of result.operations) {
    for (const input of op.inputs) {
      const field = input.name?.split('.').pop().replace(/[{}\[\]-]/g,'_'); if (!field) continue;
      let key = normalize(field.replace(/(?:_?ids?|Ids?)_?$/,''));
      if (!key && /id/i.test(field)) key = normalize(op.path.split('/').filter(p => p && !p.startsWith('{')).at(-1));
      const resource = byName.get(key); if (!resource) continue;
      const producers = result.operations.filter(p => {
        const pathParts=p.path.split('/').filter(part=>part&&!/^(?:api|v\d+(?:\.\d+)?|\d+(?:\.\d+)?)$/i.test(part));
        const directCollection=pathParts.length===1&&normalize(pathParts[0])===resourceName(resource.rawName);
        const createNamed=/\b(?:create|add|provision|register)\b/i.test(`${p.name} ${p.operationId.replace(/_/g,' ')}`);
        return p.id!==op.id&&p.method==='POST'&&(directCollection||createNamed)&&p.entityIds.includes(resource.id)&&p.outputs.some(f=>/(?:^|\.)[A-Za-z_]*id$/i.test(f.name))&&pathParts.some(segment=>normalize(segment)===resourceName(resource.rawName));
      });
      for (const producer of producers.slice(0,1)) {
        const targetEntity = result.entities.find(e => op.path.split('/').filter(p => !p.startsWith('{')).some(p => normalize(p) === resourceName(e.rawName)) && e.id !== resource.id) || resource;
        result.dependencies.push({id:`${producer.id}>${op.id}:${input.name}`,source:resource.id,target:targetEntity.id,field:input.name,type:'operation',status:'inferred',evidence:`${op.method} ${op.path} accepts ${input.name}${input.required ? ' (required)' : ' (optional)'}. ${producer.method} ${producer.path} returns a candidate ${resource.name} identifier. Producer matching is inferred; confirm the response field and business prerequisites.`,sourceUrl:op.source,sourceOperation:producer.id,targetOperation:op.id,required:input.required});
      }
    }
    for (const link of op.links) {
      const targetOp = result.operations.find(p => p.operationId === link.operationId);
      if (targetOp && op.entityIds[0] && targetOp.entityIds[0]) addDependency(op.entityIds[0],targetOp.entityIds[0],Object.entries(link.parameters || {}).map(([k,v])=>`${v} → ${k}`).join(', ') || link.name,'operation',clean(link.description) || `Explicit OpenAPI link: ${link.name}.`,'documented',{sourceOperation:op.id,targetOperation:targetOp.id,sourceUrl:op.source});
    }
  }
  result.dependencies = [...new Map(result.dependencies.map(d => [d.id,d])).values()];
  const security = spec.components?.securitySchemes || spec.securityDefinitions || {};
  for (const [name,s] of Object.entries(security)) result.patterns.push({name:'Authentication',detail:`${name}: ${s.type}${s.scheme ? ` / ${s.scheme}` : ''}${s.in ? ` in ${s.in}` : ''}. ${clean(s.description)}`,source:url});
  const allInputs = result.operations.flatMap(o => o.inputs);
  for (const [name,regex] of [['Pagination',/^(limit|offset|cursor|page|page_size|next_token)$/i],['Idempotency',/idempotenc/i]]) {
    const names = [...new Set(allInputs.filter(f => regex.test(f.name)).map(f=>f.name))];
    if (names.length) result.patterns.push({name,detail:`Documented request fields: ${names.join(', ')}. Inspect the endpoint for exact behavior.`,source:url});
  }
  const externalRefs = [...refsOf(spec)].filter(ref => !ref.startsWith('#/'));
  if (externalRefs.length) result.warnings.push(`${externalRefs.length} external references were not resolved. Import their specifications as additional sources.`);
  result.entities.sort((a,b)=>{
    const rank=e=>(e.kind==='schema'?10:e.kind==='supporting schema'?2:e.kind==='event'?0:-10)+Math.min(30,e.operationIds.length);
    return rank(b)-rank(a)||a.name.localeCompare(b.name);
  });
  return result;
}
