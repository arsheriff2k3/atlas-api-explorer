import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { validateUrl } from './network.js';

// "Try it": sends one real request to a public API on the user's behalf.
// The same SSRF rules as documentation fetching apply (public addresses only, DNS
// pinned to the connection). Redirects are not followed, the response is capped,
// and credentials are only used for this request; nothing is stored or logged.
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const BLOCKED_HEADERS = /^(?:host|content-length|connection|transfer-encoding|cookie|upgrade|proxy-.*|te|trailer|keep-alive)$/i;
const MAX_RESPONSE = 256 * 1024;

export async function tryRequest({ url, method, headers = {}, body = null }, signal) {
  const verb = String(method || '').toUpperCase();
  if (!METHODS.has(verb)) throw new Error('Unsupported HTTP method.');
  if (typeof url !== 'string' || url.length > 4096 || /\{[^}]+\}/.test(url)) throw new Error('Fill in every {placeholder} in the URL first.');
  const { url: target, address, addresses } = await validateUrl(url);
  const outgoing = { 'User-Agent': 'AtlasAPIExplorer/1.0 (try it)', Accept: 'application/json, */*', 'Accept-Encoding': 'gzip, br, deflate' };
  for (const [name, value] of Object.entries(headers || {})) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || BLOCKED_HEADERS.test(name) || /[\r\n]/.test(value)) continue;
    outgoing[name] = value;
  }
  const payload = body === null || body === undefined || verb === 'GET' || verb === 'HEAD' ? null : Buffer.from(String(body));
  if (payload && payload.length > 1024 * 1024) throw new Error('The request body is larger than 1 MB.');
  if (payload) outgoing['Content-Length'] = String(payload.length);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? https : http).request(target, {
      method: verb, headers: outgoing, signal, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000,
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, address.address, address.family),
    }, response => {
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
      const decoder = encoding === 'gzip' ? zlib.createGunzip() : encoding === 'br' ? zlib.createBrotliDecompress() : encoding === 'deflate' ? zlib.createInflate() : null;
      const stream = decoder ? response.pipe(decoder) : response;
      const chunks = []; let size = 0; let truncated = false;
      stream.on('data', chunk => { if (size >= MAX_RESPONSE) { truncated = true; return; } chunks.push(chunk); size += chunk.length; });
      stream.on('error', reject);
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE);
        const safeHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !/^set-cookie$/i.test(name)));
        resolve({ status: response.statusCode, statusText: response.statusMessage || '', headers: safeHeaders, body: text, truncated, durationMs: Date.now() - started, redirectedTo: response.headers.location || null });
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('The API did not respond within 20 seconds.')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

/** Encodes an object as application/x-www-form-urlencoded with bracket keys (a[b]=1, a[b][0]=1). */
export function formEncode(value, arrayStyle = 'suffix') {
  const pairs = [];
  const walk = (node, key) => {
    if (node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item) && arrayStyle === 'suffix') for (const [child, childValue] of Object.entries(item)) walk(childValue, `${key}[${child}][${index}]`);
        else walk(item, `${key}[${index}]`);
      });
      return;
    }
    if (node && typeof node === 'object') { for (const [child, childValue] of Object.entries(node)) walk(childValue, key ? `${key}[${child}]` : child); return; }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(node === null ? '' : String(node))}`);
  };
  walk(value, '');
  return pairs.join('&');
}
