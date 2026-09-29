import type { Field } from './types';
import type { FieldNeed, ScenarioField } from './scenarios.ts';

// Compares a payload (or field list) from another system, such as CRM Dynamics,
// with a scenario's request fields: what maps, what is missing, what is extra,
// and which values need a transformation before they can be sent.

export interface SourceField { path: string; value: unknown; sample: string }
export type MatchKind = 'exact' | 'name' | 'synonym' | 'similar' | 'manual';
export interface FieldMatch { source: SourceField; target: ScenarioField; kind: MatchKind; score: number; issues: string[] }
export interface PayloadComparison {
  matches: FieldMatch[];
  missing: ScenarioField[];      // required / choose-one API fields with no source value
  review: ScenarioField[];       // conditional API fields with no source value
  extra: SourceField[];          // source values the endpoint does not accept
  coverage: number;              // share of required groups satisfied, 0..1
}

const norm = (value: string) => value.toLowerCase().replace(/\[\]/g, '').replace(/[^a-z0-9]/g, '');
const leaf = (path: string) => path.split(/[.[\]]/).filter(Boolean).at(-1) || path;
const words = (value: string) => new Set(value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\d+/g, ' ').split(/[^a-z]+/).filter(word => word.length > 1 && !['the', 'of', 'id', 'value'].includes(word)));
// Common CRM ↔ billing API vocabulary. Each group is interchangeable.
const SYNONYMS = [
  ['email', 'emailaddress', 'emailid', 'mail'], ['phone', 'telephone', 'mobile', 'mobilephone', 'phonenumber'],
  ['firstname', 'givenname', 'fname'], ['lastname', 'surname', 'familyname', 'lname'], ['company', 'companyname', 'organization', 'organisation', 'accountname', 'name'],
  ['line1', 'street1', 'addressline1', 'address1line1'], ['line2', 'street2', 'addressline2', 'address1line2'], ['city', 'address1city', 'town'],
  ['state', 'stateorprovince', 'address1stateorprovince', 'province', 'region'], ['zip', 'postalcode', 'address1postalcode', 'postcode'], ['country', 'address1country', 'countrycode'],
  ['currency', 'currencycode', 'transactioncurrency', 'isocurrencycode', 'preferredcurrencycode'], ['amount', 'price', 'unitprice', 'totalamount', 'value'], ['quantity', 'qty', 'units'],
  ['description', 'notes', 'note', 'comment', 'details'], ['startdate', 'effectivedate', 'activeon', 'start'], ['enddate', 'expirationdate', 'expireson', 'end'],
  ['vatnumber', 'taxid', 'taxnumber', 'vat'], ['customerid', 'accountid', 'parentcustomerid', 'contactid'], ['ponumber', 'purchaseorder', 'purchaseordernumber'],
];
const synonymGroup = new Map<string, number>();
SYNONYMS.forEach((group, index) => group.forEach(word => synonymGroup.set(word, index)));
// Dynamics lookups arrive as _xxx_value; address fields as address1_*.
const canonical = (path: string) => norm(leaf(path).replace(/^_(.+)_value$/, '$1').replace(/@odata\.[a-z]+$/i, ''));

export function flattenPayload(input: string): SourceField[] {
  const text = input.trim();
  if (!text) return [];
  let data: unknown;
  try { data = JSON.parse(text); }
  catch {
    // Not JSON: one field per line, optionally "field: value" or "field = value".
    return text.split(/\r?\n|,/).map(line => line.trim()).filter(Boolean).map(line => {
      const [path, ...rest] = line.split(/\s*[:=]\s*/);
      const value = rest.join(':').trim();
      return {path: path.trim(), value: value || undefined, sample: value};
    }).filter(item => item.path);
  }
  const fields: SourceField[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) { if (value.length) walk(value[0], `${path}[]`); else fields.push({path, value, sample: '[]'}); return; }
    if (value && typeof value === 'object') { const entries = Object.entries(value).filter(([key]) => !key.startsWith('@odata')); if (!entries.length && path) fields.push({path, value, sample: '{}'}); for (const [key, child] of entries) walk(child, path ? `${path}.${key}` : key); return; }
    if (path) fields.push({path, value, sample: value === null ? 'null' : String(value).slice(0, 60)});
  };
  walk(data, '');
  return fields;
}

function score(source: SourceField, target: Field): {kind: MatchKind; score: number} | null {
  if (norm(source.path) === norm(target.name)) return {kind: 'exact', score: 1};
  const a = canonical(source.path), b = canonical(target.name);
  if (a && a === b) return {kind: 'name', score: .9};
  // Dynamics numbers repeated fields (emailaddress1, telephone1) and suffixes lookups with "id".
  const variants = (value: string) => [value, value.replace(/\d+$/, ''), value.replace(/\d+$/, '').replace(/id$/, ''), value.replace(/code$/, '')];
  const groupsA = new Set(variants(a).map(item => synonymGroup.get(item)).filter(item => item !== undefined));
  if (variants(b).some(item => { const group = synonymGroup.get(item); return group !== undefined && groupsA.has(group); })) return {kind: 'synonym', score: .8};
  if (variants(a).slice(1).some(item => item && item === b)) return {kind: 'name', score: .85};
  const wa = words(source.path), wb = words(target.name);
  let common = 0; for (const word of wa) if (wb.has(word)) common++;
  const jaccard = common / (new Set([...wa, ...wb]).size || 1);
  return jaccard >= .5 ? {kind: 'similar', score: .5 + jaccard * .25} : null;
}

/** Value checks against the API field: type, enum, and date format. */
export function valueIssues(value: unknown, field: Field): string[] {
  if (value === undefined || value === null || value === '') return [];
  const issues: string[] = [];
  const type = field.type.toLowerCase();
  const text = String(value);
  if (field.enum?.length && !field.enum.includes(text)) issues.push(`Map "${text.slice(0, 30)}" to one of: ${field.enum.slice(0, 8).join(', ')}`);
  if (/int|number|long|double|float|decimal/.test(type) && typeof value !== 'number' && Number.isNaN(Number(text))) issues.push('Expects a number');
  else if (/int|long/.test(type) && /\./.test(text)) issues.push(/amount|price|total|balance|fee|cost/i.test(field.name) ? 'Expects a whole number; many APIs take money in the smallest currency unit (e.g. cents)' : 'Expects a whole number');
  if (/bool/.test(type) && typeof value !== 'boolean' && !/^(?:true|false)$/i.test(text)) issues.push('Expects true or false');
  if ((/date|time/.test(type) || /(?:_at|date)$/i.test(leaf(field.name))) && /int|long/.test(type) && Number.isNaN(Number(text))) issues.push('Expects a Unix timestamp in seconds; convert the date');
  return issues;
}

const REQUIRED: FieldNeed[] = ['required', 'one-of'];

export function comparePayload(sources: SourceField[], fields: ScenarioField[], manual: Record<string, string> = {}): PayloadComparison {
  const byName = new Map(fields.map(item => [item.field.name, item]));
  const matches: FieldMatch[] = [];
  const usedTargets = new Set<string>();
  const usedSources = new Set<string>();
  for (const [sourcePath, targetName] of Object.entries(manual)) {
    const source = sources.find(item => item.path === sourcePath); const target = byName.get(targetName);
    if (!source || !target) continue;
    matches.push({source, target, kind: 'manual', score: 1, issues: valueIssues(source.value, target.field)});
    usedTargets.add(target.field.name); usedSources.add(source.path);
  }
  // Best pairs first, each source and target used once.
  const candidates: {source: SourceField; target: ScenarioField; kind: MatchKind; score: number}[] = [];
  for (const source of sources) {
    if (usedSources.has(source.path) || manual[source.path] === '') continue;
    for (const target of fields) {
      const match = score(source, target.field);
      if (match) candidates.push({source, target, ...match, score: match.score + (REQUIRED.includes(target.need) ? .05 : 0) - (target.field.name.split('.').length - 1) * .03});
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  for (const candidate of candidates) {
    if (usedSources.has(candidate.source.path) || usedTargets.has(candidate.target.field.name)) continue;
    usedSources.add(candidate.source.path); usedTargets.add(candidate.target.field.name);
    matches.push({...candidate, issues: valueIssues(candidate.source.value, candidate.target.field)});
  }
  // A "choose one" group is satisfied by any of its members.
  const groupOf = (item: ScenarioField) => item.choice || (item.need === 'one-of' ? item.field.name.replace(/\.[^.]+$/, '') : item.field.name);
  const satisfied = new Set(matches.map(match => groupOf(match.target)));
  const requiredGroups = new Map<string, ScenarioField>();
  for (const item of fields) if (REQUIRED.includes(item.need) && !item.link) requiredGroups.set(groupOf(item), requiredGroups.get(groupOf(item)) || item);
  const linkedRequired = fields.filter(item => REQUIRED.includes(item.need) && item.link && !usedTargets.has(item.field.name));
  const missing = [...[...requiredGroups].filter(([group]) => !satisfied.has(group)).map(([, item]) => item), ...linkedRequired];
  const total = requiredGroups.size + fields.filter(item => REQUIRED.includes(item.need) && item.link).length;
  return {
    matches: matches.sort((x, y) => Number(REQUIRED.includes(y.target.need)) - Number(REQUIRED.includes(x.target.need)) || x.target.field.name.localeCompare(y.target.field.name)),
    missing,
    review: fields.filter(item => item.need === 'conditional' && !usedTargets.has(item.field.name)).slice(0, 40),
    extra: sources.filter(source => !usedSources.has(source.path)),
    coverage: total ? 1 - missing.length / total : 1,
  };
}

/** A request body built from the mapped values, ready to adapt into an integration. */
export function mappedPayload(comparison: PayloadComparison): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const match of comparison.matches) {
    const parts = match.target.field.name.split('.');
    let node: Record<string, unknown> = root;
    parts.forEach((raw, index) => {
      const array = raw.endsWith('[]'); const part = raw.replace(/\[\]$/, '');
      if (index === parts.length - 1) { node[part] = match.source.value; return; }
      if (array) { const list = (node[part] as Record<string, unknown>[] | undefined) || [{}]; node[part] = list; node = list[0]; }
      else { node[part] = (node[part] as Record<string, unknown>) || {}; node = node[part] as Record<string, unknown>; }
    });
  }
  return root;
}
