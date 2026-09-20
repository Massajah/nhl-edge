# NHL Edge Playwright Phase 2 Report

## 1. Executive verdict

The Phase 2 GitHub Actions integration is implementation-ready. A separate `E2E` job now runs the proven Phase 1 Chromium suite on `ubuntu-latest` without changing the tests, application startup, production code, or Docker image. Hosted execution remains unverified until the user commits and pushes the changes.

## 2. Existing CI architecture discovered

The existing `.github/workflows/ci.yml` is validation-only and runs on ordinary `push` and `pull_request` events. It has independent Server, Client, and Docker image jobs; read-only `contents` permission; workflow/ref concurrency with cancellation; Node 24; `actions/checkout@v7`; `actions/setup-node@v7`; npm lockfile caching; and 20-minute job timeouts. The jobs have no dependency chain and can run in parallel.

## 3. E2E job design

One independent job with display name `E2E` was added alongside Server, Client, and Docker image. Its run-step working directory is `client/`. It checks out the repository, configures Node and the client npm cache, runs `npm ci`, installs Chromium and its Ubuntu system dependencies, runs the existing suite, and uploads diagnostics only after a failure. It has no `needs` relationship.

## 4. GitHub runner

`ubuntu-latest`, matching the existing validation jobs.

## 5. Node version

Node 24, matching both existing npm CI jobs and the production Dockerfile strategy. No new runtime version was introduced.

## 6. npm install strategy

The job runs deterministic `npm ci` from `client/`. `actions/setup-node@v7` enables the existing npm cache convention with `client/package-lock.json` as the dependency path. A local `npm ci --dry-run --ignore-scripts` consistency check passed.

## 7. Chromium install strategy

The job runs `npx playwright install --with-deps chromium` after npm installation. This is the Playwright-supported Ubuntu CI command and installs only Chromium plus its required Linux libraries. Firefox and WebKit are not installed.

## 8. mongodb-memory-server CI strategy

The existing worker fixture remains unchanged. `mongodb-memory-server` may download its MongoDB binary at runtime, then starts a one-node ephemeral replica set on loopback for transaction-capable demo seeding. Ubuntu is a supported platform. No Atlas URI, MongoDB service container, or persistent database is configured.

## 9. Playwright command

`npm run test:e2e` runs the existing headless suite. The fixture automatically starts and stops MongoDB, Express, and Vite; CI does not start separate application services.

## 10. Worker/retry behavior

The unchanged Playwright configuration uses one worker. CI enables two retries and `forbidOnly`; local runs use no retries. The job does not add any retry wrapper.

## 11. Timeout

The E2E job has a 20-minute timeout, matching the existing jobs. This bounds browser and infrastructure downloads even though the prepared suite itself runs in approximately ten seconds.

## 12. Artifact behavior

`actions/upload-artifact@v7` runs only under `${{ failure() }}` and uploads only:

- `client/playwright-report/`
- `client/test-results/`

These paths contain the HTML report, failure screenshots, and retry traces produced by Playwright. Missing files produce a warning rather than hiding the original job failure. Successful runs upload nothing.

## 13. Artifact retention

Failure artifacts are retained for seven days under the name `playwright-e2e-failure`.

## 14. Permissions

The existing workflow-level `contents: read` permission remains unchanged and sufficient. No write, deployment, pull-request, package, or token permission was added.

## 15. Secrets required

None. The job contains no `secrets` references and requires no production MongoDB URI, Google credentials, Odds API key, Railway token, Sentry credential, user credential, cookie, or stored authentication state.

## 16. External production dependencies

**NONE.** Only infrastructure downloads from npm, Playwright's browser distribution, Ubuntu package repositories, and MongoDB's binary distribution are expected. The application does not contact deployed NHL Edge services.

## 17. Production database access

**NONE.** The Phase 1 harness overrides the Mongo URI with an exact loopback ephemeral database before loading the server and validates the host and database name.

## 18. Production API quota use

**NONE.** Provider keys are blank and tested external provider boundaries remain deterministically isolated.

## 19. Docker impact

**NONE.** The Dockerfile and `.dockerignore` were not changed. Playwright, Chromium, and `mongodb-memory-server` remain separate CI/client development concerns and are not copied into the production server image.

## 20. Existing Server job impact

None. Its name, runner, timeout, Node version, cache, install, lint, and test steps are unchanged, and it does not depend on E2E.

## 21. Existing Client job impact

None. Its name, runner, timeout, environment, cache, install, lint, test, and build steps are unchanged, and it does not depend on E2E.

## 22. Existing Docker job impact

None. It remains an independent `ubuntu-latest` production image build with the existing 20-minute timeout.

## 23. Local E2E first run

Passed 5/5 in 10.6 seconds with one worker and clean application-stack shutdown.

## 24. Local E2E second run

The immediately consecutive run passed 5/5 in 10.2 seconds with one worker and clean shutdown.

## 25. Full server test result

Passed at the established baseline: 911/911 tests.

## 26. Full client test result

Passed at the established baseline: 466/466 tests. Playwright remains a separate five-test suite.

## 27. Lint/build result

- Server lint passed: syntax validation of 247 JavaScript files.
- Client ESLint passed.
- The Vite 8.1.3 production build passed with 1,864 transformed modules.
- The existing approximately 927.61 kB chunk-size warning remains non-fatal.

## 28. Workflow files modified

- `.github/workflows/ci.yml`

## 29. Other files modified

- `PLAYWRIGHT_PHASE_2_REPORT.md` was added.

No Phase 1 E2E source, production application source, package manifest, lockfile, Docker file, Railway configuration, or prior report was changed by Phase 2. Pre-existing unrelated working-tree changes remain preserved.

## 30. Production side effects

**NONE.** Nothing was committed, pushed, merged, deployed, scheduled, or connected to production.

## 31. Hosted GitHub Actions verification status

**NOT YET VERIFIED.** Local success establishes implementation readiness, not proof of execution on a GitHub-hosted runner.

## 32. Exact first hosted CI verification checklist

After reviewing, committing, and pushing the changes:

1. Confirm the run contains four parallel jobs named Server, Client, E2E, and Docker image.
2. Confirm E2E runs on `ubuntu-latest`, sets up Node 24, and restores or creates the client npm cache.
3. Confirm `npm ci` succeeds from `client/`.
4. Confirm the install log mentions Chromium and required Linux dependencies only, with no Firefox or WebKit installation.
5. Confirm `mongodb-memory-server` downloads or reuses a MongoDB binary and starts the loopback replica set without requesting a secret or service container.
6. Confirm Express starts on port 5001 and Vite on port 5174 through the existing fixture.
7. Confirm the Playwright summary reports `5 passed`, one worker, and clean E2E/server shutdown.
8. Confirm Server still reports 911 passing tests, Client reports 466 passing tests plus a successful build, and Docker image still builds independently.
9. Confirm a successful E2E run creates no artifact.
10. Confirm the workflow requests no additional permissions and uses no production credentials, URLs, database, or API quota.

## 33. Failure-debugging procedure

Open the failed GitHub Actions run and inspect the E2E step that first failed. If Playwright executed, download `playwright-e2e-failure` from the run's Artifacts section. Open its HTML report with `npx playwright show-report <playwright-report-path>` and any trace with `npx playwright show-trace <trace.zip>`, using the repository's installed Playwright version. Review the corresponding screenshot and `test-results` context. If no artifact content exists, the failure occurred before Playwright produced output, so inspect the checkout, npm, Chromium/system dependency, or Mongo binary download log. Do not add secrets or point the suite at production as a workaround.

## 34. Known limitations

- Hosted GitHub execution has not yet occurred.
- Chromium and the MongoDB test binary depend on permitted infrastructure downloads on a fresh runner.
- The suite intentionally covers Chromium and five critical flows only.
- The first runner download will be slower than the approximately ten-second prepared local suite.
- Mongoose emits existing `new` option deprecation warnings during demo seeding; they do not affect outcomes.
- No local `actionlint`, `act`, Ruby YAML parser, or repository Node YAML parser was installed. The workflow was validated by focused diff inspection, Git whitespace checks, existing GitHub syntax conventions, correct working-directory/path semantics, and the passing lockfile dry run; hosted GitHub parsing remains the final authority.

## 35. Recommended next step

Review the focused workflow diff and this report, then commit and push when ready. Watch the first GitHub Actions run against the checklist above. If all four jobs pass and E2E reports five passing tests without an artifact, Phase 2 is hosted-CI verified.
