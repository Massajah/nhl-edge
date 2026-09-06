# NHL Edge authentication deployment

NHL Edge uses Google Identity Services only to establish identity. The browser
temporarily receives a Google ID credential and posts it to the API. The API
verifies it, resolves the User by the stable Google `sub`, creates a random
opaque session, stores only its SHA-256 hash in MongoDB, and sets the raw token
in an HttpOnly cookie. Google tokens are not stored.

## Google Cloud Console

Use a Web OAuth client and configure these Authorized JavaScript origins:

- `http://localhost:5173`
- `https://nhl-edge-rouge.vercel.app`

Production must use HTTPS. This GIS credential flow does not use a redirect
callback, so no redirect URI or Google client secret is required.

## Vercel frontend

Set these public build variables (neither value is a secret):

- `VITE_GOOGLE_CLIENT_ID`: the same public Web client ID used by the API
- `VITE_API_BASE_URL=https://nhl-edge-production.up.railway.app`
- `VITE_LOCAL_AUTH_ENABLED=false`

Redeploy after changing Vite variables. Keep the CSP in `client/index.html`, or
translate it into equivalent Vercel response headers if headers are centrally
managed later. Google GIS must remain explicitly allowed by `script-src`,
`style-src`, `frame-src`, and `connect-src`.

## Railway API

Set:

- `NODE_ENV=production`
- `GOOGLE_CLIENT_ID`: public identifier, same value as the Vite variable
- `CLIENT_ORIGIN=https://nhl-edge-rouge.vercel.app`
- `LOCAL_AUTH_ENABLED=false`
- `SESSION_COOKIE_NAME=nhl_edge_session`
- `SESSION_TTL_MS=2592000000`
- `SESSION_COOKIE_SAME_SITE=none`
- `SESSION_COOKIE_SECURE=true`
- `AUTH_RATE_LIMIT=20`
- `AUTH_RATE_WINDOW_MS=900000`
- `MONGODB_URI`: secret
- existing Odds API keys and other provider secrets

`GOOGLE_CLIENT_ID`, `CLIENT_ORIGIN`, and the cookie policy values are
configuration, not secrets. MongoDB credentials and provider API keys remain
server-only secrets. Opaque sessions generate independent random tokens and do
not require a signing secret.

`JWT_SECRET` is no longer used by NHL Edge and should be removed after this
session-based release is verified. Opaque sessions do not require an
application signing secret.

The Railway odds cron remains a direct server process and does not need a
browser session. It still requires `MONGODB_URI` and `THE_ODDS_API_KEY`.

## CORS and CSRF threat model

The API returns credentialed CORS headers only for the exact configured
frontend origin; wildcard origins are never used. `GET`, `HEAD`, and preflight
`OPTIONS` remain conventional. Browser state-changing methods must carry an
exact allowlisted `Origin`. A mutation that has a session cookie but no Origin
is rejected, which blocks cross-site forms and fails closed when a privacy tool
strips the header. Cookie-less cron and operator processes do not carry ambient
browser authority and remain usable without an Origin header.

The session cookie is HttpOnly, so application JavaScript cannot read or copy
it. This protects against token theft through ordinary browser storage access;
it does not make an unrelated client-side script injection harmless, so the
frontend CSP continues to restrict executable sources to the application and
Google GIS.

## Cross-site cookie limitation

`vercel.app` and `railway.app` are different sites. The production cookie is
therefore correctly set as `SameSite=None; Secure`, CORS allows only the exact
Vercel origin with credentials, and state-changing cookie requests require an
approved Origin.

Some browsers and privacy modes block third-party cookies regardless of these
correct attributes. There is no secure client-side fallback. The minimum
reliable future deployment change is to expose the API on a same-site domain,
for example `api.<your-domain>` beside the frontend, or proxy `/api` through the
frontend origin. After that change, use a same-site cookie policy such as Lax
and update the exact origin configuration.

## Operator-only commands

Commands are dry-run by default. Review exact identities and output before
adding `--confirm`.

```sh
npm run operator:set-user-role -- --email=OWNER --google-subject=SUBJECT --role=admin
npm run migrate:assign-legacy-owner -- --email=OWNER --google-subject=SUBJECT
```

After reviewing a dry run, the corresponding explicit forms are:

```sh
npm run operator:set-user-role -- --email=OWNER --google-subject=SUBJECT --role=admin --confirm
npm run migrate:assign-legacy-owner -- --email=OWNER --google-subject=SUBJECT --confirm
```

Run them from `server/`. The confirmed legacy migration assigns only missing or
null owners across every current private model, never overwrites existing
owners, handles the known legacy Power Rating indexes, uses a MongoDB
transaction, and records a durable versioned marker. The report includes every
collection, bounded sample IDs, and ownerless unique-index concerns. If the
deployment does not support transactions or any update conflicts with a modern
unique index, execution fails instead of accepting a partial ownership update.
The former destructive cleanup command is permanently disabled.

Local password auth requires both `LOCAL_AUTH_ENABLED=true` on the server and
`VITE_LOCAL_AUTH_ENABLED=true` in the client build. Never enable it as a
production bypass. Existing password hashes are retained for migration safety.
The local routes and password fields can be removed in a later dedicated change
after every intended account uses Google and transitional access is no longer
needed.

## Bookmaker capture participation

The Settings response may present all bookmakers as defaults, but an account
participates in scheduled provider capture only after it has explicitly saved a
preferences row. Only active users with such a row contribute enabled keys to
the one global bookmaker union. Unconfigured, disabled-user, and all-disabled
accounts contribute nothing. An empty union never expands to all bookmakers and
does not spend a provider request; odds snapshots and closing markets remain
global rather than being duplicated per user.
