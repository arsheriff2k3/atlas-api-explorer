import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis } from '../server/agent.js';

const spec = JSON.stringify({
  openapi: '3.0.0', info: { title: 'Rate API', version: '1' },
  paths: { '/customers': { get: { operationId: 'listCustomers', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } } } } } },
  components: { schemas: { Customer: { type: 'object', properties: { id: { type: 'string' } } } } },
});
const root = 'https://docs.example.com/docs';
const page = (links) => ({ text: `<!doctype html><html><body><main>Docs ${links.map(l => `<a href="${l}">x</a>`).join('')}</main></body></html>`, contentType: 'text/html' });
const httpError = (status) => Object.assign(new Error(`HTTP ${status}  -  this page could not be read.`), { status, retryAfterMs: 0 });
const options = { maxPages: 12, paceMs: 0, retryMs: 1 };

function fakeFetch(routes, calls) {
  return async (url) => {
    calls.push(url);
    const route = routes[url];
    const result = typeof route === 'function' ? route() : route;
    if (!result) throw httpError(404);
    if (result instanceof Error) throw result;
    return { url, bytes: result.text.length, linkHeader: '', ...result };
  };
}

test('a transient 429 is retried and the crawl completes', async () => {
  let limited = 2; const calls = [];
  const fetch = fakeFetch({
    [root]: page(['/docs/openapi.json']),
    'https://docs.example.com/docs/openapi.json': () => (limited-- > 0 ? httpError(429) : { text: spec, contentType: 'application/json' }),
  }, calls);
  const result = await runAnalysis([root], { ...options, fetch }, () => {}, new AbortController().signal);
  assert.equal(result.operations.length, 1);
  assert.equal(calls.filter(u => u === 'https://docs.example.com/docs/openapi.json').length, 3);
});

test('a page that stays rate limited is skipped instead of failing the run', async () => {
  const fetch = fakeFetch({
    [root]: page(['/docs/openapi.json', '/docs/reference/limited']),
    'https://docs.example.com/docs/openapi.json': { text: spec, contentType: 'application/json' },
    'https://docs.example.com/docs/reference/limited': () => httpError(429),
  }, []);
  const result = await runAnalysis([root], { ...options, fetch }, () => {}, new AbortController().signal);
  assert.equal(result.operations.length, 1);
  assert.ok(result.warnings.some(w => /rate limited by the documentation host/.test(w)));
});

test('a run with nothing readable because of 429s reports the rate limit', async () => {
  const fetch = fakeFetch({ [root]: () => httpError(429) }, []);
  await assert.rejects(runAnalysis([root], { ...options, fetch }, () => {}, new AbortController().signal), /rate-limited this crawl/);
});
