import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import ipaddr from 'ipaddr.js';

export function publicAddress(address) {
  try {
    const ip = ipaddr.process(address);
    if (ip.range() === 'unicast') return true;
    // NAT64's well-known 64:ff9b::/96 prefix carries a public IPv4 address.
    if (ip.kind() === 'ipv6' && ip.range() === 'rfc6052') {
      const bytes=ip.toByteArray();
      const embedded=bytes.slice(12).join('.');
      return ipaddr.parse(embedded).range() === 'unicast';
    }
    return false;
  } catch { return false; }
}
export async function validateUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS documentation URL on a standard port.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Private and local network addresses are not supported.');
  return { url, address: addresses.find(a=>a.family===4) || addresses[0], addresses };
}
// DNS is validated and pinned to the actual connection, including every redirect.
export async function fetchDocument(input, signal, redirects = 0) {
  if (redirects > 4) throw new Error('Too many redirects.');
  signal?.throwIfAborted();
  const { url, address, addresses } = await validateUrl(input);
  return new Promise((resolve, reject) => {
    // Every validated address is offered so one unreachable CDN node (seen on raw.githubusercontent.com)
    // falls through to the next instead of hanging the whole analysis.
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      signal, headers: { 'User-Agent': 'AtlasAPIExplorer/1.0 (documentation analysis)', Accept: 'application/json,text/markdown,text/html,text/plain,application/yaml,*/*', 'Accept-Encoding': 'gzip, br, deflate' },
      autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000,
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, address.address, address.family),
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume(); resolve(fetchDocument(new URL(res.headers.location, url).href, signal, redirects + 1)); return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        const error=new Error(`HTTP ${res.statusCode}  -  this page could not be read.`);
        error.status=res.statusCode;
        const retryAfter=String(res.headers['retry-after']||'');
        const seconds=Number(retryAfter);
        error.retryAfterMs=Number.isFinite(seconds)&&retryAfter ? seconds*1000 : retryAfter ? Math.max(0,Date.parse(retryAfter)-Date.now()) : 0;
        reject(error);return;
      }
      // Large specs (Chargebee is 12 MB) stall when served uncompressed; the 24 MB limit applies after decoding.
      const encoding = String(res.headers['content-encoding'] || '').trim().toLowerCase();
      const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip() : encoding === 'br' ? zlib.createBrotliDecompress() : encoding === 'deflate' ? zlib.createInflate() : null;
      const body = decoder ? res.pipe(decoder) : res;
      const chunks = []; let bytes = 0;
      body.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 24 * 1024 * 1024) { const error = new Error('Document exceeds the 24 MB limit.'); decoder?.destroy(); req.destroy(error); reject(error); }
        else chunks.push(chunk);
      });
      res.on('error', reject);
      decoder?.on('error', error => { req.destroy(); reject(new Error(`The document could not be decompressed: ${error.message}`)); });
      body.on('end', () => resolve({ url: url.href, text: Buffer.concat(chunks).toString('utf8'), contentType: String(res.headers['content-type'] || ''), linkHeader: String(res.headers.link || ''), bytes }));
    });
    req.setTimeout(20000, () => { const error = new Error('The documentation server took too long to respond.'); error.timeout = true; req.destroy(error); });
    req.on('error', reject);
  });
}
