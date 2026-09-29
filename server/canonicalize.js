import { createHash } from 'node:crypto';
import { normalize } from './parser.js';

const singular = word => word.endsWith('ies') ? `${word.slice(0,-3)}y` : word.endsWith('sses') ? word.slice(0,-2) : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0,-1) : word;
const humanize = value => value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]/g,' ').split(/\s+/).filter(Boolean).map((part,index)=>index?part.toLowerCase():part[0].toUpperCase()+part.slice(1).toLowerCase()).join(' ');
const host = url => { try { return new URL(url).hostname; } catch { return ''; } };
const resourceId = (origin,key) => `resource:${createHash('sha256').update(`${origin}|${key}`).digest('hex').slice(0,12)}`;
const sourcePriority = operation => operation.method === 'GET' && /\{[^}]+\}$/.test(operation.path) ? 4 : operation.method === 'GET' ? 3 : operation.method === 'POST' ? 2 : 1;
const genericSchemaDescription = description => !description || /^The .+ schema defined by /i.test(description);
const endpointSentence = sentence => /^(?:Creates?|Retrieves?|Gets?|Lists?|Updates?|Deletes?|Removes?|Archives?|Searches?|Fetches?)\b/i.test(sentence.trim());
function descriptionSummary(description) {
  if (genericSchemaDescription(description)) return '';
  const prose=description.split(/\b(?:See also|Note:)\b/i)[0].trim();
  const sentences=prose.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map(sentence=>sentence.trim()).filter(sentence=>!endpointSentence(sentence)&&!/^[\])}]/.test(sentence))||[];
  return (sentences.slice(0,2).join(' ')||(!endpointSentence(prose)?prose:'')).replace(/\s+/g,' ').slice(0,420);
}
function resourceDescription(resource, candidates) {
  const alias=normalize(resource.name);
  const ranked=[...candidates].sort((a,b)=>Number(normalize(a.rawName||a.name)===alias)-Number(normalize(b.rawName||b.name)===alias)).reverse();
  for (const entity of ranked) {
    const summary=descriptionSummary(entity.description);
    if (summary) return summary;
  }
  return `The documentation exposes ${resource.name} as a resource, but does not describe its purpose.`;
}

function routeOf(operation) {
  if (operation.kind === 'webhook') return null;
  const parts = operation.path.split('/').filter(Boolean).filter(part => !/^(?:api|v\d+(?:\.\d+)?|\d+(?:\.\d+)?)$/i.test(part));
  const root = parts[0];
  if (!root || /^\{/.test(root)) return null;
  // A nested endpoint is a member of its root reference family. The
  // operation still keeps its full path and distinct inputs/outputs.
  return {key:root,name:humanize(singular(root)),root};
}

function legacyNestedKey(operation) {
  const parts=operation.path.split('/').filter(Boolean).filter(part=>!/^(?:api|v\d+(?:\.\d+)?|\d+(?:\.\d+)?)$/i.test(part));
  return operation.method==='GET' && /^\{[^}]+\}$/.test(parts[1]||'') && /^[a-z][a-z-]*s$/i.test(parts[2]||'') && parts.length===3 ? `${parts[0]}/${parts[2]}` : null;
}

function schemaKey(entity, resources) {
  const raw = entity.rawName || entity.name;
  const stripped = raw.replace(/^Example(?:API)?(?:Request|Response)/i,'').replace(/^Api/i,'');
  const compact = normalize(stripped);
  const candidates = [...resources].filter(resource => {
    const alias = normalize(resource.name);
    const root = normalize(singular(resource.root));
    return compact.startsWith(alias) || compact.startsWith(root);
  });
  candidates.sort((a,b)=>normalize(b.name).length-normalize(a.name).length);
  return candidates[0]?.id || null;
}

// Upgrade saved maps that were built when nested collections became separate
// graph nodes. Those endpoints belong to the parent reference resource.
export function reconcileResourceEndpoints(analysis) {
  const byId=new Map(analysis.entities.map(entity=>[entity.id,entity]));
  const operationsById=new Map(analysis.operations.map(operation=>[operation.id,operation]));
  const replacements=new Map();
  for (const entity of analysis.entities) {
    const operations=(entity.operationIds||[]).map(id=>operationsById.get(id)).filter(Boolean);
    if (!operations.length) continue;
    const parents=operations.map(operation=>{
      const key=legacyNestedKey(operation);
      if (!key || resourceId(host(operation.source),key)!==entity.id) return null;
      return byId.get(resourceId(host(operation.source),routeOf(operation).root));
    });
    if (parents.every(parent=>parent && parent.id===parents[0].id)) {
      const parent=parents[0];
      replacements.set(entity.id,parent.id);
      parent.schemaNames=[...new Set([...(parent.schemaNames||[]),...(entity.schemaNames||[])])];
    }
  }
  if (replacements.size) {
    analysis.entities=analysis.entities.filter(entity=>!replacements.has(entity.id));
    const dependencies=new Map();
    for (const link of analysis.dependencies) {
      const source=replacements.get(link.source)||link.source;
      const target=replacements.get(link.target)||link.target;
      if (source===target) continue;
      const next={...link,source,target,id:`${source}>${target}:${link.field}`};
      const key=`${source}|${target}|${link.type}|${normalize(link.field)}`;
      const previous=dependencies.get(key);
      if (!previous || (next.status==='documented'&&previous.status!=='documented')) dependencies.set(key,next);
    }
    analysis.dependencies=[...dependencies.values()];
    analysis.warnings=analysis.warnings.map(warning=>warning.replace(/\d+ endpoint resource families are shown as entities/,`${analysis.entities.length} endpoint resource families are shown as entities`));
  }
  const remaining=new Map(analysis.entities.map(entity=>[entity.id,entity]));
  for (const operation of analysis.operations) {
    const route=routeOf(operation);
    const parent=route && remaining.get(resourceId(host(operation.source),route.root));
    const ids=new Set((operation.entityIds||[]).map(id=>replacements.get(id)||id).filter(id=>remaining.has(id)));
    if (parent) ids.add(parent.id);
    operation.entityIds=[...ids];
  }
  for (const entity of analysis.entities) {
    entity.operationIds=analysis.operations.filter(operation=>operation.kind!=='webhook'&&operation.entityIds.includes(entity.id)).map(operation=>operation.id);
  }
  analysis.entities.sort((a,b)=>b.operationIds.length-a.operationIds.length||a.name.localeCompare(b.name));
  inferResourceIdLinks(analysis);
  analysis.coverage.resourceCount=analysis.entities.length;
  analysis.coverage.canonicalVersion=Math.max(8,analysis.coverage.canonicalVersion||0);
  return analysis;
}

// Schema-level inference misses IDs whose schemas are named after DTOs
// (CustomerCompanyPublicAPIResponseEntity), so repeat the ID-name match
// against the final resource names: customer.companyId -> Company.
function inferResourceIdLinks(analysis) {
  const byName=new Map(analysis.entities.map(entity=>[normalize(entity.name),entity]));
  const operationsById=new Map(analysis.operations.map(operation=>[operation.id,operation]));
  const existing=new Set(analysis.dependencies.map(link=>`${link.source}|${link.target}|${normalize(link.field.replace(/^data\[\]\./,''))}`));
  for (const entity of analysis.entities) {
    const writes=(entity.operationIds||[]).map(id=>operationsById.get(id)).filter(operation=>operation && /^(?:POST|PUT|PATCH)$/.test(operation.method) && routeOf(operation) && resourceId(host(operation.source),routeOf(operation).root)===entity.id);
    const fields=new Map([...entity.fields,...writes.flatMap(operation=>operation.inputs||[])].map(field=>[field.name.replace(/^data\[\]\./,''),field]));
    for (const [name,field] of fields) {
      const leaf=name.split('.').pop().replace(/\[\]/g,'');
      if (!/(?:_id|Id|_ids|Ids)$/.test(leaf)) continue;
      const source=byName.get(normalize(leaf.replace(/(?:_ids?|Ids?)$/,'')));
      if (!source || source.id===entity.id) continue;
      const key=`${source.id}|${entity.id}|${normalize(name)}`;
      if (existing.has(key)) continue;
      existing.add(key);
      analysis.dependencies.push({id:`${source.id}>${entity.id}:${name}`,source:source.id,target:entity.id,field:name,type:'id',status:'inferred',evidence:field.description||`${leaf} matches the ${source.name} resource name. Verify this relationship in the API documentation.`,sourceUrl:entity.source,extraction:'Resource ID name match'});
    }
  }
}

// OpenAPI schemas are DTOs, not necessarily business entities. Derive the
// public resource inventory from endpoint paths, then attach their schemas.
export function canonicalizeAnalysis(analysis) {
  const rawEntities = analysis.entities;
  const resources = new Map();
  const operationRoute = new Map();
  for (const operation of analysis.operations) {
    const route = routeOf(operation);
    if (!route) continue;
    const origin = host(operation.source);
    const key = `${origin}|${route.key}`;
    let resource = resources.get(key);
    if (!resource) {
      resource = {id:resourceId(origin,route.key),name:route.name,rawName:route.name,api:origin,group:humanize(route.root),description:'',fields:[],source:operation.source,sourcePriority:sourcePriority(operation),operationIds:[],kind:'resource',schemaNames:[],root:route.root,tagVotes:new Map()};
      resources.set(key,resource);
    }
    for(const tag of operation.tags||[])if(tag)resource.tagVotes.set(tag,(resource.tagVotes.get(tag)||0)+1);
    resource.operationIds.push(operation.id);
    if(sourcePriority(operation)>resource.sourcePriority){resource.source=operation.source;resource.sourcePriority=sourcePriority(operation)}
    operationRoute.set(operation.id,resource.id);
  }
  const resourceList = [...resources.values()];
  const idMap = new Map();
  const direct = new Set();
  for (const entity of rawEntities) {
    const votes = new Map();
    for (const operationId of entity.operationIds || []) {
      const resource = operationRoute.get(operationId);
      if (resource) votes.set(resource,(votes.get(resource)||0)+1);
    }
    const lexical = schemaKey(entity,resourceList);
    const winner = [...votes].sort((a,b)=>b[1]-a[1] || Number(b[0]===lexical)-Number(a[0]===lexical))[0]?.[0] || lexical;
    if (winner) {
      idMap.set(entity.id,winner);
      const resource = resourceList.find(item=>item.id===winner);
      resource.schemaNames.push(entity.rawName || entity.name);
      if (votes.size || normalize(entity.rawName||entity.name)===normalize(resource.name)) direct.add(entity.id);
    }
  }
  // A prose-only or schema-only source has no path family to anchor its
  // inventory. Keep named entities, but collapse request/response variants.
  if (!resources.size) {
    for (const entity of rawEntities) {
      if (/^(?:example|pagination|\d{3}|apierror|error)/i.test(entity.rawName||entity.name)) continue;
      const base=(entity.rawName||entity.name).replace(/(?:Public)?(?:API)?(?:Request|Response)(?:API)?(?:Entity|Model)?$/i,'').replace(/(?:Request|Response|Entity|Model)$/i,'');
      const name=humanize(base||entity.name);
      const key=`${host(entity.source)}|${normalize(name)}`;
      let resource=resources.get(key);
      if (!resource) {resource={id:resourceId(host(entity.source),normalize(name)),name,rawName:name,api:entity.api,group:entity.group,description:entity.description,fields:[],source:entity.source,operationIds:[],kind:'resource',schemaNames:[],root:name};resources.set(key,resource);}
      idMap.set(entity.id,resource.id);resource.schemaNames.push(entity.rawName||entity.name);direct.add(entity.id);
    }
  } else {
    for (const entity of rawEntities.filter(item=>item.kind==='entity' && !idMap.has(item.id))) {
      const name=humanize(entity.name);
      const key=`${host(entity.source)}|${normalize(name)}`;
      if (resources.has(key)) {idMap.set(entity.id,resources.get(key).id);continue;}
      const resource={id:resourceId(host(entity.source),normalize(name)),name,rawName:name,api:entity.api,group:entity.group,description:entity.description,fields:[],source:entity.source,operationIds:[],kind:'resource',schemaNames:[entity.rawName||entity.name],root:name};
      resources.set(key,resource);idMap.set(entity.id,resource.id);direct.add(entity.id);
    }
  }
  const finalResources=[...resources.values()];
  const canonicalById=new Map(finalResources.map(resource=>[resource.id,resource]));
  const fieldCandidates=new Map();
  for (const entity of rawEntities) {
    const canonical=canonicalById.get(idMap.get(entity.id));
    if (!canonical || !direct.has(entity.id)) continue;
    const list=fieldCandidates.get(canonical.id)||[];list.push(entity);fieldCandidates.set(canonical.id,list);
  }
  for (const resource of finalResources) {
    const alias=normalize(resource.name);
    const candidates=(fieldCandidates.get(resource.id)||[]).sort((a,b)=>{
      const score=entity=>{
        const raw=normalize((entity.rawName||entity.name).replace(/(?:public|api|request|response|entity|model|example)/gi,''));
        return Number(raw===alias)*1000 + Number(!/^Example/i.test(entity.rawName||''))*100 + Math.min(99,entity.fields?.length||0);
      };
      return score(b)-score(a);
    }).slice(0,4);
    const fields=new Map();
    for (const entity of candidates) for (const field of entity.fields||[]) if (!fields.has(field.name) || field.required) fields.set(field.name,field);
    resource.fields=[...fields.values()];
    const exactDefinitions=rawEntities.filter(entity=>normalize(entity.rawName||entity.name)===alias);
    resource.description=resourceDescription(resource,[...new Map([...exactDefinitions,...candidates].map(entity=>[entity.id,entity])).values()]);
  }
  for (const operation of analysis.operations) {
    const ids=new Set([operationRoute.get(operation.id),...(operation.entityIds||[]).map(id=>idMap.get(id))].filter(Boolean));
    operation.entityIds=[...ids];
    for (const id of ids) {
      const resource=canonicalById.get(id);
      if (resource && operation.kind !== 'webhook' && !resource.operationIds.includes(operation.id)) resource.operationIds.push(operation.id);
    }
  }
  for (const resource of finalResources) {
    if(resource.tagVotes?.size)resource.group=[...resource.tagVotes].sort((a,b)=>b[1]-a[1])[0][0];
    resource.schemaNames=[...new Set(resource.schemaNames)];
    delete resource.root;
    delete resource.sourcePriority;
    delete resource.tagVotes;
  }
  const originalNonSchema=analysis.dependencies.filter(link=>link.type!=='schema');
  const candidates=originalNonSchema.length?originalNonSchema:analysis.dependencies;
  const dependencies=new Map();
  for (const link of candidates) {
    const source=idMap.get(link.source),target=idMap.get(link.target);
    if (!source || !target || source===target) continue;
    // Keep the request path: subscription_items.item_price_id can be required
    // while discounts.item_price_id is optional on the same operation.
    const field=link.field.replace(/^data\[\]\./,'');
    const key=`${source}|${target}|${normalize(field)}`;
    const next={...link,id:`${source}>${target}:${field}`,source,target,field};
    const previous=dependencies.get(key);
    if (!previous || (next.status==='documented' && previous.status!=='documented') || (next.status===previous.status && next.required && !previous.required)) dependencies.set(key,next);
  }
  analysis.entities=finalResources.sort((a,b)=>b.operationIds.length-a.operationIds.length||a.name.localeCompare(b.name));
  analysis.dependencies=[...dependencies.values()];
  analysis.coverage.schemaCount=rawEntities.length;
  analysis.coverage.groupedSchemas=idMap.size;
  analysis.coverage.supportingSchemas=rawEntities.length-idMap.size;
  analysis.coverage.resourceCount=analysis.entities.length;
  reconcileResourceEndpoints(analysis);
  // 9 = complete top-level fields, webhooks kept out of resources. 10 = + servers and content types.
  // Saved maps can be upgraded to 8 in place, but reaching 9 needs a fresh extraction.
  analysis.coverage.canonicalVersion=10;
  analysis.warnings.push(`${rawEntities.length} schema models were examined. ${analysis.entities.length} endpoint resource families are shown as entities; ${idMap.size} schemas were grouped under resources and ${rawEntities.length-idMap.size} supporting or error models were excluded from the resource graph.`);
  return analysis;
}
