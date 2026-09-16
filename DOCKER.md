# NHL Edge backend container

## Scope and current deployment status

The repository has one backend-only production image. It contains `server/`
and the runtime modules in `shared/`; it does not contain the Vite client,
MongoDB, or any external service.

The root `Dockerfile` predates this document and is already the documented
Railway build source for both the API and cron services. Railway automatically
detects a file named `Dockerfile` at the source root. Consequently, this file
must not be renamed, removed, or materially changed as an allegedly dormant
Docker experiment: doing so can change a later Railway deployment. Phase 0-1
does not change the Dockerfile, Railway settings, start commands, cron schedule,
domains, networking, or environment variables, and it does not deploy.

## Image design

- Build context: repository root. The server imports `../shared`, so
  `server/` alone is not a complete build context.
- Dockerfile: `Dockerfile` at the repository root.
- Runtime: `node:24-alpine`. Node 24 is the only project-level Node major
  currently declared, through the existing Dockerfile. The server has no
  native production dependency requiring a Debian runtime; `bcryptjs` is the
  JavaScript implementation, and the lockfile's install-script dependency is
  the optional development-only `fsevents` package.
- Dependencies: the lockfile is installed with `npm ci --omit=dev` in a
  separate dependency stage. Host `node_modules` is ignored.
- Runtime user: the official image's unprivileged `node` user.
- Working directory: `/app/server`, matching the package scripts and preserving
  the server's `../shared` imports.
- Default web command: `node index.js` (equivalent to `npm start`).
- Cron override: `npm run cron:odds-capture`, which runs
  `node scripts/runOddsCaptureCron.js` once and disconnects MongoDB before the
  process exits.
- Port: the server binds `0.0.0.0` and reads `PORT` at runtime, defaulting to
  `5000`. Docker port publication does not change that value.
- Persistence: MongoDB Atlas remains external. The application has no required
  runtime write to the container filesystem and needs no host mount or Docker
  volume.

No Docker Compose file is needed. The frontend remains on its existing Vite /
Vercel path and is not part of this image.

## Build

From the repository root in PowerShell:

```powershell
docker --version
docker build --file .\Dockerfile --tag nhl-edge-server:phase-0-1 .
docker image inspect nhl-edge-server:phase-0-1 --format '{{.Size}}'
```

The build does not need application secrets. The image receives configuration
only when a container starts.

## Safe web verification

The health endpoint can be tested without MongoDB or provider credentials.
`GOOGLE_CLIENT_ID` below is a non-secret placeholder needed because the image
sets `NODE_ENV=production`. The health response should report that the database
is not configured.

```powershell
docker run --detach --name nhl-edge-server-test --publish 5000:5000 --env PORT=5000 --env GOOGLE_CLIENT_ID=local-docker-verification.invalid nhl-edge-server:phase-0-1
docker logs nhl-edge-server-test
Invoke-RestMethod http://localhost:5000/api/health
docker inspect nhl-edge-server-test --format '{{.Config.User}}'
docker stop --timeout 10 nhl-edge-server-test
docker rm nhl-edge-server-test
```

The expected runtime user is `node`. A normal stop should complete inside the
ten-second grace period. The server handles `SIGTERM` and `SIGINT`, stops
accepting HTTP traffic, closes the HTTP listener, and disconnects Mongoose.

To prove runtime configuration is not baked into the image, start the same
image on a different application and host port without rebuilding it:

```powershell
docker run --detach --name nhl-edge-server-port-test --publish 5080:5080 --env PORT=5080 --env GOOGLE_CLIENT_ID=local-docker-verification.invalid nhl-edge-server:phase-0-1
Invoke-RestMethod http://localhost:5080/api/health
docker stop --timeout 10 nhl-edge-server-port-test
docker rm nhl-edge-server-port-test
```

For an integration test that requires MongoDB or Google configuration, put
local/test values in an ignored file such as `.env.docker.local`, then use:

```powershell
docker run --detach --name nhl-edge-server-test --publish 5000:5000 --env-file .\.env.docker.local nhl-edge-server:phase-0-1
```

Do not use production credentials for local verification. Do not commit the
environment file.

## Secret and filesystem checks

These checks confirm the configured user and that no real `.env` file or host
`node_modules` was copied. The tracked `.env.example` may remain as
documentation and contains no values.

```powershell
docker run --rm --entrypoint sh nhl-edge-server:phase-0-1 -c 'id && test ! -f /app/server/.env && echo no-runtime-env-file'
docker run --rm --entrypoint sh nhl-edge-server:phase-0-1 -c 'find /app -type f -name ".env*" ! -name ".env.example" -print'
docker history --no-trunc nhl-edge-server:phase-0-1
```

The second command must print nothing. Review image history only for Dockerfile
instructions and paths; no secret value should appear. Production operation
requires no privileged mode, Docker socket, host filesystem mount, or volume.

## Safe cron verification

Do not manually run the real cron command with production or paid-provider
credentials. First confirm that the command resolves and fails closed before a
database connection when required configuration is absent:

```powershell
docker run --rm nhl-edge-server:phase-0-1 npm run cron:odds-capture
```

That command is expected to exit nonzero before connecting because
`MONGODB_URI` is absent; the current top-level log reports the error type rather
than its detailed message. It must not contact MongoDB, NHL services, or The
Odds API. Then exercise the same cron module with its injected mocks inside the
image:

```powershell
docker run --rm nhl-edge-server:phase-0-1 node --test tests/forwardPredictionInputs.test.js tests/scheduledOddsCapture.test.js
```

Those tests provide fake database, prediction, cleanup, and odds services.
They verify one-shot execution, independent jobs, required configuration,
database close, error propagation, and natural process exit without writing
data or consuming API quota.

## Runtime environment inventory

All values are supplied at runtime; none is embedded in the Dockerfile.

| Variable | Scope | Requirement |
| --- | --- | --- |
| `NODE_ENV` | shared | Set to `production` by the image |
| `PORT` | web | Optional; defaults to `5000` |
| `MONGODB_URI` | web and cron | Needed for persistent web features; required by cron |
| `GOOGLE_CLIENT_ID` | web | Required when `NODE_ENV=production` |
| `CLIENT_ORIGIN` | web | Recommended; production frontend origin has a code fallback |
| `CLIENT_URL` | web | Optional legacy fallback for `CLIENT_ORIGIN` |
| `LOCAL_AUTH_ENABLED` | web | Optional; defaults to `false` |
| `SESSION_COOKIE_NAME` | web | Optional; has a safe default |
| `SESSION_TTL_MS` | web | Optional; defaults to 30 days |
| `SESSION_COOKIE_SAME_SITE` | web | Optional; defaults to `none` in production |
| `SESSION_COOKIE_SECURE` | web | Optional; defaults to `true` in production |
| `AUTH_RATE_LIMIT` | web | Optional |
| `AUTH_RATE_WINDOW_MS` | web | Optional |
| `DEMO_AUTH_RATE_LIMIT` | web | Optional |
| `DEMO_AUTH_RATE_WINDOW_MS` | web | Optional |
| `DEMO_SANDBOX_TTL_HOURS` | web | Optional; defaults to `4` |
| `DEMO_CLEANUP_BATCH_SIZE` | web and cron | Optional; defaults to `100` |
| `THE_ODDS_API_KEY` | web and cron | Optional for basic web startup; enables paid odds capture |
| `THE_ODDS_API_BASE_URL` | web and cron | Optional |
| `MARKET_ODDS_CACHE_TTL_MS` | web and cron | Optional |
| `MARKET_ODDS_LOW_CREDIT_THRESHOLD` | web and cron | Optional |
| `MARKET_ODDS_MIN_REFRESH_INTERVAL_MS` | web and cron | Optional |
| `MARKET_ODDS_REQUEST_TIMEOUT_MS` | web and cron | Optional |
| `MONGODB_STORAGE_LIMIT_BYTES` | web | Optional |
| `MONGODB_STORAGE_CACHE_TTL_MS` | web | Optional |
| `JSON_BODY_LIMIT` | web | Optional; defaults to `1mb` |
| `NHL_EDGE_API_DEBUG` | web and cron | Optional diagnostic flag |
| `NHL_EDGE_CONTEXT_DEBUG` | web and cron | Optional diagnostic flag |
| `NHL_EDGE_CALIBRATION_DEBUG` | web | Optional diagnostic flag |

The client-only variables `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`, and
`VITE_LOCAL_AUTH_ENABLED` are build inputs for the separately deployed client
and are not used by this backend image. Legacy local `JWT_SECRET` and
`JWT_EXPIRES_IN` values are not used by the current opaque-session server.

## Railway guardrail

The repository contains no `railway.json`, `railway.toml`, `Procfile`, or
`nixpacks.toml`. The documented Railway services use automatic root-Dockerfile
detection. This phase intentionally makes no Railway change and performs no
deployment. Any future Dockerfile, Node-major, health-check, start-command, or
cron-schedule change should be a separately reviewed deployment phase.
