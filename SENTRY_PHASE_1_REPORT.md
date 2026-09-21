# NHL Edge — Sentry Phase 1 Report

Date: 2026-09-21

## 1. Executive verdict

Minimal, optional, privacy-conscious Sentry error monitoring is implemented for
the React client, Express server, and unexpected one-shot cron failures.

The implementation preserves the existing HTTP responses, authentication,
user-level isolation, betting/model behavior, demo sandbox, scheduling, and
database schemas. Sentry is a no-op when its DSN is absent. Error Monitoring is
the only enabled Sentry capability; tracing, Session Replay, logs, metrics,
profiling, and user feedback are not enabled.

Application validation is green. The only incomplete validation is the Docker
image rebuild: Docker Desktop was started, but its local engine never became
API-responsive. The production dependency install was checked separately with
`npm ci --omit=dev --dry-run`, but that is not a substitute for a successful
image build.

## 2. Existing architecture discovered

### Client

- Vite entrypoint: `client/src/main.jsx`.
- React root: React 19 `createRoot`, rendering `AuthProvider` and `App` under
  `StrictMode`.
- Before this phase there was no React error boundary, root error hook, or
  browser-global error integration.
- Vite 8.1.3 used `client/vite.config.js`, with only the React plugin and the
  development `/api` proxy.
- Browser-visible configuration already used `VITE_*` environment variables.
- The client is built/deployed separately from the root server Docker image;
  repository deployment documentation identifies Vercel as the current client
  path.
- Production source maps were disabled before this phase.

### Server

- CommonJS Node 24 application with Express 5.2.1.
- `server/index.js` validates auth/demo configuration, connects MongoDB, then
  starts the HTTP listener.
- `server/app.js` owns middleware and route order. The existing final Express
  middleware logs an error and preserves a stable JSON response contract.
- Controllers generally catch rejected work and call `next(error)`. Express 5
  also handles rejected async handlers.
- Expected validation, authentication, authorization, rate-limit, and not-found
  behavior is represented as 4xx responses. Unexpected errors default to 500.
- `/api` and `/api/health` are success-only health/readiness endpoints.
- There were no application-owned `uncaughtException` or
  `unhandledRejection` handlers. The Sentry Node SDK now supplies its standard
  fatal-process integrations only when Sentry is enabled.
- SIGTERM/SIGINT shutdown closes HTTP and MongoDB. Shutdown failures set a
  failing process exit code.

### Cron

- Railway's odds job runs `server/scripts/runOddsCaptureCron.js` via
  `npm run cron:odds-capture` from the same server Docker image.
- `server/scripts/runDemoCleanup.js` is a second one-shot cleanup entrypoint.
- Both reuse server database/services, disconnect MongoDB in `finally`, and set
  `process.exitCode = 1` after a top-level failure.
- Expected partial/retryable job conditions remain inside the existing service
  result and logging behavior. Only an error escaping the one-shot entrypoint is
  captured by the new monitoring layer.

### Current logging and upstream behavior

- Server logging is primarily intentional `console.log`/`console.error` output.
- NHL provider 429 responses use bounded retry handling and can use stale cache.
- Several provider failures are deliberately converted into section-level
  unavailable/rate-limited states rather than thrown as application failures.
- Those handled conditions were not changed into Sentry events.

### Build, release, and dependencies

- No repository code previously referenced a Git SHA, Railway release variable,
  Sentry release, or source-map uploader.
- GitHub Actions uses Node 24 and separately validates server, client, five
  Chromium smoke tests, and the root Dockerfile.
- The Dockerfile installs `server/package-lock.json` with
  `npm ci --omit=dev`; client dependencies are not included in that image.
- Installed and locked Sentry versions:
  - `@sentry/react` 10.75.1
  - `@sentry/node` 10.75.1
  - `@sentry/vite-plugin` 5.4.0

## 3. Exact files added or changed

### Added

- `client/sentryBuildConfig.js`
- `client/src/components/AppErrorFallback.jsx`
- `client/src/instrument.js`
- `client/src/monitoring/sentry.js`
- `client/src/tests/sentryMonitoring.test.mjs`
- `server/instrument.js`
- `server/monitoring/sentry.js`
- `server/scripts/verifySentry.js`
- `server/tests/sentryMonitoring.test.js`
- `SENTRY_PHASE_1_REPORT.md`

### Changed

- `client/.env.example`
- `client/package.json`
- `client/package-lock.json`
- `client/src/main.jsx`
- `client/vite.config.js`
- `server/.env.example`
- `server/app.js`
- `server/index.js`
- `server/package.json`
- `server/package-lock.json`
- `server/scripts/runDemoCleanup.js`
- `server/scripts/runOddsCaptureCron.js`

## 4. Client integration

- `client/src/instrument.js` runs before the React tree is mounted.
- Initialization reads `VITE_SENTRY_DSN`; an empty/missing value skips
  `Sentry.init` entirely.
- Environment defaults to Vite's mode and can be overridden with
  `VITE_SENTRY_ENVIRONMENT`.
- Release is read only from the build-injected `VITE_SENTRY_RELEASE`. Vite
  resolves that value once from the explicit client override, the build-only
  explicit release, or Vercel's immutable Git commit SHA.
- React 19 root hooks capture uncaught and recoverable React errors only when
  the SDK is enabled.
- `Sentry.ErrorBoundary` wraps the existing tree and displays a small existing-
  theme fallback without technical Sentry details.
- Global browser errors remain covered by the SDK's error integrations.
- No account/user identity or account-type tag is added. Account type was not
  materially useful enough to justify extra event context in this phase.

## 5. Server integration

- `server/instrument.js` loads environment configuration and initializes Sentry
  before Express and other application modules are required.
- Initialization reads `SENTRY_DSN`; an empty/missing value leaves the process
  uninstrumented.
- The official Express integration is configured for Express 5 and its error
  middleware is inserted after routes but immediately before NHL Edge's existing
  centralized error middleware.
- The capture predicate reports errors with no resolvable status or a status of
  500 and above. Resolvable 3xx/4xx errors are not captured.
- Existing logging, status codes, response bodies, and error details behavior are
  unchanged.
- Startup and shutdown failures get a bounded flush opportunity before exit or
  exit-code completion. Monitoring transport failure cannot replace or suppress
  the original process failure.

## 6. Cron integration and decision

Both one-shot cron entrypoints load the same server instrumentation before their
runtime modules. An unexpected top-level rejection is captured and given up to
2,000 ms to flush. The timeout is bounded, creates no worker or polling loop, and
does not alter job scheduling or successful completion. Normal success and
existing handled/partial outcomes are not reported as errors.

## 7. Privacy and data scrubbing

Both SDKs use `sendDefaultPii: false` and `enableLogs: false`.

Immediately before transport, a small deterministic hook removes these event
fields entirely:

- `request` (therefore URL/request headers, Authorization, cookies, query data,
  and body data)
- `user`
- `breadcrumbs`
- `extra`
- `contexts`
- custom `tags`

The client disables default breadcrumb, browser-session, HTTP-context, culture,
and conversation-context integrations. The server disables request-data, local-
variable, console, HTTP/fetch breadcrumb, child-process, process-session, and
conversation-context integrations. No MongoDB document, game/model context,
bet, bankroll/stake, injury note, auth session, Google identity, demo identity,
or request body is attached by NHL Edge.

Exception type, message, and stack are retained because they are the diagnostic
purpose of Error Monitoring. As with any error monitor, an exception authored
elsewhere could itself embed a runtime value in its message. Server-side Sentry
scrubbing rules remain recommended as defense in depth.

## 8. Environment and release handling

Server runtime:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT` (falls back to `NODE_ENV`)
- `SENTRY_RELEASE`

Client build/runtime bundle:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT` (falls back to Vite mode)
- `VITE_SENTRY_RELEASE`

Client release precedence is exactly:

1. non-empty `VITE_SENTRY_RELEASE`
2. non-empty `SENTRY_RELEASE`
3. non-empty `VERCEL_GIT_COMMIT_SHA`
4. no release

Whitespace-only values are treated as absent. Vite injects only the resolved
release as `import.meta.env.VITE_SENTRY_RELEASE`; the browser SDK and source-map
upload plugin therefore use the exact same value. No release identifier is
invented. The server remains explicitly configured with `SENTRY_RELEASE`; the
repository does not reference a Railway-provided Git/release variable.

## 9. Source-map strategy

Ordinary builds remain credential-free and keep `build.sourcemap` disabled. The
verified ordinary production build emitted zero `.map` files.

The Vite upload plugin is enabled only when all of the following build values
are non-empty:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- a release resolved from `VITE_SENTRY_RELEASE`, `SENTRY_RELEASE`, or
  `VERCEL_GIT_COMMIT_SHA`, in that order

When enabled, Vite creates hidden source maps, uploads the artifacts with the
matching release, then deletes `dist/**/*.map`. The plugin's own telemetry is
disabled. `SENTRY_URL` may override the endpoint; otherwise the configuration
uses `https://de.sentry.io/` for the organization's DE region.

The auth token is build-only and is never exposed through a `VITE_*` variable or
included intentionally in the client bundle.

## 10. External Sentry, Railway, Vercel, and GitHub configuration

No variables or secrets were modified by this task.

The following Railway configuration was reported as complete before the final
commit:

- `SENTRY_DSN`: DSN for the `nhl-edge-server` project
- `SENTRY_ENVIRONMENT=production` (or the exact desired environment name)
- `SENTRY_RELEASE`: immutable deployed Git commit identifier

This configuration is present on both the `nhl-edge` web service and the
`odds-capture-cron` service.

The following Vercel Production configuration was reported as complete before
the final commit:

- `VITE_SENTRY_DSN`: DSN for the `nhl-edge-client` project
- `VITE_SENTRY_ENVIRONMENT=production`
- `SENTRY_AUTH_TOKEN`: secret build token with source-map/release upload access
- `SENTRY_ORG`: organization slug
- `SENTRY_PROJECT`: client project slug
- `VERCEL_GIT_COMMIT_SHA`: automatic immutable fallback supplied by Vercel
  System Environment Variables; those variables are enabled, so no manual
  per-deployment client release value is required

Optional overrides remain supported:

- `VITE_SENTRY_RELEASE`: highest-precedence explicit client release
- `SENTRY_RELEASE`: second-precedence build-only client release
- `SENTRY_URL=https://de.sentry.io/`: optional because this is already the
  configured default

Never prefix `SENTRY_AUTH_TOKEN` with `VITE_`. If GitHub Actions remains only PR
validation, it needs no Sentry secret and performs no upload. If a future
production artifact build is moved to GitHub Actions, add the build-only values
there as protected secrets/variables in a separately reviewed deployment phase.

## 11. Controlled verification procedure

After configuring variables and deploying one release:

1. Confirm both Sentry projects show the intended environment and the same
   release.
2. Client: open the deployed application, then run this explicitly in browser
   DevTools:

   ```js
   setTimeout(() => {
     throw new Error('NHL Edge controlled client Sentry verification')
   }, 0)
   ```

3. Confirm the event arrives only in `nhl-edge-client` and resolves to an
   original `client/src` location after source-map upload.
4. Server: from an explicitly configured one-off Railway/local shell in
   `server/`, run `npm run verify:sentry`. This sends one controlled exception,
   waits at most two seconds to flush, and does not expose a route or affect the
   running web process.
5. Confirm the event arrives only in `nhl-edge-server` with the expected
   environment/release and a useful original server stack.
6. Inspect raw event data for both events. Confirm there is no user object,
   request object, Authorization/cookie/body data, breadcrumb trail, app
   context, bankroll/stake/bet/injury data, or demo identity.
7. Remove no code afterward: the server verifier is an explicit operator script,
   and the client verification uses DevTools. There is no crash route or button.

Do not run either live verification against real production credentials until
the variables are deliberately configured and one test event per project is
acceptable.

## 12. Tests added

Client focused tests verify:

- no initialization without `VITE_SENTRY_DSN`
- explicit release precedence and the Vercel commit fallback
- error-only/default-integration filtering
- explicit environment and release metadata
- absence of tracing/Replay configuration
- structural removal of sensitive event fields while retaining exception data

Server focused tests verify:

- no initialization without `SENTRY_DSN`
- Express 5xx capture and 4xx exclusion
- default-integration filtering, including request data and local variables
- structural event scrubbing
- bounded cron flush behavior
- monitoring transport failure isolation
- cron entrypoint failure handling without logging the error message

## 13. Exact validation results

- Server full suite: **918/918 passed**.
- Server Sentry-focused suite after the final monitoring change: **7/7 passed**.
- Server syntax/lint check: **251 JavaScript files passed**.
- Client full suite: **472/472 passed**.
- Client Sentry-focused suite: **6/6 passed**, including explicit precedence,
  Vercel fallback, blank-value handling, and no-release behavior.
- Client ESLint: **passed**.
- Client production build without Sentry credentials: **passed**.
- Vercel fallback build check: **passed**. With only a test
  `VERCEL_GIT_COMMIT_SHA`, the resolved release appeared in one browser bundle;
  the following ordinary build contained no fallback marker.
- Browser bundle build-secret check: **no `SENTRY_AUTH_TOKEN` name present**.
- Ordinary client build source maps: **0 emitted**.
- Controlled server verifier without a DSN: **failed closed as designed; no
  event sent**.
- Playwright Chromium critical smoke suite: **5/5 passed**.
- `git diff --check`: **passed**.
- Diff credential-literal scan: **no auth token, bearer token, or DSN literal
  found**.
- Server production install lockfile dry run (`npm ci --omit=dev --dry-run`):
  **passed**.
- Docker production image rebuild: **not completed**. First attempt was blocked
  by Docker config sandbox access; the approved retry showed the daemon stopped.
  Docker Desktop was started, but both engine checks and the build remained
  unresponsive and were stopped after bounded waits.

Non-failing existing warnings remained: Vite reports the existing large client
chunk, and Playwright surfaces Mongoose's existing `new` option deprecation.
`npm install` also reported the repository's current audit totals (server: one
moderate and one high; client: one moderate and four high); no automatic audit
fix was run.

## 14. Docker impact

The Dockerfile itself is unchanged. `@sentry/node` is a new production
dependency, so both Railway web and cron images will include the SDK and its
runtime dependencies through the existing `npm ci --omit=dev` layer. Client SDK
and Vite-plugin packages are not copied into the server image.

The lockfile dry run confirms the production dependency graph resolves, but an
actual image build still needs to be run on a responsive Docker host or by the
existing GitHub Actions Docker job.

## 15. Production side effects

With no DSN, neither client nor server initializes a Sentry client or sends
network events. The React error boundary still provides a safe fallback for a
render failure. The client SDK is part of the static bundle because the DSN is a
build-time setting.

With DSNs configured:

- unexpected browser/React errors are eligible for client capture;
- server errors without a status or with status 500+ are eligible for capture;
- expected 4xx and health-check success behavior do not create Sentry issues;
- unexpected startup, shutdown, and top-level cron failures get a bounded flush;
- HTTP responses and cron scheduling semantics remain unchanged.

## 16. Known limitations

- No live event was sent, so project routing, retention, server-side scrubbing,
  and rendered stack frames have not been observed in the Sentry UI.
- Source-map upload and post-upload deletion were not executed because upload
  credentials were absent.
- The local Docker engine was unavailable, so the production image must still
  be rebuilt in CI or on a working Docker host.
- Exception messages/stacks are deliberately retained and can only be as clean
  as the exceptions produced by application/dependency code. Configure Sentry
  organization/project data-scrubbing rules as defense in depth.
- A client DSN/release change requires rebuilding the Vite bundle; it is not a
  server-runtime switch.
- `VERCEL_GIT_COMMIT_SHA` is available only when Vercel System Environment
  Variables are enabled; otherwise the fallback resolves to no release.

## 17. Recommended next step

Configure the two project DSNs and explicit environment. Keep the server's
immutable `SENTRY_RELEASE` aligned with Vercel's Git commit SHA by deployment
configuration; the client now uses `VERCEL_GIT_COMMIT_SHA` automatically unless
an explicit client/build release overrides it. Configure the DE-region client
source-map uploader only in the production client build environment, then run
the controlled one-event-per-project verification and inspect raw payloads.
Require the existing CI Docker job (or a local successful build) to pass before
deployment.

## Explicit activity statement

At the time implementation validation was completed, before the final
user-requested commit and push:

- Production data touched: **No**.
- Sentry event actually sent: **No**.
- Sentry credentials present locally: **No**.
- Source maps uploaded: **No**.
- Commit created: **No**.
- Push performed: **No**.
- Deployment performed: **No**.
- Railway, Vercel, GitHub, or Sentry secrets modified: **No**.
