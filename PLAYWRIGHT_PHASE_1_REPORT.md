# NHL Edge Playwright Phase 1 Report

## 1. Executive verdict

Phase 0-1 is complete and ready for manual Playwright verification. The new Chromium smoke suite starts an isolated local NHL Edge stack, exercises the real demo authentication and persistence paths, and passed three clean headless runs, including two consecutive required verification runs. Headed Chromium could not launch on this Windows host because the browser process returned `spawn UNKNOWN`; this is an environment limitation rather than a test failure.

## 2. Existing E2E/testing architecture discovered

- The repository has independent `client/`, `server/`, and `shared/` areas and no root npm workspace.
- The client uses React and Vite; the server uses Express and Mongoose.
- There was no browser E2E framework before this phase.
- Existing tests are client and server unit/integration suites using Node's test runner, fakes, and fixtures. There was no reusable real-Mongo E2E database harness.
- Vite proxies `/api` to the server in development. The Express entry point owns Mongo connection, listener startup, and signal-aware shutdown.
- CI has independent Server, Client, and Docker image jobs.
- The production Docker build copies only `server/` and `shared/` and installs server production dependencies.

## 3. Playwright architecture chosen and why

Playwright is client-owned because its browser tests drive the Vite application and its dependencies do not belong in the production server package. This preserves the existing split-package structure instead of introducing a root workspace solely for E2E.

An automatic worker-scoped Playwright fixture starts and stops the complete stack. Playwright `webServer` was evaluated first, but its Windows task-tree shutdown hung after otherwise successful tests. The fixture-based lifecycle is deterministic, requires one command and one terminal, and cleanly closes Vite, HTTP connections, Mongoose, and the ephemeral database.

## 4. Package/dependency changes

The client gained exact development dependencies on `@playwright/test` and `mongodb-memory-server`, plus short scripts for install, headless, headed, and UI runs. The lockfile was updated with npm. No runtime dependency or root workspace was added.

## 5. Playwright version

`@playwright/test` is pinned to `1.63.0`, the current stable version verified during implementation. `mongodb-memory-server` is pinned to `11.2.0`.

## 6. Browser coverage

Phase 1 targets Chromium only. Chromium for Playwright was installed in the normal per-user Playwright cache and was not added to the repository. Firefox and WebKit are deferred until the initial suite proves valuable in CI.

## 7. Local startup strategy

`npm run test:e2e` starts the isolated Mongo replica set, the real Express server on loopback port 5001, and Vite on loopback port 5174. Vite proxies `/api` to the local server. The fixed Playwright base URL is `http://127.0.0.1:5174`; no production URL fallback exists. The worker fixture tears down all three services after the suite.

## 8. Database isolation strategy

A one-node `MongoMemoryReplSet` named `nhl_edge_e2e` provides transaction support required by the real demo seed flow. Before loading the server, the harness replaces `MONGODB_URI` with that generated URI and validates that its scheme, host, and database name are exactly the expected loopback values. Data is discarded when the worker ends, so runs cannot accumulate demo tenants or affect the production four-hour cleanup behavior.

## 9. Authentication strategy

Tests click the real **Explore Demo** control and use the real `POST /api/auth/demo` flow, DB-backed opaque session cookie, `DEMO_SANDBOX` account creation, and seed transaction. Google authentication, arbitrary injected auth state, real accounts, and committed `storageState` are not used.

## 10. External network/API strategy

Provider credentials are explicitly blanked and local auth is disabled. The Dashboard uses the application's deterministic Vite mock schedule. Browser routing prevents calls to NHL logo hosting and supplies narrow deterministic responses for optional market-odds, game-context, special-teams, and goalie-provider boundaries needed by the rendered flows. Tests do not call Google, The Odds API, live NHL endpoints, Railway, or any production service.

## 11. E2E tests implemented

Five high-value Chromium smoke tests cover:

1. Public login page, branding, Google sign-in surface, and available Explore Demo action.
2. Real demo creation, authenticated Dashboard, demo notice, navigation, account type, and seeded bankroll.
3. Two independent demo browser contexts with a real owner-scoped rating mutation.
4. Demo Model Performance tabs, rendered Games content, and expandable game details.
5. Analyzer entry from a deterministic scheduled game and a starting-goalie selection that updates the displayed effective rating.

Each page records `pageerror` and unexpected `console.error` events. The only allowlisted console message is the exact expected initial unauthenticated `/api/auth/me` 401 resource error.

## 12. Demo isolation coverage

Two fresh browser contexts create distinct real demo users and sessions. Context A writes a Boston manual rating adjustment of `1.5`; A reads it back while context B still reads `0`. This covers both cookie isolation and server-side owner isolation with the smallest stable mutation.

## 13. Analyzer coverage

The Analyzer test enters from the existing deterministic mock Dashboard game, verifies the Starting Goalies controls, selects a deterministic provider-stub goalie, keeps the Analyzer functional, and verifies that the displayed away effective rating changes. It deliberately avoids fragile probability assertions.

## 14. Bet flow coverage

The optional new-bet flow was not added. It would require fabricating market odds beyond the narrow provider boundary, while demo seed data and existing unit/integration tests already cover bet behavior. Deferring it keeps this phase small and avoids production odds.

## 15. Model Performance coverage

The demo flow verifies the `Demo Dataset` label, initial Forward Model tab, usable Bets & CLV and Games tabs, a rendered game control, successful drill-down expansion, and the Official Model detail. Exact model metrics remain owned by existing deterministic tests.

## 16. Accessibility/testability changes

No production UI changes were necessary. The suite uses existing roles, labels, headings, tabs, and button semantics. Two existing Analyzer test IDs are used only where no stable accessible locator identifies the effective rating and team-specific goalie selector.

## 17. Commands for local use

Run from `client/`:

```text
npm run test:e2e:install
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

Only the browser-install command is needed once per Playwright browser-cache state. The test commands start and stop the application stack automatically.

## 18. Generated artifacts / gitignore

The repository ignores `client/playwright-report/`, `client/test-results/`, and `client/blob-report/`. The HTML report, failure screenshots, and retry traces therefore remain local. Video is disabled. Test source and configuration remain tracked.

## 19. E2E first run result

The first required final headless verification passed: 5/5 tests in 9.5 seconds, with clean stack shutdown.

## 20. E2E second consecutive run result

The immediately consecutive headless verification passed: 5/5 tests in 9.4 seconds. A subsequent final run after a lint-only fixture signature correction also passed 5/5 in 10.3 seconds. No listeners were left on ports 5174 or 5001.

## 21. Headed/UI verification result

`npm run test:e2e:headed` was attempted both in the sandbox and with approved unsandboxed execution. Chromium failed before test execution with `browserType.launch: spawn UNKNOWN` in both cases. UI mode was not separately attempted because it uses the same headed browser launch path. The headless browser and all test flows work; headed/manual verification remains to be performed on a normal interactive developer desktop.

## 22. Full server test result

The complete server suite passed at the established baseline: 911/911 tests.

## 23. Full client test result

The complete client suite passed at the established baseline: 466/466 tests. The five Playwright tests are separate from this count.

## 24. Lint/build result

- Server lint passed, including syntax checks across 247 JavaScript files.
- Client lint passed, including the new Playwright files.
- The client production build passed with Vite 8.1.3 and 1,864 transformed modules.
- Vite retained its existing-style warning about the approximately 927.61 kB JavaScript chunk; no new production component work was introduced by this phase.

## 25. Docker impact

There is no production image impact: Playwright and the in-memory Mongo dependency are client-only development dependencies, `.dockerignore` excludes `client/`, and the unchanged production Dockerfile copies only `server/` and `shared/`. An actual Docker build could not be rerun because Docker Desktop's Linux engine was not running on this host.

## 26. Production side effects

**NONE.** The suite uses loopback services and an ephemeral database. It did not deploy, invoke production cron, change Railway, connect to a deployed application, or mutate production data.

## 27. Secrets/credentials

**NONE.** No credentials, production Mongo URI, Odds key, Google secret, real cookie, auth storage state, or sensitive production browser artifact was added. Provider-related environment variables are blanked by the test harness.

## 28. CI integration status

GitHub Actions was intentionally not changed in Phase 1. Local reliability and repeatable cleanup were proven first, while the existing Server, Client, and Docker jobs remain unchanged.

## 29. Recommendation for Playwright CI Phase 2

Add a separate E2E job that checks out the repository, sets up the repository's Node version, runs `npm ci` in `client/`, runs `npx playwright install --with-deps chromium`, then runs `npm run test:e2e`. It should require no service container or secrets because the worker owns Mongo and both application servers. Upload `client/playwright-report/` and `client/test-results/` only on failure. Keep workers at one and leave production deployment jobs independent.

## 30. Whether Playwright Agents/MCP/CLI skills are worth adding later

Not for the current repository state. Standard Playwright Test is sufficient and produces auditable code that runs locally and in CI. Agents, MCP, or extra CLI skills may help later with high-volume interactive test authoring or difficult visual debugging, but they should not become a runtime or CI requirement.

## 31. Files added

- `PLAYWRIGHT_PHASE_1_REPORT.md`
- `client/playwright.config.js`
- `client/e2e/specs/critical-smoke.spec.js`
- `client/e2e/support/app.js`
- `client/e2e/support/fixtures.js`
- `client/e2e/support/test-stack.mjs`

## 32. Files modified

- `.gitignore`
- `client/eslint.config.js`
- `client/package.json`
- `client/package-lock.json`

All other dirty working-tree files and the two existing Starting Goalie reports predated this work and were preserved without modification by this phase.

## 33. Known limitations

- Headed/UI browser launch is blocked on this particular Windows host by `spawn UNKNOWN`.
- Docker image execution was not repeated because Docker Desktop was stopped; static package and Docker-path inspection confirms no image impact.
- A clean `npm ci` verification was blocked by an already-running, pre-existing Vite process holding the Rolldown native binding. `npm install` successfully restored dependencies, and `npm ls` confirmed both exact new packages. CI will start from a clean filesystem.
- The first run on a fresh machine may download both Chromium and the MongoDB test binary.
- Coverage is intentionally Chromium-only and limited to five critical smoke flows.
- Demo seeding emits Mongoose deprecation warnings that do not affect test outcomes.
- `npm audit` currently reports five fixable client/toolchain transitive advisories (one moderate and four high); broad dependency remediation was outside this scoped E2E change.

## 34. Recommended next step

Run `npm run test:e2e:headed` from `client/` on a normal interactive desktop and manually inspect the five flows. If that passes, add the separate Phase 2 GitHub Actions E2E job described above; do not fold browser dependencies into the production Docker image.
