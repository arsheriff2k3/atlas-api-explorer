import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { fetchDocument } from './network.js';
import { parseSpec, embeddedSpecs, combineSpecFragments, analyzeSpec, clean, normalize } from './parser.js';
import { canonicalizeAnalysis } from './canonicalize.js';
import { normalizeAnalysis, validateAnalysis } from './analysisSchema.js';
import { apiCatalogLinks, discoveryProbes, isDiscoveryProbe, isLlmsIndex, isReferencePage, linkHeaderTargets, readmeIndex } from './discovery.js';

function textAndLinks(doc) {
  const links = [];
  if (/html/i.test(doc.contentType) || /^\s*<!doctype html/i.test(doc.text)) {
    const $ = load(doc.text); $('a[href]').each((_,a) => {try{links.push(new URL($(a).attr('href'),doc.url).href)}catch{}});
    $('script,style,nav,footer,header,aside').remove();
    return {text:clean($('main').text() || $('article').text() || $('body').text()),links,title:$('title').text()};
  }
  for (const match of doc.text.matchAll(/(?:\]\(([^\s)]+)\)|https?:\/\/[^\s<>"')]+|<loc>([^<]+)<\/loc>)/g)) {
    try { links.push(new URL((match[1] || match[2] || match[0]).replace(/[.,;:]+$/,''),doc.url).href); } catch {}
  }
  return {text:doc.text,links,title:doc.text.match(/^#\s+(.+)/m)?.[1] || new URL(doc.url).hostname};
}
function rawGithub(url) {
  const u = new URL(url); if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) return `https://raw.githubusercontent.com${u.pathname.replace('/blob/','/')}`;
  return url;
}
async function fetchWithRetry(url,signal) {
  for(let attempt=0;;attempt++) {
    try{return await fetchDocument(url,signal)}
    catch(error){
      if(signal.aborted||!(error.timeout||[429,502,503,504].includes(error.status))||attempt>=3)throw error;
      const delay=Math.min(30000,Math.max(error.retryAfterMs||0,700*2**attempt));
      await new Promise((resolve,reject)=>{const onAbort=()=>{clearTimeout(timer);reject(signal.reason)};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve()},delay);signal.addEventListener('abort',onAbort,{once:true})});
    }
  }
}
// OpenAPI server URLs may be templates; fixed-choice variables get their default and
// free variables (e.g. {site}) stay as placeholders for the user to fill in.
function serverUrl(server){
  if(!server||typeof server.url!=='string')return null;
  const url=server.url.replace(/\{([^}]+)\}/g,(match,name)=>{const variable=server.variables?.[name];return variable?.enum?.length&&variable.default!==undefined?String(variable.default):match});
  return url.replace(/^(https:\/\/[^/]+):443(?=\/|$)/,'$1').replace(/^(http:\/\/[^/]+):80(?=\/|$)/,'$1');
}
export async function runAnalysis(urls, options, progress, signal) {
  let maxPages = options.maxPages || 24;
  const queue = [...urls]; const seen = new Set(); const discovered = new Set(urls); const pages = []; const specs = []; const warnings = [];
  const roots = urls.map(u=>new URL(u));
  const allowed = u => roots.some(root=>new URL(u).origin === root.origin);
  const catalogSpecs=new Set();const catalogIndexes=new Set();const readmeOrigins=new Set();
  const referenceManifest=new Set();const fetchedDocuments=new Set();const parsedDocuments=new Set();const unparsedDefinitions=new Set();
  let probesAdded = false;
  progress('discover',6,'Discovering documentation and API specifications');
  while (queue.length && seen.size < maxPages) {
    signal.throwIfAborted();
    const candidates = queue.splice(0,Math.min(readmeOrigins.size?1:3,maxPages-seen.size)).filter(u=>!seen.has(u));
    candidates.forEach(u=>seen.add(u));
    const fetched = await Promise.all(candidates.map(async url=>{try{return {requested:url,doc:await fetchWithRetry(url,signal)}}catch(e){if(signal.aborted)throw e;if(e.status===429)throw new Error(`The documentation host rate-limited this crawl at ${url}. Wait and rerun; the previous saved map is preserved.`);if(!isDiscoveryProbe(url)||!/HTTP 404/.test(e.message))warnings.push(`${url}: ${e.message}`);return null;}}));
    for (const item of fetched.filter(Boolean)) {
      const {doc,requested}=item;
      fetchedDocuments.add(requested);fetchedDocuments.add(doc.url);
      if (/For AI agents:|Append \.md to any documentation page/i.test(doc.text)) readmeOrigins.add(new URL(doc.url).origin);
      const spec = parseSpec(doc.text,doc.url);
      if (spec) { specs.push({spec,url:doc.url});parsedDocuments.add(requested);parsedDocuments.add(doc.url);progress('extract',Math.min(50,15+seen.size),`Found a ${spec['x-atlas-format']||'API'} specification. Extracting resources and operations.`);if(urls.includes(doc.url) && /\.(json|ya?ml|graphql|gql|raml|apib|wsdl|xml|proto)(?:\?|$)/i.test(doc.url)){queue.length=0;probesAdded=true;}continue; }
      const embedded=embeddedSpecs(doc.text);
      if(embedded.length) {
        for(const fragment of embedded) specs.push({spec:fragment,url:doc.url,embedded:true,title:doc.text.match(/^#\s+(.+)$/m)?.[1]||'API reference endpoint'});
        parsedDocuments.add(requested);parsedDocuments.add(doc.url);
        progress('extract',Math.min(50,15+seen.size),'Found OpenAPI definitions inside documentation pages.');
      } else if(/^# OpenAPI definition\s*$/im.test(doc.text)){unparsedDefinitions.add(requested);unparsedDefinitions.add(doc.url)}
      const extracted = textAndLinks(doc);
      const index=isLlmsIndex(doc.url)?readmeIndex(doc.text,doc.url):null;
      if(index) {
        readmeOrigins.add(new URL(doc.url).origin);
        for(const link of index.references)referenceManifest.add(link);
        maxPages=Math.max(maxPages,Math.min(350,index.links.length+referenceManifest.size+20));
      }
      const catalog=apiCatalogLinks(doc.text,doc.url);
      if(catalog.length&&/\/api-catalog(?:\?|$)/i.test(doc.url))for(const link of catalog){if(link.relation==='service-desc')catalogSpecs.add(link.url);if(link.relation==='api-catalog')catalogIndexes.add(link.url)}
      const isIndex = /\/(llms(?:-full)?\.txt|sitemap[^/]*\.xml|api-catalog)(?:\?|$)/i.test(doc.url);
      const isGithub = new URL(doc.url).hostname === 'github.com';
      if (!isIndex && !isGithub && !embedded.length) pages.push({url:doc.url,text:extracted.text.slice(0,36000),title:extracted.title,bytes:doc.bytes});
      for (let link of [...extracted.links,...(index?.links||[]),...catalog.map(item=>item.url),...linkHeaderTargets(doc.linkHeader,doc.url)]) {
        try {
          const u = new URL(link);u.hash='';link=rawGithub(u.href);
          if(readmeOrigins.has(u.origin)&&isReferencePage(link)&&!u.pathname.endsWith('.md')&&!isLlmsIndex(link)){u.pathname+='.md';link=u.href}
          if (!/^https?:/.test(link)) continue;
          const specLink = /(?:openapi|swagger|asyncapi|openrpc|postman|collection|spec)[^?#]*\.(json|ya?ml)(?:\?|$)|\.(?:graphql|gql|raml|apib|wsdl|proto)(?:\?|$)/i.test(link)||catalogSpecs.has(link);
          const githubRepo = u.hostname === 'github.com' && /openapi|swagger|asyncapi|openrpc|postman|blueprint|graphql|raml|protobuf|smithy|wsdl/i.test(u.pathname) && !/issues|pulls|commits|actions|tags|releases/.test(u.pathname);
          if (githubRepo && u.pathname.split('/').filter(Boolean).length === 2) {
            const tree = `https://api.github.com/repos${u.pathname}/git/trees/HEAD?recursive=1`;
            if (!seen.has(tree) && !queue.includes(tree)) queue.unshift(tree);
          }
          if (!(allowed(link) || specLink || catalogIndexes.has(link) || githubRepo)) continue;
          if (/(?:login|logout|signup|\.png|\.jpg|\.svg|\.pdf|\.zip|\.css|\.js)(?:\?|$)/i.test(link)) continue;
          if (!specLink && !catalogIndexes.has(link) && !githubRepo && !/docs|reference|api|llms|sitemap|guides|openapi/i.test(link)) continue;
          discovered.add(link);
          if (!seen.has(link) && !queue.includes(link)) {
            if (specLink || githubRepo) queue.unshift(link);
            else queue.push(link);
          }
        } catch {}
      }
      if (doc.url.includes('api.github.com/repos/') && doc.url.includes('/git/trees/')) {
        try {
          const tree = JSON.parse(doc.text);const repo=doc.url.split('/repos/')[1].split('/git/')[0];
          let paths=(tree.tree||[]).filter(f=>/(?:openapi|swagger|asyncapi|openrpc|postman|collection|spec).*\.(?:json|ya?ml)$|\.(?:graphql|gql|raml|apib|wsdl|proto)$/i.test(f.path) && !/sdk|test|fixture/i.test(f.path));
          paths.sort((a,b)=>Number(/v2_pc_v2.*json$/.test(b.path))-Number(/v2_pc_v2.*json$/.test(a.path)) || Number(/json$/.test(b.path))-Number(/json$/.test(a.path)));
          if(paths[0]) queue.unshift(`https://raw.githubusercontent.com/${repo}/HEAD/${paths[0].path}`);
        }catch{}
      }
    }
    if (!probesAdded) {
      probesAdded=true;
      // Prefer published indexes, then common specification locations.
      for (const root of roots) for (const url of discoveryProbes(root.href)) if(!seen.has(url)&&!queue.includes(url))queue.push(url);
    }
    // A repository-discovery request should run before long lists of resource pages.
    const priority=url=>/\/\.well-known\/api-catalog$|\/openapi(?:\.(?:json|ya?ml))?$|\/swagger\.json$/i.test(url)||catalogSpecs.has(url)||catalogIndexes.has(url)?6:/raw\.githubusercontent|\/(?:openapi|swagger|asyncapi|openrpc|postman|collection|spec)[^/]*\.(?:json|ya?ml)|\.(?:graphql|gql|raml|apib|wsdl|proto)(?:\?|$)/i.test(url)?5:/api\.github\.com\/repos\//.test(url)?4:/github\.com\/[^/]+\/(?:openapi|swagger|asyncapi|openrpc|postman|blueprint|graphql|raml|protobuf|smithy|wsdl)(?:\/|$)/i.test(url)?3:isLlmsIndex(url)?2:/\/reference\/[^/]+\.md(?:\?|$)/i.test(url)?1:0;
    queue.sort((a,b)=>priority(b)-priority(a));
    progress('read',Math.min(53,10+seen.size/maxPages*42),`Read ${pages.length} pages · found ${specs.length} specifications`,{pages:pages.length,specs:specs.length});
  }
  signal.throwIfAborted();progress('map',58,'Mapping entities, schema references, and ID dependencies');
  const fragmentGroups=new Map();const specUnits=[];
  for(const item of specs) {
    const server=item.spec.servers?.[0]?.url||item.spec.host;
    let apiOrigin;try{apiOrigin=new URL(server,item.url).origin}catch{apiOrigin=new URL(item.url).origin}
    const key=`${apiOrigin}|${item.spec.info?.title||''}|${item.spec.info?.version||''}`;
    if(!fragmentGroups.has(key))fragmentGroups.set(key,[]);
    fragmentGroups.get(key).push(item);
  }
  for(const group of fragmentGroups.values()){
    // A complete OAS is authoritative for duplicate method/path pairs. The
    // per-page fragments still contribute endpoints absent from that OAS.
    const fragments=[...group].sort((a,b)=>Object.keys(b.spec.paths||{}).length-Object.keys(a.spec.paths||{}).length||Number(b.url.endsWith('.md'))-Number(a.url.endsWith('.md')));
    specUnits.push({spec:combineSpecFragments(fragments),url:fragments[0].url});
  }
  const results=specUnits.map(({spec,url})=>analyzeSpec(spec,url));
  const unreadReferences=[...referenceManifest].filter(url=>!fetchedDocuments.has(url));
  const unparsedReferences=[...referenceManifest].filter(url=>unparsedDefinitions.has(url));
  const fullSpecOperations=Math.max(0,...specs.filter(item=>!item.embedded).map(item=>Object.values(item.spec.paths||{}).reduce((sum,path)=>sum+Object.keys(path).filter(key=>/^(get|post|put|patch|delete|head|options)$/i.test(key)).length,0)));
  const fullSpecCoversIndex=referenceManifest.size>0&&fullSpecOperations>=referenceManifest.size*.7;
  if(referenceManifest.size>=10 && !fullSpecCoversIndex && unreadReferences.length>Math.max(3,Math.floor(referenceManifest.size*.2))){
    throw new Error(`Only ${referenceManifest.size-unreadReferences.length} of ${referenceManifest.size} indexed reference pages could be read. The documentation host may be rate limiting this crawl. Wait and rerun; the previous saved map is preserved.`);
  }
  const merged={id:createHash('sha256').update(urls.join() + Date.now()).digest('hex').slice(0,12),name:results[0]?.name || pages[0]?.title?.split('|')[0]?.trim() || new URL(urls[0]).hostname,version:results[0]?.version || 'Documentation',createdAt:new Date().toISOString(),urls,entities:results.flatMap(r=>r.entities),operations:results.flatMap(r=>r.operations),dependencies:results.flatMap(r=>r.dependencies),patterns:results.flatMap(r=>r.patterns),warnings:[...warnings,...results.flatMap(r=>r.warnings)],sources:[...specs.map(s=>({url:s.url,title:`${s.spec['x-atlas-format']||'API'} · ${s.title||s.spec.info?.title||'specification'}`,kind:'spec',status:'analyzed'})),...pages.map(p=>({url:p.url,title:p.title,kind:'page',status:'read'})),...unreadReferences.map(url=>({url,title:'Indexed reference page',kind:'page',status:'not fetched'}))],coverage:{pagesRead:pages.length,specifications:specs.length,discovered:discovered.size,attempted:seen.size,pageLimit:maxPages,complete:false,referencePagesIndexed:referenceManifest.size,referencePagesRead:[...referenceManifest].filter(url=>fetchedDocuments.has(url)).length,referencePagesParsed:[...referenceManifest].filter(url=>parsedDocuments.has(url)).length,referencePagesUnparsed:unparsedReferences.length,referencePagesUnread:unreadReferences.length},mode:'structural',demo:false,servers:[...new Set(specs.flatMap(item=>[...(item.spec.servers||[]).map(serverUrl),item.spec.host?`${(item.spec.schemes||['https'])[0]}://${item.spec.host}${item.spec.basePath||''}`:null]).filter(url=>typeof url==='string'&&/^https?:\/\//.test(url)))].slice(0,8),docsUrl:specs.map(item=>item.spec.externalDocs?.url).find(url=>/^https?:\/\//.test(url||''))||pages[0]?.url||null};
  if(unparsedReferences.length)merged.warnings.push(`${unparsedReferences.length} indexed reference page${unparsedReferences.length===1?' has':'s have'} an OpenAPI definition that could not be parsed: ${unparsedReferences.slice(0,5).join(', ')}`);
  if(unreadReferences.length)merged.warnings.push(`${unreadReferences.length} indexed reference page${unreadReferences.length===1?' was':'s were'} not fetched within this run: ${unreadReferences.slice(0,5).join(', ')}`);
  if (pages.length) merged.warnings.push('Prose pages were discovered and read, but only supported specifications and embedded definitions were parsed.');
  canonicalizeAnalysis(merged);
  // Cross-API field names alone are candidates, never verified dependencies.
  for(const target of merged.entities)for(const field of target.fields.filter(f=>/(?:_id|Id)$/.test(f.name))) {
    const key=normalize(field.name.split('.').pop().replace(/(?:_id|Id)$/,''));
    for(const source of merged.entities.filter(e=>e.api!==target.api && normalize(e.rawName||e.name)===key)) merged.dependencies.push({id:`cross:${source.id}:${target.id}:${field.name}`,source:source.id,target:target.id,field:field.name,type:'cross-api',status:'inferred',evidence:`The field ${field.name} matches ${source.name} in ${source.api}. This is a cross-API candidate based on naming only, not a confirmed integration.`,sourceUrl:target.source});
  }
  if (!merged.entities.length && !merged.operations.length) {
    throw new Error('No supported API specification found. Try a direct OpenAPI, Postman, GraphQL, AsyncAPI, RAML, API Blueprint, OpenRPC, .proto, WSDL, or Smithy JSON AST URL.');
  }
  merged.warnings.push(`Coverage is bounded to ${maxPages} fetches per run. Discovered ${discovered.size} links; unread pages, external references, and undocumented behavior may contain additional dependencies.`);
  merged.entities.sort((a,b)=>{
    const rank=e=>(e.kind==='schema'?10:e.kind==='supporting schema'?2:e.kind==='event'?0:-10)+Math.min(30,e.operationIds.length);
    return rank(b)-rank(a)||a.name.localeCompare(b.name);
  });
  merged.sources=merged.sources.map(s=>({...s,status:s.kind==='spec'?'analyzed':'read only'}));
  progress('finish',96,'Preparing the dependency map and your study path');
  normalizeAnalysis(merged);
  // Every source format must land in the same schema; a violation is a bug, not a user error.
  const problems=validateAnalysis(merged);
  if(problems.length){console.error('[apipassage] analysis schema violations',problems);merged.warnings.push(`Internal check: ${problems.length} record(s) did not match the analysis schema (${problems[0]}).`);}
  return merged;
}
