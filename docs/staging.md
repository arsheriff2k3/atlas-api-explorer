# APIPassage staging

The `staging` Convex deployment is `vibrant-newt-124` at
`https://vibrant-newt-124.convex.cloud`. Its dashboard is
`https://dashboard.convex.dev/d/vibrant-newt-124`.
The Cloudflare staging Worker is `apipassage-staging` in the
`arsheriff2k3@gmail.com` account. Its public URL is
`https://apipassage-staging.apipassage.workers.dev`.

This deployment has the current schema and functions. It uses the existing Clerk
development instance (`https://boss-swift-7719.clerk.accounts.dev`) so the two
Clerk test accounts can sign in. Staging data is separate from the Convex dev
deployment, but identity configuration is shared with Clerk development. Create
a separate Clerk staging instance before treating identity isolation as tested.

The ignored local files `.env.staging.local` (web settings) and
`.env.staging.deploy.local` (Convex deploy key) are configured on this machine.
They are private files with owner-only permissions. Neither belongs in Git.
`.env.cloudflare.staging.secrets.local` contains only the Clerk server secret for
Cloudflare deployment and is also ignored. `.dev.vars` links to the staging web
settings for local Worker previews.

## Verify locally against staging

The Next.js production build reads `.env.local`; it does not automatically read
`.env.staging.local`. In a separate checkout or temporary copy, copy
`.env.staging.local` to `.env.local`, then run:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start -p 3200
```

In another terminal, check health and run the authenticated browser tests:

```sh
curl --fail http://localhost:3200/api/health
E2E_REQUIRE_AUTH=1 \
  E2E_CLERK_USER_EMAIL=rahman.b@makoitlab.com \
  E2E_CLERK_USER_2_EMAIL=arsheriff2k3@gmail.com \
  E2E_PORT=3200 pnpm test:e2e
```

The original five browser tests passed on 2026-09-29 against a production-mode
Next.js server connected to staging. After the Cloudflare configuration, all six
tests passed against the local Worker preview, including a live Try It request
through a Convex Node action. They cover sign-in, analysis and saved-project
reload, account isolation, and request security. The staging health endpoint
responded with HTTP 200, and an unauthenticated upload returned HTTP 401.
The same six tests passed against the public Cloudflare URL on 2026-09-29, and
its public `/api/health` endpoint returned HTTP 200.
After changing the analysis page to subscribe to live Convex job updates, the
expanded seven-test suite passed against the public URL on 2026-09-29. The new
test starts a fresh analysis and confirms its map opens without a page refresh.

To run the same browser suite against the public Worker:

```sh
E2E_REQUIRE_AUTH=1 \
  E2E_CLERK_USER_EMAIL=rahman.b@makoitlab.com \
  E2E_CLERK_USER_2_EMAIL=arsheriff2k3@gmail.com \
  E2E_BASE_URL=https://apipassage-staging.apipassage.workers.dev \
  pnpm test:e2e
```

## Deploy and inspect

```sh
pnpm exec convex deploy --env-file .env.staging.deploy.local
pnpm exec convex insights --deployment staging --details
pnpm exec convex deployment usage-limits list --deployment staging
```

A monthly warning at 10 GB-hours of Node action compute is configured. The
warning does not stop usage. Export a backup with file storage before risky
schema changes:

```sh
pnpm exec convex export --deployment staging --include-file-storage --path staging-backup.zip
```

The 2026-09-29 export completed and included analysis data and file storage.
A restore has not yet been tested. Check snapshots in the Convex dashboard.

Build the Cloudflare Worker with the staging web settings, then deploy the
prebuilt output. Cloudflare's `cf` CLI must be signed in and pointed at the
correct account. Keep the secret file private.

```sh
pnpm exec cf auth login
node --env-file=.env.staging.local ./node_modules/vite/bin/vite.js build
CLOUDFLARE_ACCOUNT_ID=2a388400bef6bc7101ff560170ae4dfb \
  pnpm exec cf deploy --prebuilt --secrets-file .env.cloudflare.staging.secrets.local
```

The Worker uses vinext on Cloudflare. The web Worker sends Try It requests to a
short Convex Node action so the DNS check and the outbound connection remain
pinned together. It does not run the longer analysis jobs; Convex schedules
those separately.

## Remaining staging setup

Configure an external uptime check and a separate Clerk staging instance if
full identity separation is required. The backup restore and large-spec
resource check also remain launch gates. This staging setup does not imply
production readiness.
