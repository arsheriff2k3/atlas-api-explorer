# APIPassage production deployment

APIPassage uses a Next.js web app, Clerk for sign-in, and Convex for data, saved files, and analysis execution. Staging serves the web app on Cloudflare Workers using vinext. Each analysis request creates a durable Convex job and schedules a [Node action](https://docs.convex.dev/functions/runtimes). The action crawls and parses the source, writes the compressed result to Convex file storage, and marks the job complete. Try It requests use a separate short Convex Node action so their DNS check and outbound connection stay in the same runtime. No separate worker VM, Cloudflare Queue, or worker admin key is required.

## Provision

1. Create separate Clerk development and production instances. Enable the Convex integration in each.
2. Create separate Convex staging and production deployments. Set `CLERK_JWT_ISSUER_DOMAIN` on each deployment to its matching Clerk Frontend API URL. Deploy the schema and functions with `pnpm exec convex deploy` using that deployment's `CONVEX_DEPLOY_KEY`.
3. Deploy the web app with `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, and `NEXT_PUBLIC_CLERK_SIGN_UP_URL`. Use production Clerk keys and Convex URLs in production.
4. Configure Convex usage limits and alerts. The [Free plan](https://www.convex.dev/pricing) has a fixed monthly action compute allowance; exceeding it can stop work. Keep staging and production projects separate.

Only the web app needs `CLERK_SECRET_KEY`. Never expose it through a `NEXT_PUBLIC_*` variable. The Convex site URL is used for authenticated, size-limited browser uploads.

The GitHub Actions code job needs `CI_CONVEX_URL`, `CI_CLERK_PUBLISHABLE_KEY`, and `CI_CLERK_SECRET_KEY` repository secrets for its production build. The manually triggered browser job also needs `E2E_CLERK_USER_EMAIL` and `E2E_CLERK_USER_2_EMAIL` from the staging Clerk instance. The test creates a saved project if the first account has none. Deploy the Convex functions before that job runs.

## Limits and recovery

- Each user may have two queued or running analyses and start 20 analyses per UTC day.
- Each user may send 100 Try It requests per UTC day, one at a time. Try It requires HTTPS.
- Each user may normalize 30 saved maps and upload 40 browser saved maps per UTC day. Browser uploads pass through a size-limited, authenticated endpoint.
- Each user may save 25 projects using up to 100 MB of compressed analysis storage. A single compressed analysis is limited to 18 MB. Each project may have 100 flows and 20 active share links.
- [Convex Node actions](https://docs.convex.dev/functions/actions) have a 10-minute timeout and 512 MB memory limit. APIPassage aborts analysis at nine minutes so it can record a failure before the platform timeout. A job lease is renewed every five seconds. A cron schedules a retry for a stalled action after its 12-minute lease expires; each job is attempted at most three times.
- The action writes the result to Convex storage and updates the project row before marking the job complete. Uploaded files left behind by failed saves are cleaned daily. Completed job records and old usage rows are cleaned daily.

Deploy additive Convex schema changes before updating the web app. To roll back, restore the previous web build and Convex functions. Check available Convex backups or exports and test a restore in staging before launch. A rollback that changes the data model needs a tested migration plan.

## Monitoring

`GET /api/health` returns HTTP 200 when Convex responds. It does not prove that analysis actions can finish. Alert on HTTP 503 for more than two minutes. Monitor Convex action logs for `job_error` and `job_heartbeat_error`, plus queued job age, failed jobs, action duration, memory, storage use, and quota rejections. Set action compute and storage usage limits in Convex.

## Release gate

Run `pnpm test`, `pnpm test:jobs`, `pnpm typecheck`, `pnpm typecheck:convex`, `pnpm lint`, and `pnpm build`. In staging, configure Clerk test users and run `E2E_REQUIRE_AUTH=1 pnpm test:e2e`. Also verify: two users cannot read each other's jobs or projects; cancelling an action stops its crawl; a browser reload resumes progress; a stalled action is retried; a completed project opens from another browser; and quota and storage limits return clear errors. Run a large API specification through staging and check that it stays below 512 MB and nine minutes.

The repository cannot prove production readiness until real Clerk and Convex production environments, monitoring, backups, and the staging checks are configured and pass.
