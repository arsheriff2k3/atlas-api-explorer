// Cleans the unofficial QuickBooks Online OpenAPI conversion into a tidy OpenAPI 3.0.3 spec.
// Usage: node scripts/clean-quickbooks-spec.mjs <input.json> <output.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/clean-quickbooks-spec.mjs <input.json> <output.json>');
  process.exit(1);
}

const SOURCE_URL = 'https://github.com/saireddy12/quickbooks_openapi_file';
const DOCS_URL = 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account';
const SCHEMA_PREFIX = '#/components/schemas/';
const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'];

// Canonical entity names the spec should expose as component schemas.
const ENTITIES = [
  'Account', 'Attachable', 'Bill', 'BillPayment', 'Class', 'CreditMemo', 'Customer', 'Department',
  'Deposit', 'Employee', 'Estimate', 'Invoice', 'Item', 'JournalEntry', 'Payment', 'PaymentMethod',
  'Purchase', 'PurchaseOrder', 'RefundReceipt', 'SalesReceipt', 'TaxAgency', 'Term', 'TimeActivity',
  'Transfer', 'Vendor', 'VendorCredit', 'Preferences', 'TaxService',
];
// Source operationId / schema prefixes that map to a different canonical entity name.
const ENTITY_ALIASES = { Preference: 'Preferences' };
// Path-parameter prefix overrides, e.g. CompanyInfo is read at /companyinfo/{companyId}.
const ID_PREFIX = { CompanyInfo: 'company' };
const SERVER_PATH_PARAMS = new Set(['company_id', 'companyid']); // realm id lives in the server URL
const DROPPED_HEADERS = new Set(['user-agent', 'accept']);
const QUERY_STRING_PARAMS = new Set(['operation', 'include']); // carried by the path key instead
const NAME_LIST_NOTE = 'Name-list entities cannot be deleted. To deactivate one, send a sparse update with `"sparse": true`, `Id`, `SyncToken`, and `"Active": false`.';
const MINOR_VERSION = {
  name: 'minorversion',
  in: 'query',
  description: 'QuickBooks API minor version. Omit for the base version.',
  required: false,
  schema: { type: 'string', example: '75' },
};

const src = JSON.parse(readFileSync(inputPath, 'utf8'));
const srcSchemas = structuredClone(src.components?.schemas ?? {});

// ---------- schema helpers ----------

// Unions the properties of `source` into `target`. First definition wins; nested object shapes are merged too.
function mergeProperties(target, source) {
  target.properties ??= {};
  for (const [name, prop] of Object.entries(source.properties ?? {})) {
    const existing = target.properties[name];
    if (!existing) {
      target.properties[name] = structuredClone(prop);
    } else if (existing.properties && prop.properties) {
      mergeProperties(existing, prop);
    } else if (existing.items?.properties && prop.items?.properties) {
      mergeProperties(existing.items, prop.items);
    }
  }
  return target;
}

// ---------- 1. schemas ----------

const schemas = structuredClone(srcSchemas);
const renames = new Map(); // old schema name -> new schema name

// 1a. Numbered duplicates (Line2, BillAddr1, VendorRef2...) fold into their base schema.
for (const name of Object.keys(schemas).sort()) {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (m && schemas[m[1]]) {
    mergeProperties(schemas[m[1]], schemas[name]);
    renames.set(name, m[1]);
    delete schemas[name];
  }
}

// 1b. Reference-only schemas (value and/or name) collapse into one shared ReferenceType.
for (const name of Object.keys(schemas)) {
  const props = Object.keys(schemas[name].properties ?? {});
  if (/Ref$/.test(name) && props.length && props.every((p) => p === 'value' || p === 'name')) {
    renames.set(name, 'ReferenceType');
    delete schemas[name];
  }
}

// 1c. Canonical entity schemas from <Entity>-*-Request schemas plus any existing <Entity> schema.
const canonical = {};
for (const entity of ENTITIES) {
  const raw = Object.keys(ENTITY_ALIASES).find((k) => ENTITY_ALIASES[k] === entity) ?? entity;
  const requestRe = new RegExp(`^${raw}-.+-Request$`);
  const sourceNames = [entity, ...Object.keys(schemas).filter((n) => requestRe.test(n)).sort()]
    .filter((n) => schemas[n]);
  if (sourceNames.length === 0) throw new Error(`No source schemas found for entity ${entity}`);

  const schema = { type: 'object', description: `A QuickBooks Online ${entity} object.`, properties: {} };
  for (const n of sourceNames) {
    if (!schema.example && schemas[n].example) schema.example = schemas[n].example;
    mergeProperties(schema, schemas[n]);
    if (n !== entity) renames.set(n, entity);
  }

  // Ensure the standard fields exist with the agreed definitions.
  const props = schema.properties;
  props.Id = { type: 'string', description: `Unique identifier of the ${entity}, assigned by QuickBooks.` };
  props.SyncToken = { type: 'string', description: 'Version number used for optimistic locking; required on update and delete.' };
  if (!['TaxService', 'Preferences'].includes(entity)) {
    props.sparse = { type: 'boolean', description: 'Set to true to send a sparse update that changes only the supplied fields.' };
    if (schemas.MetaData) props.MetaData = { $ref: `${SCHEMA_PREFIX}MetaData` };
  }

  canonical[entity] = schema;
  for (const n of sourceNames) delete schemas[n];
}

const componentSchemas = {
  ...schemas,
  ...canonical,
  ReferenceType: {
    type: 'object',
    description: 'A reference to another QuickBooks object.',
    properties: {
      value: { type: 'string', description: 'Id of the referenced object.' },
      name: { type: 'string', description: 'Display name of the referenced object.' },
    },
    required: ['value'],
  },
};
for (const schema of Object.values(componentSchemas)) delete schema.title; // title just repeats the key

const leftoverRequests = Object.keys(componentSchemas).filter((n) => /-[A-Za-z]+-Request$/.test(n));
if (leftoverRequests.length) throw new Error(`Request schemas not merged: ${leftoverRequests.join(', ')}`);

// Follows rename chains (CustomerRef4 -> CustomerRef -> ReferenceType).
function resolveName(name) {
  let n = name;
  const seen = new Set();
  while (renames.has(n)) {
    if (seen.has(n)) throw new Error(`Rename cycle at ${n}`);
    seen.add(n);
    n = renames.get(n);
  }
  return n;
}

// ---------- 2. operations ----------

// Decides the target method/path for one source operation. Returns null for dropped ops.
function describeOperation(srcPath, op) {
  if (srcPath === '/bearer') return null; // OAuth token helper, not a QuickBooks API call
  const opId = op.operationId.replace(/^SalesrRceipt-/, 'SalesReceipt-');

  if (opId === 'Upload-Attachments') return { method: 'post', key: '/upload' };
  if (opId === 'Batch') return { method: 'post', key: '/batch' };
  if (opId === 'CDC-Read') return { method: 'get', key: '/cdc' };
  if (opId === 'ExchangeRate-GetDetails') return { method: 'get', key: '/exchangerate' };
  if (opId.startsWith('Report-')) return { method: 'get', key: srcPath }; // keeps /reports/<Name>

  const dash = opId.indexOf('-');
  if (dash < 0) throw new Error(`Unrecognised operationId "${opId}" at ${srcPath}`);
  const entity = ENTITY_ALIASES[opId.slice(0, dash)] ?? opId.slice(0, dash);
  const action = opId.slice(dash + 1);
  const base = entity.toLowerCase();
  const hasDupe = srcPath.includes('dupe_extra_path');
  const opParam = (op.parameters ?? []).find((p) => p.in === 'query' && QUERY_STRING_PARAMS.has(p.name));

  // Every source op under /query is a QuickBooks SQL-style query (ReadAll, GetAll, Query, CompanyInfo-Read...).
  if (srcPath.startsWith('/query')) {
    return { method: 'post', key: `/query?query=select * from ${entity}`, entity, query: true };
  }

  switch (action) {
    case 'Create':
      return { method: 'post', key: srcPath, entity, single: true };
    case 'ReadById':
    case 'GetById':
    case 'ReadByID': {
      const idName = `${ID_PREFIX[entity] ?? base}Id`;
      return { method: 'get', key: `/${base}/{${idName}}`, entity, single: true, idName };
    }
    case 'Read': // Preference-Read: GET /preferences
      return { method: 'get', key: srcPath, entity, single: true };
    case 'Update':
      return { method: 'post', key: hasDupe ? `/${base}?operation=update` : srcPath, entity, single: true, update: true };
    case 'Delete':
      // Name-list entities have no operation=delete; they are dropped and deactivated via update instead.
      if (opParam?.name !== 'operation') return { drop: true, entity };
      return { method: 'post', key: `/${base}?operation=delete`, entity, single: true };
    case 'Void':
      if (!opParam) throw new Error(`Void operation ${opId} has no operation/include param`);
      return { method: 'post', key: `/${base}?${opParam.name}=void`, entity, single: true };
    default:
      throw new Error(`Unhandled operationId "${opId}" at ${srcPath}`);
  }
}

// Turns a request body that wraps a schema in allOf (ref + example) into a plain ref plus media example.
function cleanRequestBody(body) {
  const content = {};
  for (const [mediaType, media] of Object.entries(body.content)) {
    const m = { ...media };
    if (m.schema?.allOf) {
      const ref = m.schema.allOf.find((x) => x.$ref);
      const withExample = m.schema.allOf.find((x) => x.example !== undefined);
      if (ref) {
        m.schema = { $ref: ref.$ref };
        if (withExample) m.example = withExample.example;
      }
    }
    content[mediaType] = m;
  }
  const out = { content };
  if (body.description) out.description = body.description;
  if (body.required !== undefined) out.required = body.required;
  return out;
}

function buildResponse(t) {
  const { entity } = t;
  if (t.query) {
    const props = {};
    if (canonical[entity]) props[entity] = { type: 'array', items: { $ref: `${SCHEMA_PREFIX}${entity}` } };
    props.startPosition = { type: 'integer' };
    props.maxResults = { type: 'integer' };
    return {
      description: `Query result for ${entity}.`,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              QueryResponse: { type: 'object', properties: props },
              time: { type: 'string' },
            },
          },
        },
      },
    };
  }
  if (t.single && canonical[entity]) {
    return {
      description: `${entity} returned by QuickBooks.`,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              [entity]: { $ref: `${SCHEMA_PREFIX}${entity}` },
              time: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    };
  }
  return { description: 'OK' };
}

function buildOperation(t, op) {
  const opId = op.operationId.replace(/^SalesrRceipt-/, 'SalesReceipt-');
  const srcPathParams = (op.parameters ?? []).filter((p) => p.in === 'path');

  let params = (op.parameters ?? [])
    .filter((p) => {
      if (p.in === 'path') return !t.idName && !SERVER_PATH_PARAMS.has(p.name); // ReadById replaces all path params
      if (p.in === 'header') return !DROPPED_HEADERS.has(p.name.toLowerCase());
      if (p.in === 'query') return !QUERY_STRING_PARAMS.has(p.name); // path key now carries operation/include
      return true;
    })
    .map((p) => (p.in === 'query' && p.name === 'minorversion' ? structuredClone(MINOR_VERSION) : p));

  if (t.idName) {
    const example = srcPathParams.find((p) => !SERVER_PATH_PARAMS.has(p.name))?.schema?.example;
    params.unshift({
      name: t.idName,
      in: 'path',
      description: `Id of the ${t.entity} to read.`,
      required: true,
      schema: example ? { type: 'string', example } : { type: 'string' },
    });
  }

  const out = {
    tags: t.query ? [t.entity] : op.tags,
    summary: opId,
    description: op.description ?? '',
    operationId: opId,
  };
  if (params.length) out.parameters = params;
  if (op.requestBody && t.method !== 'get') out.requestBody = cleanRequestBody(op.requestBody);
  out.responses = { 200: buildResponse(t) };
  return out;
}

const operations = [];
const droppedNameListEntities = new Set();
for (const [srcPath, item] of Object.entries(src.paths)) {
  for (const method of Object.keys(item).filter((m) => HTTP_METHODS.includes(m))) {
    const op = item[method];
    const t = describeOperation(srcPath, op);
    if (!t) continue;
    if (t.drop) {
      droppedNameListEntities.add(t.entity);
      continue;
    }
    operations.push({ t, built: buildOperation(t, op) });
  }
}

// Name-list entities keep their Update op, which gets the deactivation note.
for (const entity of droppedNameListEntities) {
  const update = operations.find((o) => o.built.operationId === `${entity}-Update`);
  if (!update) throw new Error(`No Update operation found for name-list entity ${entity}`);
  update.built.description = [update.built.description, NAME_LIST_NOTE].filter(Boolean).join('\n\n');
}

// Group by path key; a repeated METHOD + path is a bug in the mapping.
const pathItems = {};
for (const { t, built } of operations) {
  const item = (pathItems[t.key] ??= {});
  if (item[t.method]) throw new Error(`Duplicate operation ${t.method.toUpperCase()} ${t.key}`);
  item[t.method] = built;
}
for (const key of Object.keys(pathItems)) {
  if (key.includes('dupe_extra_path')) throw new Error(`Fake dupe path survived: ${key}`);
}
const paths = Object.fromEntries(
  Object.keys(pathItems).sort().map((key) => [
    key,
    Object.fromEntries(HTTP_METHODS.filter((m) => pathItems[key][m]).map((m) => [m, pathItems[key][m]])),
  ]),
);

// ---------- 3. tags ----------

const usedTags = new Set(operations.flatMap(({ built }) => built.tags ?? []));
const tags = (src.tags ?? []).filter((t) => usedTags.has(t.name));
for (const name of usedTags) if (!tags.some((t) => t.name === name)) tags.push({ name });

// ---------- 4. assemble, rewrite refs, strip placeholders ----------

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'QuickBooks Online Accounting API',
    version: '3',
    description:
      'Cleaned, unofficial OpenAPI description of the QuickBooks Online Accounting REST API v3. ' +
      "It is derived from Intuit's QuickBooks Online V3 Postman collection via the " +
      'saireddy12/quickbooks_openapi_file conversion. Intuit does not publish an official OpenAPI file. ' +
      `Reference docs: ${DOCS_URL}`,
    ...(src.info?.license ? { license: src.info.license } : {}),
    'x-source': SOURCE_URL,
  },
  servers: [
    {
      url: 'https://quickbooks.api.intuit.com/v3/company/{realmId}',
      description: 'Production',
      variables: { realmId: { default: '1234567890', description: 'QuickBooks company ID (realm ID).' } },
    },
    {
      url: 'https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}',
      description: 'Sandbox',
      variables: { realmId: { default: '1234567890', description: 'QuickBooks company ID (realm ID).' } },
    },
  ],
  security: [{ oauth2: ['com.intuit.quickbooks.accounting'] }],
  tags,
  paths,
  components: {
    schemas: Object.fromEntries(Object.keys(componentSchemas).sort().map((n) => [n, componentSchemas[n]])),
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2',
            tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            refreshUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            scopes: { 'com.intuit.quickbooks.accounting': 'QuickBooks Online accounting data' },
          },
        },
      },
    },
  },
};

// Rewrites every $ref in the document to the new schema names.
function rewriteRefs(node) {
  if (Array.isArray(node)) return node.forEach(rewriteRefs);
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string' && v.startsWith(SCHEMA_PREFIX)) {
      node[k] = SCHEMA_PREFIX + resolveName(v.slice(SCHEMA_PREFIX.length));
    } else {
      rewriteRefs(v);
    }
  }
}
rewriteRefs(doc);

// Every $ref must now resolve to a component schema.
const missingRefs = new Set();
(function checkRefs(node) {
  if (Array.isArray(node)) return node.forEach(checkRefs);
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string' && v.startsWith(SCHEMA_PREFIX)) {
      if (!doc.components.schemas[v.slice(SCHEMA_PREFIX.length)]) missingRefs.add(v);
    } else {
      checkRefs(v);
    }
  }
})(doc);
if (missingRefs.size) throw new Error(`Unresolved $ref(s): ${[...missingRefs].join(', ')}`);

// Drops example/default values that still hold {{placeholders}}.
(function stripPlaceholders(node) {
  if (Array.isArray(node)) return node.forEach(stripPlaceholders);
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'example' || k === 'default') && typeof v === 'string' && v.includes('{{')) delete node[k];
    else stripPlaceholders(v);
  }
})(doc);
if (JSON.stringify(doc).includes('{{')) throw new Error('Placeholder "{{" survived in the output');

// ---------- 5. write ----------

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(doc, null, 2)}\n`);
const opCount = Object.values(paths).reduce((n, item) => n + Object.keys(item).length, 0);
console.log(`Wrote ${outputPath}: ${Object.keys(paths).length} paths, ${opCount} operations, ${Object.keys(doc.components.schemas).length} schemas`);
