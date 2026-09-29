// Discovery is format-first. Hostnames are not a reliable ReadMe signal:
// customer hubs commonly live on their own domains.
const probePaths=['/.well-known/api-catalog','/openapi','/openapi.json','/swagger.json','/asyncapi.yaml','/schema.graphql','/llms.txt','/reference/llms.txt','/docs/llms.txt','/sitemap.xml'];

export function discoveryProbes(input) {
  const url=new URL(input);
  const probes=probePaths.map(path=>new URL(path,url.origin).href);
  const first=url.pathname.split('/').filter(Boolean)[0];
  // Enterprise ReadMe hubs can place the project before /reference or /docs.
  if(first&&!/^(?:docs|reference|api|v\d+(?:\.\d+)?)$/i.test(first)){
    for(const path of ['llms.txt','reference/llms.txt','openapi'])probes.push(new URL(`/${first}/${path}`,url.origin).href);
  }
  return [...new Set(probes)];
}

export function isDiscoveryProbe(url) {
  const path=new URL(url).pathname;
  return probePaths.includes(path)||/\/(?:llms\.txt|reference\/llms\.txt|openapi)$/i.test(path);
}

export function isLlmsIndex(url) {
  return /(?:^|\/)llms(?:-full)?\.txt$/i.test(new URL(url).pathname);
}

export function isReferencePage(url) {
  const path=new URL(url).pathname;
  return /\/reference\/[^/]+$/i.test(path)&&!/\.(?:txt|json|ya?ml|xml|graphql|gql|raml|apib|wsdl|proto)$/i.test(path);
}

export function readmeIndex(text,base) {
  if (!/\.md to any documentation page|## API Reference|\/reference\//i.test(text)) return null;
  const links=[];const references=[];let section='';
  const markdownPages=/Append \.md to any documentation page/i.test(text);
  for (const line of text.split(/\r?\n/)) {
    const heading=line.match(/^#{2,4}\s+(.+)/);
    if (heading) section=heading[1].trim();
    for (const match of line.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      try {
        const url=new URL(match[1],base);
        if (!/^https?:$/.test(url.protocol)) continue;
        url.hash='';
        if(markdownPages&&isReferencePage(url.href)&&!url.pathname.endsWith('.md'))url.pathname+='.md';
        const href=url.href;
        links.push(href);
        if ((/API Reference/i.test(section)||/\/reference\/llms/i.test(base))&&isReferencePage(href)) references.push(href);
      } catch {}
    }
  }
  return {links:[...new Set(links)],references:[...new Set(references)]};
}

export function apiCatalogLinks(text,base) {
  let catalog;
  try { catalog=JSON.parse(text); } catch { return []; }
  if (!Array.isArray(catalog?.linkset)) return [];
  const links=[];
  for (const entry of catalog.linkset) for (const relation of ['service-desc','api-catalog','item']) {
    for (const target of entry?.[relation]||[]) {
      if (typeof target?.href!=='string') continue;
      try { const url=new URL(target.href,base);if(/^https?:$/.test(url.protocol))links.push({url:url.href,relation}); } catch {}
    }
  }
  return links;
}

export function linkHeaderTargets(value,base) {
  const links=[];
  for (const match of String(value||'').matchAll(/<([^>]+)>\s*;\s*rel="?([^";,]+)"?/g)) {
    if (!/(?:service-desc|api-catalog)/.test(match[2])) continue;
    try {const url=new URL(match[1],base);if(/^https?:$/.test(url.protocol))links.push(url.href)}catch{}
  }
  return links;
}
