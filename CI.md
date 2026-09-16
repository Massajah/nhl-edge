# NHL Edge continuous integration

GitHub Actions runs `NHL Edge CI` for every push and ordinary pull request. It
uses independent Linux jobs so server, client, and production-image failures
are reported separately:

- **Server:** `npm ci`, syntax lint, and the complete Node test suite.
- **Client:** `npm ci`, ESLint, the complete Node test suite, and the Vite
  production build.
- **Docker image:** builds the repository root `Dockerfile`, using the same
  repository-root context as Railway.

The workflow is validation-only. It has read-only repository permission, uses
no production secrets, does not run the cron entrypoint, does not start an
application container, does not authenticate to a registry, and neither pushes
an image nor deploys anything. It does not connect to MongoDB Atlas, Google,
The Odds API, Railway, or an NHL Edge production endpoint. Tests exercise
database and provider behavior with local fakes, fixtures, injected request
functions, and loopback HTTP servers.

The client test step sets `VITE_GOOGLE_CLIENT_ID` to the explicit non-secret
placeholder `ci-test-client-id.invalid`. One rendering test needs Google sign-in
to be configured in order to exercise that UI branch; it does not contact
Google. The step also sets `LANG` and `LC_ALL` to `fi_FI.UTF-8`, matching the
project's locale-dependent number-format assertions on Linux. The production
build receives none of these test-step values and no `VITE_*` values.

Railway deployment remains separate from GitHub Actions. Because Railway is
already connected to this repository, a user push may independently trigger a
Railway deployment even though this workflow contains no deployment logic.

## Reproduce locally

Run the server checks from `server/`:

```powershell
cd server
npm ci
npm run lint
npm test
```

Run the client checks from `client/`:

```powershell
cd client
npm ci
npm run lint
pwsh -NoProfile -Command {
  $env:VITE_GOOGLE_CLIENT_ID='ci-test-client-id.invalid'
  $env:LANG='fi_FI.UTF-8'
  $env:LC_ALL='fi_FI.UTF-8'
  npm test
}
npm run build
```

Run the production-image build from the repository root:

```powershell
docker build --file Dockerfile --tag nhl-edge-server:ci .
```

No secret environment values are required by these validation commands. The
client test placeholder above is intentionally fake. Do not add a production
`.env` file or GitHub secret to make CI pass. `npm ci` replaces the package's
current `node_modules` directory with the lockfile-defined install.

GitHub-hosted execution cannot be proven by local commands alone. After the
workflow is pushed, verify all three jobs in the repository's **Actions** tab.
