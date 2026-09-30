# APIPassage staging testing guide

Test the deployed app at <https://apipassage-staging.apipassage.workers.dev>. The
staging backend is separate from the development backend, but this site currently
uses the Clerk **development** instance for sign-in. Use these two existing test
accounts:

- `rahman.b@makoitlab.com`
- `arsheriff2k3@gmail.com`

For manual sign-in, use the sign-in method configured for each Clerk account.
The email addresses alone are enough for the automated Clerk testing helper,
but may not be enough to sign in manually.

## Manual smoke test

1. Open the staging URL in a private browser window. It should send you to
   `/sign-in`. After signing in as the first account, **Your projects** should
   appear.
2. Paste this public OpenAPI specification into **API documentation URL** and
   select **Analyze API**:
   `https://raw.githubusercontent.com/chargebee/openapi/main/spec/chargebee_api_v2_pc_v2_spec.json`.
   Wait for the job to complete. It should create a saved project with a map,
   endpoints, scenarios, and a **Sources and coverage** view. Check the source
   warnings before interpreting its coverage as complete. A large source may
   take several minutes.
3. Open the project from **All projects**, switch to **Scenarios**, and reload
   the page. The same project and tab should reopen. Check **Endpoints**, the
   map, and **Sources and coverage**. Change the light/dark setting and open
   **Settings**.
4. In **Project actions**, download **Export analysis JSON** and **Export study
   notes**. Confirm both files contain the project data. Create a **Share
   project** link and open it while signed in as the second account; it should
   show a read-only project. Revoke the link and confirm it no longer opens.
5. In a separate private browser profile, sign in as the second account. The
   first account's private project should not appear in **All projects**, and
   its direct `?analysis=...` URL should not open. A valid share link is the
   intentional exception.
6. Sign out and revisit the project URL. It should require sign-in. Also check
   the health endpoint:

   ```sh
   curl -i https://apipassage-staging.apipassage.workers.dev/api/health
   ```

   Expect HTTP 200 with `"status":"ready"`. This checks web-to-Convex
   connectivity; it does not prove analysis jobs can complete.

The browser suite below sends a real public HTTPS **Try It** request. For a
manual UI check, use a public GET operation that requires no API key; avoid
sending requests to a business API with live credentials during this smoke test.

## Automated browser tests

From the repository root, install dependencies and Chromium once, then run:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
E2E_REQUIRE_AUTH=1 \
  E2E_CLERK_USER_EMAIL=rahman.b@makoitlab.com \
  E2E_CLERK_USER_2_EMAIL=arsheriff2k3@gmail.com \
  E2E_BASE_URL=https://apipassage-staging.apipassage.workers.dev \
  pnpm test:e2e
```

The local `.env.local` must contain `CLERK_SECRET_KEY` for the same Clerk
development instance as staging. Keep that key private. Both test users must
exist in that instance. `E2E_BASE_URL` points Playwright at the deployed site,
so no local web server is needed. `E2E_REQUIRE_AUTH=1` fails setup if either
test user or the secret is missing. The current suite has seven tests and should
finish with `7 passed`. It checks signed-out access, sign-in, fresh analysis
completion without a refresh, saved-project reload, settings and theme, a public HTTPS Try It call, and cross-account job
access. If the first account already has a saved project, this suite opens it
without creating a fresh analysis; step 2 above tests the full job path.

For code changes, also run:

```sh
pnpm test
pnpm test:jobs
pnpm typecheck
pnpm typecheck:convex
pnpm lint
pnpm build
```

If sign-in tests fail, check that `.env.local` uses the staging site's Clerk
development instance and that both users exist. If health returns 503, inspect
the staging Convex deployment and its logs. If an analysis fails, inspect its
job error and the Convex action logs. See [staging operations](staging.md) and
the [production release gate](production.md) for the remaining launch checks.
