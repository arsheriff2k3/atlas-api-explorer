// Projects are generic: a project is a set of source URLs, and every rule below
// works for any API. The examples are only starting data, not special cases.

/** Maps built by an older extractor are marked "Update available" (Rerun refreshes them). */
export const MIN_CANONICAL_VERSION = 11;

export interface ProjectTemplate { key: string; name: string; kind: string; description: string; badge: string; urls: string[]; homepage: string }
export const EXAMPLE_PROJECTS: ProjectTemplate[] = [
 {key:'chargebee',name:'Chargebee',kind:'Billing & subscriptions',badge:'C',description:'Customers, subscriptions, invoices, catalog items, payments, and how their IDs connect.',
  urls:['https://raw.githubusercontent.com/chargebee/openapi/main/spec/chargebee_api_v2_pc_v2_spec.json'],homepage:'https://apidocs.chargebee.com/docs/api/getting-started'},
 {key:'rocketlane',name:'Rocketlane',kind:'Projects & delivery',badge:'R',description:'Projects, tasks, companies, time entries, and the dependencies between reference endpoints.',
  urls:['https://developer.rocketlane.com/'],homepage:'https://developer.rocketlane.com/'},
 // Intuit publishes no OpenAPI file. This is a cleaned conversion of Intuit's V3 Postman
 // collection, rebuilt by scripts/clean-quickbooks-spec.mjs. The GraphQL file (Projects, Custom
 // Fields, Dimensions, Sales Tax) is reconstructed from Intuit's CLI and sample apps: introspection
 // needs an OAuth token. Replace it with an introspected schema when one is available.
 {key:'quickbooks',name:'QuickBooks Online',kind:'Accounting',badge:'Q',description:'REST accounting (customers, invoices, payments, bills, items, accounts) plus GraphQL projects, custom fields, and sales tax.',
  urls:['https://raw.githubusercontent.com/arsheriff2k3/atlas-api-explorer/ui-change/docs/specs/quickbooks-online-accounting.json','https://raw.githubusercontent.com/arsheriff2k3/atlas-api-explorer/ui-change/docs/specs/quickbooks-online-graphql.graphql'],homepage:'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account'},
];

/** Stable identity of a project across re-runs: its sorted source URLs. */
export const sourceKeyFor = (urls: string[]) => [...urls].map(url => url.trim()).sort().join('|');

export const templateFor = (key: string | null) => EXAMPLE_PROJECTS.find(item => item.key === key) || null;
export const templateForUrls = (urls: string[]) => { const key = sourceKeyFor(urls); return EXAMPLE_PROJECTS.find(item => sourceKeyFor(item.urls) === key) || null; };
