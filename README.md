# APIPassage

**See the path through every API.**

APIPassage is a local Next.js app for turning public API documentation into an interactive dependency map. Paste a documentation URL or a supported API specification, watch the analysis progress, then inspect entities, operations, ID lineage, design patterns, source coverage, and a guided 30-minute study path. The workspace includes 2D and optional 3D graph views.

## Run locally

Requires Node.js 20.9+ and npm. Analysis uses published API specifications and embedded endpoint definitions. No AI provider is required.

APIPassage requires sign-in with [Clerk](https://clerk.com) and saves every completed analysis to your account in [Convex](https://convex.dev), so each project is generated once and reopens from any browser.

The former Atlas browser preferences are copied to APIPassage keys when opened. Older `atlas-sessions` IndexedDB analyses still import into your account. Internal `x-atlas-*` analysis fields remain readable for saved-map compatibility; project IDs, source keys, and share tokens are unchanged.

1. In the Clerk dashboard, enable the **Convex** integration and copy your Frontend API URL.
2. Link Convex and set the Clerk issuer on the deployment:

   ```bash
   npx convex dev            # links a project, writes CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to .env.local
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
   ```

3. Add the Clerk keys to `.env.local`:

   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   ```

Set `NEXT_PUBLIC_CONVEX_SITE_URL` in `.env.local` to your deployment's Convex site URL. Then start APIPassage, keeping `npx convex dev` running in another terminal:

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Paste a supported specification URL or a documentation site that publishes one.

The workspace at <http://localhost:3000/> lists both built-in projects. You can open them directly:

- **Chargebee:** <http://localhost:3000/?project=chargebee>  -  builds from Chargebee's official API v2/Product Catalog v2 OpenAPI specification on first open, then opens the saved analysis. Older partial Chargebee maps are replaced after a successful full-spec run.
- **Rocketlane:** <http://localhost:3000/?project=rocketlane>  -  opens your saved analysis, or builds a structural map from the public documentation root on first visit.

Use **All projects** in the sidebar or the Workspace breadcrumb to return to the project list. Completed analyses are saved to your Convex account, so opening a project on another browser or after clearing site storage reuses the saved map. Use **Rerun** to refresh a project from its documentation, or delete a saved analysis from the project list. Analyses saved in this browser's IndexedDB by earlier versions are moved to your account the first time you sign in.

The entity count represents endpoint resources, not every OpenAPI schema. The last complete Rocketlane root crawl on 2026-09-24 grouped **259 schema models into 14 resources** and retained **79 unique endpoints**. Existing saved maps are normalized when opened. Discovery now prefers published OpenAPI definitions and API catalogs, then follows `llms.txt` and Markdown reference pages when a full definition is unavailable. The **Sources** view compares indexed reference pages with fetched and parsed pages and identifies gaps. A root URL cannot guarantee a complete inventory if its publisher omits or blocks documentation.

Every project opens at **step 1** of an entity-by-entity walkthrough on the left of the visualization. Step numbers match the numbered entities in the graph. Use **Next**, **Back**, search, or the scrollable list to visit every discovered entity, including the last one. Each step shows that entity and its directly connected context. **View full map** shows the broader map; **Resume** returns to the current step. Drag an entity to reposition it; double-click it to open its details in the sidebar. The walkthrough's **Entity details** button opens the current entity directly. These interactions work in 2D, 3D, and full screen.

Use **Backtrack prerequisites** from an entity's details, the walkthrough, or the graph toolbar to see only the upstream entities and links that lead to the selected target. The left panel groups branches by distance from the target and names the ID field on each connection. Click a card for its details or **Trace from here** to follow one branch farther upstream. The curated Chargebee test fixture includes the conditional Item family → Item → Item price → Subscription catalog chain and a separate Customer → Subscription input; Product Families must be enabled for the item-family creation step to apply.

The full map starts with **Key connections** so every resource remains readable. Choose **Every connection** for all extracted links. Expanding an endpoint in the **Endpoints** tab offers **View resource dependency flow**, which opens the corresponding resource's backtrack graph.

Try the Chargebee documentation landing page at <https://apidocs.chargebee.com/docs/api/getting-started>, the Rocketlane ReadMe root at <https://developer.rocketlane.com/>, or a direct public OpenAPI specification. Adding up to three related source URLs enables cross-API candidate mapping. A documentation landing page may need more fetches than a direct spec URL.

## Check the project

```bash
npm test            # unit tests
npm run test:jobs    # durable job lifecycle and account isolation tests
npm run test:e2e    # browser tests (Playwright); signed-in tests need E2E_CLERK_USER_EMAIL
npm run typecheck
npm run typecheck:convex
npm run lint
npm run build
npm start
```

The app uses the Next.js App Router. Analysis jobs and progress live in Convex, and a scheduled Convex Node action runs each analysis. The action saves completed results to Convex file storage before reporting success. Jobs survive browser and web-server restarts; a stalled action is retried after its lease expires. JSON and Markdown exports are available from the workspace. See the [staging testing guide](docs/testing.md) for manual and automated checks, [staging operations](docs/staging.md) for the configured deployment, and [production deployment](docs/production.md) for limits, monitoring, and launch checks.

## Scenarios

The **Scenarios** tab answers "how do I create or change this entity?" one endpoint at a time. Pick an entity (for example Subscription) to see its endpoints grouped as **Create or import**, **Change an existing record**, **Other endpoints that use it**, and **Previews**. Each scenario shows:

- **Build order**  -  every record that must exist first, ending with the call itself. Click a step to see why it is needed (which ID field requires it and the rules that mention it), how to create it (endpoint, IDs from earlier steps, values you provide), and the cases at that step.
- **Cases**  -  type fields and conditions that change the logic, such as Item type `plan` / `addon` / `charge`. Selecting one filters the rules and highlights its fields.
- **Rules**  -  sentences extracted from the specification and associated with each case.
- **Request / Response**  -  the smallest valid payload (linked IDs as placeholders, one option per "choose one" group) and fields grouped as Required, Choose one, Conditional, and Optional.

## Projects, flows, and sharing

- **Projects** are your saved analyses (sidebar and home). Chargebee and Rocketlane are only example templates; every project, including them, goes through the same generic code. Links look like `/?analysis=<id>&tab=scenarios`, so reload and back restore the view. A project built by an older extractor shows **Update available**; **Rerun** refreshes it and **What changed** lists added/removed entities, endpoints, request fields, and links.
- **Flows** (top of Scenarios) chain endpoints into one integration plan: each step's linked IDs are bound to an earlier step's response (`customer_id ← step 1 customer.id`), and **Add missing steps** inserts the create calls a flow still needs. Flows export to Markdown.
- **Compare with your payload** maps a pasted payload (e.g. from CRM Dynamics) to the endpoint's fields by name, known synonyms, and word overlap; shows missing required fields, values that need a transform, and unused fields; and builds the resulting request. Mappings can be overridden and are saved.
- **Try it** sends the scenario's request to the real API with credentials you enter (never stored). Only public hosts are reachable, redirects are not followed, and responses are capped at 256 KB. Use a test or sandbox account.
- **Link reviews**: confirm or reject inferred links in the link details. Confirmed links count as documented; rejected links leave the map, chains, scenarios, and flows (restore them from ID lineage → Rejected by you).
- **Share** creates a read-only link for signed-in APIPassage users that always shows your latest run; revoke it any time.
- **Export**: each scenario downloads as Markdown with a Mermaid logic-flow diagram.
- Light, dark, or system theme (sidebar). `src/theme-dark.css` is generated from `styles.css` by `pnpm theme` (runs before `dev` and `build`).

## Reading the map

- **Documented** links come from explicit schema references, links, or supporting field descriptions.
- **Inferred** links are candidates based on ID names or possible producer/consumer endpoint matches. Verify them in source documentation before using them in an integration.
- The **Sources** view states fetch limits, pages and specifications read, warnings, and unresolved coverage. APIPassage cannot prove completeness beyond the sources it processed.
- The graph initially shows a manageable slice. The numbered entity guide defaults to **Prerequisites first**; switch to **Most connected** or **A–Z** if that better fits your task. Search, filters, and **Show 30 more** expose larger maps. The full-screen control works in 2D and 3D; 3D is an exploratory view of the same analysis.

## Specification adapters

APIPassage detects formats from document content, not just file names or documentation hostnames. The crawler starts with published API catalogs, common specification URLs, `llms.txt`, and links in documentation pages. Each adapter converts its format to a common operation and schema model before resource grouping. This is structural parsing of published API definitions.

| Format | Current extraction | Important limit |
| --- | --- | --- |
| [OpenAPI 3.x](https://swagger.io/specification/), Swagger 2.0 | HTTP paths, methods, parameters, request and response schemas, security, links; OpenAPI webhooks are retained. | External `$ref` files are reported but not resolved. |
| [Postman Collection 2.x JSON](https://learning.postman.com/docs/use/use-collections/collections-schemas) | Nested request folders, HTTP methods, paths, query/path parameters, JSON request and saved response examples. | Collection 3.0 is a multi-file YAML directory and is not yet imported from a root URL. Variables and scripts are not executed. |
| [RAML 1.0](https://raml.org/) | Inline resource paths, HTTP methods, URI/query parameters and response status codes. | `!include`, libraries, traits, and resource types are not expanded. |
| [API Blueprint 1A](https://apiblueprint.org/documentation/specification.html) | Resource groups, paths, actions, and response status codes. | MSON attributes and payload examples are not expanded into full schemas. |
| [GraphQL SDL or introspection JSON](https://spec.graphql.org/October2021/) | Root query, mutation and subscription fields, arguments and object/input types. | No live introspection POST is sent to a GraphQL server; paste a public SDL or introspection JSON URL. |
| [AsyncAPI 2.x and 3.x](https://www.asyncapi.com/docs/reference/specification/v3.0.0) | Channels, publish/subscribe or send/receive operations and message payload schemas. | These are message flows, not HTTP endpoints. Bindings and external references are not expanded. |
| [OpenRPC JSON](https://spec.open-rpc.org/) | JSON-RPC methods, parameters, results, and local component schemas. | Runtime service discovery is not invoked. |
| [Protocol Buffers `.proto`](https://protobuf.dev/reference/protobuf/proto3-spec/) | Message fields and service RPC methods in a single file. | Imports and custom options are not resolved. |
| [WSDL 1.1/2.0 XML](https://www.w3.org/TR/wsdl) | Port/interface operation inventory. | XSD imports, bindings and SOAP payload fields are not expanded. |
| [Smithy JSON AST](https://smithy.io/2.0/spec/index.html) | Shapes and operations, including HTTP method/URI traits when present. | Smithy IDL must first be compiled to JSON AST; external model files are not resolved. |

For a public ReadMe root or custom domain, APIPassage first looks for a published API catalog or full OpenAPI definition, then follows `llms.txt` and Markdown reference pages, combining endpoint fragments. Generic prose pages are listed as read sources but are not interpreted into entities or rules. Multiple related public URLs retain provenance and show cross-API naming matches as unverified candidates.

The adapter only **reads** published documents; it does not call documented business endpoints. An operation count is an inventory of parsed declarations, not proof that requests work. A root URL cannot guarantee a complete inventory when a publisher hides, splits, or rate-limits its specification. Review the Sources view for fetch and format limits.

## Contributing

Issues and pull requests are welcome. Run the checks in [Check the project](#check-the-project) before submitting a change. Please keep secrets and local environment files out of commits.

## License

MIT. See [LICENSE](./LICENSE).
