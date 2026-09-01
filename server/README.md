# NHL Edge API

## Authentication

Phase 1 backend auth uses stateless bearer tokens. Frontend clients should send
the application JWT in:

```text
Authorization: Bearer <token>
```

Required environment variables:

- `MONGODB_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`, for example `7d`
- `GOOGLE_CLIENT_ID`
- `CLIENT_ORIGIN`, comma-separated for multiple frontend origins

Market odds use one additional server-only secret:

```dotenv
THE_ODDS_API_KEY=
```

Copy `server/.env.example` for the optional safe defaults. Never put the key in
a `VITE_` variable or client environment file; the React application only calls
the authenticated NHL Edge endpoint.

`CLIENT_URL` is still accepted as a fallback for the previous local setup, but
new environments should use `CLIENT_ORIGIN`.

## Routes

Protected user-specific routes:

- `/api/auth/me`
- `/api/bankroll`
- `/api/bets`
- `/api/injuries`
- `/api/power-ratings`
- `GET /api/power-ratings/history`
- `GET /api/power-ratings/history/seasons`
- `POST /api/power-ratings/update`
- `/api/settings/betting`
- `/api/settings/rating-engine`
- `GET /api/settings/storage`
- `GET /api/settings/bookmakers`
- `PUT /api/settings/bookmakers`
- `GET /api/market-odds/nhl?date=YYYY-MM-DD&refresh=true|false`
- `GET /api/market-odds/status`
- `GET /api/teams/:teamId/goalie-adjustments`
- `PUT /api/teams/:teamId/goalie-adjustments/:nhlPlayerId`
- `DELETE /api/teams/:teamId/goalie-adjustments/:nhlPlayerId`
- `PATCH /api/game-context/:gameId/goalies`

## Database storage monitoring

`GET /api/settings/storage` is an authenticated, read-only monitor. It measures
cluster-wide uncompressed BSON data plus indexes with Atlas `atlasSize`; it does
not scan documents or modify storage. The capacity is separate deployment
configuration: `MONGODB_STORAGE_LIMIT_BYTES` defaults to 512 MiB for the
intended Atlas Free cluster. Results are cached in memory for three minutes by
default (`MONGODB_STORAGE_CACHE_TTL_MS`), while `?refresh=true` refreshes the
measurement. The monitor never performs cleanup or retention work.

Shared read-only NHL provider routes include `GET /api/standings` and
`GET /api/standings?season=YYYYyyyy`, plus
`GET /api/standings/playoffs?season=YYYYyyyy`. They contain no user-owned data
and follow the same public/shared convention as schedule and team-directory
reads.

## NHL Standings

`GET /api/standings` resolves the current season through the canonical NHL
season service and returns that season plus the five previous seasons. Clients
may select one of those canonical IDs with `season`; display IDs such as
`2024–25` normalize to the same internal `20242025` value. Malformed or older
out-of-range values are rejected before a provider URL is built.

The data source is the official NHL Web API. Current standings use one
league-wide `/v1/standings/now` request. Completed historical seasons use one
`/v1/standings/{YYYY-MM-DD}` request at the canonical final regular-season date
from existing season metadata. Returned rows must match the requested
`seasonId` and regular-season game type, so an offseason `/now` response still
pointing at the prior season becomes the normal `no_standings` preseason state
instead of displaying the wrong table. No per-team, per-conference, or
per-division calls are made.

Rows preserve the provider's official league, conference, division, and
wildcard sequences and normalize team/franchise identity, records, points,
point percentage, goals, differential, regulation wins, Last 10, streak, and
clinch indicator. The response also publishes the verified NHL meanings used
by the client legend: `x` clinched playoff berth, `y` clinched division title,
`z` clinched conference title, `p` clinched Presidents' Trophy, and `e`
eliminated from playoff contention. Combined provider codes are preserved and
qualification is never inferred from points. Provider names and logos remain season-authentic: Arizona
Coyotes rows display as Arizona while their reusable canonical franchise ID is
Utah. Current Utah Hockey Club/Mammoth branding is likewise kept as returned.

Current normalized responses are cached for 10 minutes. Completed historical
responses use a 24-hour normalized cache, while the shared raw NHL requester
keeps date-addressed standings for 30 days. Both layers deduplicate concurrent
requests. Provider failures return a safe `provider_error` state; missing
current data returns `no_standings`, and missing historical data returns
`unavailable` without substituting another season.

Standings are informational only. The service has no write path and is not
imported by Power Ratings, probability, Home Advantage, Motivation, betting,
or Rating Lab calculations. The normalized team/record/rank fields can support
a future simulator or manually designed motivation feature, but neither is
implemented here.

## NHL Playoffs

`GET /api/standings/playoffs` uses the same canonical season selection and
recent six-season window as Standings. Actual brackets come only from the
official NHL Web API `/v1/playoff-bracket/{postseasonYear}` resource. Its series
letters, round numbers, season-specific teams/logos, series wins, winning team,
and final are normalized into Eastern and Western Round 1, Round 2, Conference
Final, and Stanley Cup Final sections. A completed final exposes the confirmed
champion. Unknown future slots remain `TBD`; no winner is predicted. Historical
seasons never reconstruct playoff matchups from final standings.

For the selected current season, an available official bracket always wins. If
the playoff resource has no series yet, the service builds a clearly marked
`projected` snapshot from the already normalized current standings. It follows
the NHL's division-based format: the top three teams in each division qualify,
the two remaining conference wild cards use official `wildcardSequence`, the
better division winner faces WC2, the other division winner faces WC1, and D2
faces D3. Later rounds and the Cup Final stay `TBD`. If standings do not contain
enough official division/wildcard ordering, the service returns
`projected_unavailable` instead of inventing a bracket.

Current actual playoff responses use a short two-minute normalized cache;
projected responses share the 10-minute standings cadence. Completed historical
brackets use a 30-day normalized cache. All modes deduplicate concurrent
requests; provider failures return `provider_error`, missing historical data
returns `unavailable`, and missing projection inputs return
`projected_unavailable`. The underlying shared NHL requester adds its normal
five-minute raw-response cache.

Playoff data is read-only and informational. It is not imported by Power
Ratings, Effective Rating, Motivation, probability, betting, Kelly, or Rating
Lab services. The normalized shape can support future simulation or series
models, but none are implemented here.

## Provider Goalie Adjustments

The existing NHL roster service is authoritative for current team goalies.
Authenticated users store only a mapping keyed by canonical team ID and NHL
player ID, with a model adjustment from their configured Maximum Goalie
Penalty through `0.00` in `0.05` increments plus an optional note and nullable
active override. Positive adjustments are rejected. Team Power Rating is
assumed to already include the normal #1 goalie, so `0.00` is the baseline and
backup or third-goalie adjustments are relative negative downgrades. A provider
goalie with no mapping has an implicit `0.00` adjustment and creates no database
record. The API never accepts a client-provided owner ID, and the
`{ userId, teamId, nhlPlayerId }` mapping is unique.

Legacy user-maintained goalie documents remain readable for compatibility.
Rows with a valid NHL player ID are normalized onto matching current provider
goalies; unmatched manual rows are excluded from current roster choices.
Historical game-context and bet snapshots retain legacy status values and are
normalized for display without being rewritten.

Maximum Goalie Penalty is stored in the existing user-scoped Rating Engine
settings document, defaults to `-4.00`, and may be configured from `-5.00` to
`0.00`. The Model Adjustments scoped save and reset own this field; the Power
Rating Engine scoped save and reset leave it unchanged. Tightening it never
clamps or rewrites an existing saved goalie value. When an out-of-policy saved
default is next used, the exact value is preserved and the request returns a
review-required validation state so the user can fix the team default or supply
an existing supported game override.

Game-specific starting-goalie selections live in the existing `GameContext`.
Selections snapshot the provider goalie identity, team default, any game
override, effective adjustment, display name, and source. Custom and unknown
selections remain game-specific. Other / Unlisted goalie requires an adjustment
within the current configured range and does not create a team default. Unknown
starter always resolves to neutral `0.00` and has no editable penalty. Later
adjustment edits therefore do not rewrite saved game contexts or bet snapshots.

Injury records remain in the existing authenticated, user-scoped `Injury`
collection. Current roster selections snapshot `providerPlayerId`, player name,
and canonical `position`; manual Other / Unlisted records keep a null provider
ID. Provider `L`/`R` positions normalize to `LW`/`RW`. Existing records missing
identity metadata remain readable without destructive migration or name-based
provider guessing.

Position `G` automatically sets the compatibility `isGoalie` flag and forces
persisted model impact to zero. The team summary also excludes either position
`G` or a legacy `isGoalie` flag, so stale goalie impacts cannot leak into
Dashboard or Analyzer totals. Goalie availability stays available for reference
and history; Starting Goalies remains the only goalie adjustment path.

Maximum Player Injury Penalty is stored in the existing user-scoped
`RatingEngineSettings` document, defaults to `-2.50`, uses `0.50` increments,
and is owned by the Model Adjustments scoped save/reset. The Power Rating Engine
scope cannot write or reset it. New or changed skater impacts must be within the
configured value through `0.00` and use half-point steps. Existing arbitrary
negative values remain unchanged until their impact is edited.

The injury aggregate matches active, non-healthy records, counts every active
record for context, and sums only negative skater impacts. Zero-impact skaters
therefore remain visible without changing the total; healthy, historical, and
goalie records contribute zero. Multiple skaters may sum beyond the individual
maximum because no team-level cap exists. Duplicate active records are rejected
by provider player ID, or case-insensitive manual name when no provider ID
exists; historical records remain valid.

`DELETE /api/injuries/team/:teamId/history` is authenticated and scoped by both
the token user and a known NHL team. It deletes only records that are inactive
or healthy and returns `deletedCount`; active non-healthy skaters and goalies are
never matched. This is the server-side ownership boundary for the team-level
Clear history action and does not recalculate or mutate model values.

No injury provider, automatic player valuation, replacement-quality model,
lineup optimizer, or cumulative positional penalty is part of this workflow.

## Market Odds Phase 1

The authenticated market-odds endpoint uses The Odds API v4 for current NHL
moneyline (`h2h`) prices in the EU region, returned as decimal odds. One
provider request covers a buffered selected-date window and is matched to the
NHL schedule by canonical home/away team identity plus a three-hour commence
time tolerance. Home and away order is never reversed silently.

Normalized matched events preserve each complete bookmaker row and select the
highest valid decimal price independently for the home and away sides. Prices
are not averaged, de-vigged, or treated as consensus probabilities. Started or
final games do not receive a current pre-match snapshot.

Public provider data is cached in server memory for 10 minutes by sport,
region, market, odds format, and commence-time window. Identical in-flight
requests share one Promise across users. A forced Dashboard refresh is limited
to one provider attempt per identical window every 30 seconds, and valid cache
data is preferred when credits are low or the provider rate-limits a request.
The server tracks only the safe `used`, `remaining`, `lastCost`, and
`observedAt` quota fields. Missing configuration, timeouts, malformed responses,
rate limits, and exhausted quota return structured states without breaking the
schedule or manual-odds workflow. A valid cached snapshot remains usable after
quota exhaustion.

The following optional variables override defaults:

```dotenv
THE_ODDS_API_BASE_URL=https://api.the-odds-api.com
THE_ODDS_API_SPORT=icehockey_nhl
THE_ODDS_API_REGION=eu
THE_ODDS_API_MARKET=h2h
THE_ODDS_API_ODDS_FORMAT=decimal
MARKET_ODDS_CACHE_TTL_MS=600000
MARKET_ODDS_LOW_CREDIT_THRESHOLD=25
MARKET_ODDS_MIN_REFRESH_INTERVAL_MS=30000
```

Development request/cache/credit summaries are emitted only when
`NHL_EDGE_API_DEBUG=true`; request URLs and API keys are never logged.

## Market Odds Phase 2A

Bookmaker preferences are stored per authenticated user. The settings API
returns the bookmaker keys and display names observed in the latest provider
response, with every bookmaker enabled by default. New bookmakers are also
enabled by default. The update endpoint accepts only `enabledBookmakerKeys`;
it never accepts a client-supplied `userId`. If a user attempts to disable
every available bookmaker, the server restores all bookmakers and returns a
warning.

Preferences are applied after the shared provider response is read from cache,
so changing them does not make another provider request or create a per-user
provider cache. Best home and away prices are recalculated independently from
enabled bookmakers only. The authenticated market-odds response also preserves
every normalized bookmaker row for transparent display and marks disabled rows
without allowing them to influence EV, Kelly, or saved snapshots.

Phase 2A intentionally has no market consensus, de-vig, historical/opening
odds, line movement, live updates, spreads, totals, props, polling, WebSockets,
or automatic bet placement.

Public NHL data routes:

- `/api`
- `/api/health`
- `/api/schedule/today`
- `/api/schedule/:date`
- `/api/teams`
- `/api/teams/:teamAbbreviation/roster`
- `/api/teams/:teamAbbreviation/goalie-summaries`
- `/api/teams/:teamAbbreviation/stats`
- `/api/players/:playerId/goalie-stats`

## Team Model Values Phase 1

Authenticated Team Details lineup notes use one current `TeamLineup` document
per `userId + teamId`. The client never sends `userId`; every operation uses the
authenticated token and the canonical NHL team identity shared with goalie
adjustments.

The Teams page reads saved goalie adjustments with `?localOnly=true`, which
returns MongoDB values without waiting for roster enrichment. Existing callers
that need current provider goalies retain the original enriched response.

Protected endpoints:

- `GET /api/teams/:teamId/model-values` returns the current user's saved values
  or a fixed empty four-line/three-pair shape.
- `PUT /api/teams/:teamId/model-values/lines` upserts four optional forward
  lines, three optional defense pairs, and one optional plain-text lineup note.
- `DELETE /api/teams/:teamId/model-values/lines` clears positions and the note.

Selections store NHL player IDs as authoritative identity plus a
non-authoritative display-name snapshot for each occupied slot. Current
provider forwards validate new forward selections and current provider
defensemen validate new defense selections. Provider names refresh snapshots
when a lineup is saved with roster data available; old documents without
snapshots remain readable. Previously saved IDs remain readable and may be
saved unchanged if a player later disappears or the NHL provider is
temporarily unavailable. Note-only saves do not require a provider request.

The Model Values read endpoint is MongoDB-only and never waits for the NHL
provider. Teams provider endpoints return independent section state metadata
(`ready`, `cached`, `stale`, `rate_limited`, or `unavailable`) without raw
upstream bodies. The NHL service owns normalized request keys, bounded
concurrency, in-flight Promise deduplication, one interactive 429 retry with
`Retry-After`, and safe stale-cache fallback. One current-roster request is
normalized once and supplies forwards, defensemen, and goalies.

Team Model Values are personal notes only. They are not read by Power Ratings,
Dashboard, Game Analyzer, Game Context, injuries, goalie adjustments,
special-teams calculations, Bet Candidate logic, Kelly sizing, or saved bets.
Phase 1 has no PP/PK units, automatic lineup feed, historical versions,
game-specific lineups, or lineup automation. Provider goalie adjustments
remain a separate persisted feature and retain their existing model effects.

## Special Teams Matchup production modes

`GET /api/teams/special-teams` exposes a compact league dataset for Dashboard
and Game Analyzer using only the existing Previous 3 seasons PP/PK averages and
league ranks. The endpoint calls the existing league Special Teams service, so
its provider work, eight-hour cache, stale fallback, and in-flight request
deduplication are shared with the Teams page. It does not add a provider or
perform one upstream request per displayed game or team. The response includes
`leagueTeamCount`, the three source season IDs, and canonical team
abbreviations with 3-season PP and PK ranks.

`RatingEngineSettings` is the single authenticated, user-scoped source for
`specialTeamsMode` (`off`, `alert_only`, or `automatic`),
`specialTeamsRankThreshold` (integer `3–12`), and the symmetric
`specialTeamsAdjustment` (`0.25`, `0.50`, `0.75`, or `1.00`). The defaults are
Alert only, Top/Bottom 6, and `0.50`. The legacy
`specialTeamsAlertsEnabled` field remains a derived compatibility alias;
documents without a mode map an explicit legacy `false` to Off and otherwise
default to Alert only. Model Adjustments reset restores all canonical defaults.

Detection evaluates Away PP versus Home PK and Home PP versus Away PK
independently. Top N PP versus Bottom N PK is positive; Bottom N PP versus Top
N PK is negative. The bottom boundary is calculated as
`leagueTeamCount - N + 1`. Missing or invalid ranks are unavailable rather than
alerts.

The shared detector produces one normalized result per team. Off suppresses the
signal and applies zero. Alert only keeps the existing context visible and
applies zero. Automatic maps a positive signal to `+X` and a negative signal to
`-X`; missing or neutral data remains zero. Game calculation adds that one
normalized field exactly once to Effective Rating, so probability, fair odds,
and edge naturally follow. Saved bets retain each side's signal, ranks, mode,
threshold, and applied adjustment for audit. This game-specific layer is not
read by the permanent Power Rating update engine or Rating Lab replay.

## Starting Rating Scale

Authenticated Power Rating settings persist one canonical initialization scale
per user as `startingRatingScaleMode`, `startingRatingCenter`, and
`startingRatingSpread`. Existing users without those fields transparently use
the Base Model v1 calibrated default: center `46`, total spread `8`, range
`42–50`. Supported range-first presets are `42–48`, `42–50`, `40–50`, and
`40–52`; their derived centers are `45`, `46`, `45`, and `46`. Custom mode
validates finite minimum/maximum values, requires minimum below maximum, keeps
the range within `0–100`, and derives center and total spread internally.

`GET /api/power-ratings/starting-scale` returns the saved scale plus derived
`min`/`max` and lifecycle status. The scale is locked when the authenticated
user has at least one `ProcessedRatingGame` inside the current active season's
regular-season boundaries. Prior-season records do not lock the next preseason.
`PUT /api/power-ratings/starting-scale` returns `409` when locked; while
unlocked, it persists configuration only and never writes team ratings.

New-team seeding and preseason `POST /api/power-ratings/reset` use the selected
center. A scale change alone never resets or redistributes current ratings, and
existing live values outside the range are neither clamped nor invalidated.
New manual Starting Rating assignments through either team-rating endpoint must
stay inside the selected scale and use `0.5`-point increments. Both Starting
Rating writes and ordinary reset return `409` after the canonical lifecycle
locks; the internal New Season Reset explicitly clears the prior baseline and
returns initialization to preseason.

The lock does not affect automatic Rating Engine updates, Home Adjustment, or
Manual Adjustment. New Manual Adjustment edits use `0.5`-point increments,
while automatic rating deltas retain full engine precision and Home Adjustment
keeps its `0.1` UI step. Probability Scale, K factor, rating formulas, Home
Advantage, and Rating Lab are unchanged.

## Power Rating Updates

Authenticated users can apply completed NHL regular-season games to their
persisted current Power Ratings manually with:

```bash
curl -X POST http://localhost:5000/api/power-ratings/update \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"from":"2025-10-01","to":"2025-10-07"}'
```

The body is optional. If dates are omitted, the endpoint uses the latest seven
NHL schedule dates including today. Dates must use `YYYY-MM-DD`, and future
dates are rejected.

Successful responses include `success`, `dateRange`, `gamesFound`,
`gamesAlreadyProcessed`, `gamesProcessed`, `gamesSkipped`, `errors`, and
`processedGames`. Each processed game includes the game date, away/home teams,
final score, result type, and before/after rating changes for both teams.

The update workflow is idempotent per user: processed games are recorded in
`ProcessedRatingGame`, and rerunning the same range reports already-processed
games without applying duplicate rating changes. Scheduling is intentionally
deferred for this phase; future cron or job-runner work should call the same
rating update service.

Production update engine settings are centralized in
`services/ratingEngineSettingsService.js`.

Dashboard can also ask the server to process newly completed games with:

```bash
curl -X POST http://localhost:5000/api/power-ratings/auto-update \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

The automatic endpoint accepts an optional `throughDate` in `YYYY-MM-DD`
format. It does not accept `userId`; all ratings, settings, and audit records
are scoped from the authenticated token. The service resolves the canonical
current NHL season and scopes processed-game history to its regular-season
boundary. When current-season history exists, it finds the latest processed
game date, backs up by a small overlap, and calls the same chronological update
workflow used by the manual endpoint. Already processed games are skipped by
the existing `userId + gameId` uniqueness rule.

When no current-season processed-game history exists, the configured Power
Ratings are the starting state. Automatic processing begins at the canonical
season start and applies the first eligible completed regular-season games in
chronological order. If no eligible games exist yet, the response is
`status: "preseason_ready"`; no marker is created and no rating changes. Manual
updates remain a maintenance and recovery workflow. Full-season
recalculation, cron jobs, background workers, polling, and automatic replay
after setting changes are intentionally deferred.

Automatic responses include `status` (`preseason_ready`, `updated`,
`up_to_date`, `partial`, or `unavailable`), counts, per-game errors, the latest
processed game when known, and the Rating Engine settings snapshot used for
newly processed games. Concurrent automatic requests share a user-scoped
in-flight update lock; one user's update does not block another user's update.

## Power Rating Update History

Authenticated users can query immutable, user-specific
`ProcessedRatingGame` audit records with:

```bash
curl "http://localhost:5000/api/power-ratings/history?page=1&limit=25&from=2026-01-01&to=2026-01-31&team=CAR&resultType=REGULATION" \
  -H "Authorization: Bearer <token>"
```

Supported query parameters:

- `page`: positive integer, defaults to `1`
- `limit`: positive integer, defaults to `25`, clamped to `100`
- `from`: optional game date lower bound in `YYYY-MM-DD`
- `to`: optional game date upper bound in `YYYY-MM-DD`
- `team`: optional NHL team abbreviation or id from the app's canonical team
  list
- `resultType`: optional `REGULATION`, `OVERTIME`, or `SHOOTOUT`

Season metadata for the history UI is available at:

```bash
curl "http://localhost:5000/api/power-ratings/history/seasons" \
  -H "Authorization: Bearer <token>"
```

The seasons response includes `currentSeasonId`, `seasons`, `metadataSource`,
and an optional `warning`. Each season has a stable ID such as `20262027`, a
hockey label such as `2026–27` in UI clients, and regular-season `startDate`
and `endDate` bounds.

Season boundaries are centralized in `services/nhlSeasonService.js`. The
preferred source is NHL API club season schedules: the service derives the
earliest and latest regular-season game dates across canonical NHL teams. If
live season metadata cannot be retrieved, the service returns a documented
fallback table and sets `metadataSource` to `fallback` with a warning.

During the offseason, "current season" is deterministic: if the NHL API reports
the prior season but today's NHL date is after that regular season's end date,
the service marks the upcoming regular season as current when metadata is
available. This keeps late-summer history filtering pointed at the season users
are preparing for.

Responses include `items`, `pagination`, `filters`, and `summary`. History
queries always scope by the authenticated `userId`; clients cannot request or
override another user's audit records. Results sort by newest `processedAt`,
then newest `gameDate`, then newest `gameId`.

History records are audit snapshots. Changes affect future rating updates only.
Previously processed games are not recalculated, and changing current Power
Rating Engine settings does not rewrite prior `ProcessedRatingGame` records.
Older audit records may not contain every
current field; unavailable legacy values are returned as `null` and records are
not automatically migrated.

Indexes on `ProcessedRatingGame` support user-scoped history queries by
processed timestamp, game date, and team abbreviation. The existing unique
`userId + gameId` index remains in place for idempotent update processing.

## Bankroll and moneyline settlement

Authenticated users can initialize and track a transaction-based bankroll from
Bet Tracker. The ledger is the source of truth and no authoritative
`currentBankroll` field is stored. New analyzer-created moneyline bets use
transactional accounting: placement writes `BET_STAKE`, a win writes the full
decimal-odds return as `BET_WIN_RETURN`, and a void, push, or pending-bet
cancellation returns stake with `BET_VOID_RETURN`. Corrections write explicit
`SETTLEMENT_REVERSAL` and correction transactions instead of rewriting history.

Protected endpoints:

- `POST /api/bankroll/initialize` with `startingBalance`, `startDate`, and
  optional `currency` initializes the user once. The starting balance is stored
  as a `STARTING_BALANCE` transaction at the selected start date. Initialization
  does not infer or import older settled bets.
- `POST /api/bankroll/deposits` records positive cash inflow.
- `POST /api/bankroll/withdrawals` records cash outflow and rejects withdrawals
  greater than available bankroll.
- `GET /api/bankroll/summary?period=all-time|season|custom&season&from&to`
  returns initialization status, currency, starting balance, current bankroll,
  betting profit, deposits, withdrawals, cash flow, settled bet count, pending
  stake, available bankroll, and the resolved period.
- `GET /api/bankroll/transactions?page&limit&from&to&type&season` returns a
  newest-first, user-scoped ledger page.
- `GET /api/bankroll/seasons` reuses the centralized NHL regular-season
  metadata used by Power Rating Update History.
- `GET /api/bets?page&limit&result&modelStatus` returns a newest-first,
  user-scoped bet page plus global Bet History summary totals. The legacy
  `GET /api/bets` response remains available for existing all-bets consumers.
- `POST /api/bets/settle` checks only the authenticated user's pending bets and
  returns win/loss/pending counts. It is an explicit v1 trigger, not a cron or
  polling worker.

Money is stored in integer minor units as `amountCents` and serialized with
both cent and decimal fields. `Available Bankroll` is the spendable ledger
balance after recorded stake debits; the summary subtracts pending stake only
for untouched legacy bets that have no stake transaction. `Current Bankroll`
adds pending exposure back to available bankroll as an equity view. Pending
exposure is informational and is never deducted twice. Betting Profit uses
audited realized-profit deltas, so a win records profit of
`stake * (odds - 1)` while its bankroll credit remains `stake * odds`.

Automatic settlement supports `betType = moneyline` only. It requires the NHL
game ID and selected team ID, loads that exact game through the existing NHL
API/cache service, accepts only canonical `FINAL` or `OFF` states, verifies the
selected team belongs to the matchup, and compares the final score. Regulation,
overtime, and shootout wins are identical for this market; Power Rating result
multipliers are never used. Missing links, missing games, live/scheduled games,
and provider errors remain pending with no bankroll movement.

Each financial action has a deterministic unique action key. Settlement first
claims the user-scoped pending result with a conditional update, then records
bankroll movement in the same Mongo transaction where supported. Repeated or
concurrent requests become no-ops. Manual WIN/LOSS/VOID/PUSH changes use the
same engine; corrections reverse the prior financial effect before applying the
new one. Transactionally funded pending bets may adjust stake by the difference.
Settled stake edits and settled-bet deletion are blocked. Deleting a pending
transactional bet returns its stake exactly once before deletion.

Older bets keep `bankrollAccounting = legacy`. They are not retroactively
charged, and old `BET_SETTLEMENT` profit transactions remain readable and
backfillable. Legacy or unknown-type bets without canonical linkage stay manual.

To inspect eligible historical settled bets for one user, run:

```bash
npm run backfill:bankroll-settlements -- --userId=<userId>
```

To write settlement transactions after reviewing the dry run, add `--confirm`.
Use `--all` instead of `--userId=<userId>` only when intentionally backfilling
every initialized bankroll. The script never runs automatically.

This implementation intentionally does not add puck-line, totals, props,
parlays, regulation-only settlement, background scheduling, or automatic
historical stake migration.

## Betting Settings

Betting Settings are user-specific staking configuration for Kelly stake
recommendations in Game Analyzer. They do not place bets and do not modify
existing bets.

Authenticated endpoints:

- `GET /api/settings/betting` returns the current user's settings and whether
  centralized defaults are being used.
- `PUT /api/settings/betting` creates or replaces the current user's settings.
  The request must include every supported field.
- `POST /api/settings/betting/reset` deletes the current user's persisted
  settings so defaults are used again.

Default values:

```json
{
  "kellyMode": "QUARTER",
  "customKellyFraction": 0.25,
  "maximumStakePercent": 3,
  "minimumEdgePercent": 2,
  "stakeRoundingIncrement": 0.5,
  "bankrollBasis": "AVAILABLE"
}
```

Kelly modes:

- `FULL`: 1.00 Kelly
- `HALF`: 0.50 Kelly
- `QUARTER`: 0.25 Kelly and the default
- `CUSTOM`: use `customKellyFraction`

Validation:

- `kellyMode`: `FULL`, `HALF`, `QUARTER`, or `CUSTOM`
- `customKellyFraction`: greater than `0` and no more than `1`
- `maximumStakePercent`: greater than `0` and no more than `100`
- `minimumEdgePercent`: `0` to `100`
- `stakeRoundingIncrement`: `0.01`, `0.05`, `0.10`, `0.50`, `1.00`, or `5.00`
- `bankrollBasis`: `AVAILABLE` or `CURRENT`

`maximumStakePercent` is a hard cap for recommended single-bet stakes.
`minimumEdgePercent` is a probability-point threshold below which stake
recommendations are suppressed. `AVAILABLE` bankroll means current bankroll
minus pending exposure; `CURRENT` uses the full current bankroll. Betting
settings do not store bankroll balances or currency. Stake amounts use the
active `BankrollProfile` currency, defaulting to EUR until bankroll setup.

`BettingSettings` has a unique `userId` index. API requests always use the
authenticated user context and reject client-supplied `userId`, balances, or
currency fields.

## Kelly Recommendation Snapshots

Game Analyzer Phase 1 calculates Kelly recommendations from the displayed model
probability and selected market odds, then combines the result with Betting
Settings and the bankroll summary.

The Full Kelly formula for decimal odds is:

```text
fullKellyFraction = (decimalOdds * modelProbability - 1) / (decimalOdds - 1)
```

The analyzer scales Full Kelly by the selected mode, applies
`maximumStakePercent`, suppresses recommendations below `minimumEdgePercent`,
selects `AVAILABLE` or `CURRENT` bankroll according to the setting, and rounds
the final currency amount down to the configured increment.

Saved bets can store an optional `kellyRecommendation` snapshot with fields such
as `recommendedStakePercent`, `recommendedStakeAmount`, `fullKellyPercent`,
`appliedKellyFraction`, `maximumStakePercent`, `minimumEdgePercent`,
`bankrollBasis`, `bankrollAmountAtRecommendation`, and
`bettingSettingsSnapshot`. The snapshot is audit metadata only. The user's
actual `stake` remains separate, editable, and never overwritten
automatically.

If bankroll is not initialized, Game Analyzer can still show Kelly percentages
but does not create a fabricated currency amount. NHL Edge never places bets
automatically.

Known limitations: Kelly recommendations are only as reliable as the model
probability estimates they use, and model probabilities may be uncertain.

## Rating Engine Settings

Power Rating Engine settings are user-specific. Changes affect future rating
updates only. Previously processed games are not recalculated. Changing settings
does not alter existing
`ProcessedRatingGame` snapshots, Rating History, saved bets, historical
analyses, or Rating Lab replay defaults and simulation behavior.

Base Model Calibration uses the calibrated Base Model v1 reference values as
editable experimental inputs. User-saved production changes do not silently
change Rating Lab inputs, and calibration does not write settings or recalculate
stored history.

`homeAdvantage` in these settings is the global Base Home Advantage. Team Power
Ratings expose `homeAdjustment`, a team-specific adjustment that defaults to
`0`. Production live updates use:

```text
effectiveHomeAdvantage = Base Home Advantage + home team Home Adjustment
```

For backward compatibility, the team-level adjustment is still stored in the
PowerRating collection's existing `homeAdvantage` field, but API responses and
requests use `homeAdjustment`.

Authenticated endpoints:

- `GET /api/settings/rating-engine` returns the current user's settings and
  whether defaults are being used.
- `PUT /api/settings/rating-engine` creates or replaces the current user's
  settings. Current clients include all fields; legacy payloads without
  `probabilityScale` or `maximumGoaliePenalty` preserve an already-saved value
  or receive the calibrated default.
- `POST /api/settings/rating-engine/reset` accepts an optional `scope` of
  `engine`, `model-adjustments`, or `all`. This keeps each Settings reset button
  within its visual section.

Default values:

```json
{
  "kFactor": 1.3,
  "homeAdvantage": 3.5,
  "maximumGoaliePenalty": -4,
  "probabilityScale": 20,
  "regulationMultiplier": 1,
  "overtimeMultiplier": 0.4,
  "shootoutMultiplier": 0.1
}
```

These values come from the centralized production Base Model v1 configuration.
They are the calibrated Phase 1 baseline from Rating Lab replay across the
2023â€“24, 2024â€“25, and 2025â€“26 regular seasons (approximately 3,936 games).
They are reference defaults, not a claim of statistical optimality or
guaranteed predictive performance.
Its calibrated starting-rating reference is `42` to `50`, centered at `46`,
with total spread `8`. Existing live ratings, processed games, and rating
history are never rewritten when the defaults change. The current Power Rating
collection initializer intentionally inserts missing live teams at the neutral
legacy value `50` because production has no safe season-specific team ordering
source; it does not fabricate a `42` to `50` ordering or initialize a season.
The calibrated range is used where an explicit fixed-spread starting procedure
exists, including Rating Lab.

Validation ranges:

- `kFactor`: greater than `0` and no more than `10`
- `homeAdvantage`: `0` to `15`
- `maximumGoaliePenalty`: `-5` to `0`; goalie adjustments must be at least the
  configured value and no more than `0.00`
- `probabilityScale`: `1` to `50`; values must be finite. These conservative
  production bounds prevent zero, negative, NaN, Infinity, and extreme scales
  from breaking probability calculations.
- `regulationMultiplier`: `0` to `2`
- `overtimeMultiplier`: `0` to `2`
- `shootoutMultiplier`: `0` to `2`

Team-level `homeAdjustment` values are validated between `-5` and `5`.

Existing settings documents are normalized per field: explicitly saved valid
values are preserved, while only absent or unusable fields receive calibrated
defaults. This is read/update compatibility, not a bulk migration, and it does
not trigger replay or touch processed rating records.

## Rating Lab Base Model Calibration (Phase 1)

Rating Lab has an authenticated, production-isolated calibration workflow:

- `GET /api/power-rating-simulations/calibration/options` returns historical
  regular-season boundaries, the calibrated Base Model v1 references, the
  production probability formula, and each season's persistent dataset
  readiness.
- `POST /api/power-rating-simulations/calibration/historical-seasons/:seasonId/prepare`
  prepares or resumes one completed regular season. `{ "refresh": true }` is
  the explicit maintenance path for an already-ready old season.
- `POST /api/power-rating-simulations/calibration/run` runs one experimental
  configuration against one or more completed historical seasons. A custom date
  range is accepted only for a single selected season.

The run endpoint rejects client-provided identity fields and always reads Power
Ratings and settings with the authenticated `userId`. It requires a complete,
finite set of current Power Ratings when the selected start source requires it.
Current starting values use production `baseRating` and are rejected for
cross-season calibration because they can leak present-day strength into older
seasons. Every fixed-spread multi-season run uses the deterministic
`FIXED_SPREAD_ALPHABETICAL` policy for every evaluated season, including the
latest completed season. The result exposes the policy, human-readable label,
ordering source, and deterministic starting-state signature. Single-season
Advanced Lab runs retain current-rating values and current-ordered fixed spreads
for scenario exploration, but label those modes non-comparable to the
leakage-safe multi-season reference.

Historical calibration data is shared infrastructure, not user-owned data.
`HistoricalNhlGame` stores one completed regular-season game per globally unique
NHL game ID, including canonical franchise identity, scores, final state, and
explicit regulation/overtime/shootout result type. `HistoricalSeasonDataset`
stores the inclusive season boundaries, expected and persisted counts, status,
completed seven-day windows, skip diagnostics, attempt timestamps, and safe
error code. Neither collection has a `userId`, and production Dashboard,
Analyzer, market, game-context, and live Power Rating update paths do not read or
write these collections.

Calibration reads MongoDB first. A `ready` season is loaded locally with no NHL
request and has no automatic TTL refresh. A missing or partial season is fetched
through the central NHL schedule service in sequential seven-day windows, never
per team or per game. Every successful window is validated, safely upserted, and
checkpointed before the next provider call. Concurrent requests for the same
season share one import, while different selected seasons use one conservative
queue. A provider 429 pauses the queue immediately; prior windows remain stored
and Resume begins at the first missing window rather than restarting the season.

Readiness requires all date windows, unique valid games inside the official
boundaries, games on both the first and last regular-season dates, and at least
1,250 completed games for a modern season. Counts such as 1,307/approximately
1,312 are valid when the boundaries and validation checks pass. A smaller set
remains `partial` and is never ranked as complete. Multi-season loading reads
dataset metadata and selected games in bulk, then sorts in memory. The replay
loop itself performs no database or NHL calls.

The complete in-memory rating state is reset before every replay, so ratings
never carry across season boundaries. Each home-win probability is calculated
before its game's rating update. Phase 1 uses only:

```text
1 / (1 + exp(-(homeRating + homeAdvantage - awayRating) / probabilityScale))
```

The production probability scale defaults to `20`; calibration may vary it
explicitly without changing production Settings. The calibrated references are
starting range `42` to `50` (center `46`, spread `8`), Home Advantage `3.5`, K
`1.3`, regulation `1.0`, overtime `0.4`, and shootout `0.1`. Team home
adjustments, manual
adjustments, goalie, lineup, injury, rest, travel, and Analyzer inputs are not
included.

Responses include games found/included/skipped with reason counts, Brier score,
clipped binary log loss, weighted expected calibration error, calibration and
favorite-confidence buckets, accuracy context, prediction distributions,
warnings, and a constant-center invariance diagnostic. Pooled metrics are
calculated from the combined prediction records, not by averaging season-level
scores. The aggregate also reports unweighted average season Brier, best and
worst season, Brier range and population standard deviation, plus per-season
metrics, baselines, temporary final spread, metadata source, and ordering source.
Coverage includes every requested canonical `YYYYyyyy` season ID with status,
inclusive boundaries, source, found/included/skipped counts, safe failure code,
and user-facing message. Only completed seasons contribute pooled predictions.
Final temporary team ratings remain single-season output; they are not combined
into a cross-season simulation.

Stability is descriptive: `stable` requires Brier range at most `0.010` and
standard deviation at most `0.005`; `mixed` requires range at most `0.020` and
standard deviation at most `0.010`; other results are `unstable`. Counts of
seasons beating each sanity baseline are included. A run with fewer than two
successful seasons is `not_assessed`. These thresholds are not a
  statistical significance claim. Preparation and per-season loading are
  sequential; failed seasons are reported safely while successful local results
  remain available and aggregate coverage is marked incomplete. A modern full
  season with fewer than 1,250 included completed games is reported as incomplete
  historical data instead of being ranked as a completed calibration.

Season identifiers and display labels are converted centrally; the internal and
provider format is canonical `YYYYyyyy`. Inclusive regular-season boundaries
come from tested explicit metadata, while the current-season context uses the
central season service and its 12-hour cache. Metadata discovery does not fetch
club schedules. Fallback responses use the exact warning `Season dates loaded
from tested fallback metadata.` Only completed historical seasons are exposed to
Rating Lab.

Every run also returns two dataset-only sanity baselines. The `constant50`
baseline predicts `0.50` for every included game. The
`historicalHomeRate` baseline first calculates the included dataset's home-win
rate and then uses that constant probability for every game. Both report Brier
score and log loss without updating ratings. Run results identify whether their
Brier score is better than, equal to, or worse than each baseline. Runs worse
than the home-rate baseline, or with ECE above ten percentage points, receive
diagnostic warnings without recommending a production change.

ECE is calculated as `sum((bucketGames / includedGames) * absoluteGap)`, where
`absoluteGap` is the difference between the bucket's average predicted home-win
probability and actual home-win rate. Brier, log loss, and ECE are
lower-is-better; winner accuracy is context only.

Adding a constant to every team rating should not affect probabilities because
the formula uses rating differences. Spread controls the initial differences,
probability scale controls how sharply those differences translate to
probability, home advantage shifts the home side, and K controls subsequent
rating sensitivity. A `37–55` scale is therefore not inherently right or wrong:
its suitability depends on those parameters together and on historical
calibration.

Calibration imports no write workflow and creates no Power Rating, history,
settings, or processed-game records. Results are not persisted and never apply
to production automatically. Game-specific adjustment calibration and automatic
parameter optimization are intentionally deferred beyond Phase 1.

## Rating Lab Team Home Advantage Calibration (Phase 2)

Phase 2 is exposed through authenticated endpoints under
`/api/power-rating-simulations/home-advantage`. It reads the shared
`HistoricalNhlGame` and `HistoricalSeasonDataset` collections and never reads
or writes production Team Home Adjustments, rating-engine settings, processed
rating history, or live Power Ratings.

The current planning ranking pools all completed regular-season games from
2023–24, 2024–25, and 2025–26 before calculating each franchise's home and away
Points % and Win %. Home Points Advantage (`Home P% - Away P%`) is the primary
ranking measure and uses its full unrounded value; Home Win Advantage
(`Home W% - Away W%`) is diagnostic only. The `home-points-local-gap-v1`
classifier starts from rounded one-third and two-third target ranks and searches
within ±3 ranks for the largest meaningful adjacent Home Points Advantage gap.
Adjacent values separated by at most `0.001` in proportion terms (0.1 percentage
points) are an effective-tie cluster and are never split. When no local gap is
clearly preferable, the closest valid cut is selected deterministically. The
minimum size of each tier is `min(6, floor(teamCount / 3))`, so a 32-team league
uses six as its safeguard but tier sizes otherwise vary with the data.

Arizona Coyotes (`ARI`), Utah Hockey Club, and Utah Mammoth records resolve to
the current `UTA` franchise through `nhlTeamIdentity`. This is the established
franchise-continuity mapping; no unrelated franchises are combined.

Historical evaluation is leakage-safe. The 2023–24 target freezes tiers from
2020–21 through 2022–23, 2024–25 uses 2021–22 through 2023–24, and 2025–26 uses
2022–23 through 2024–25. Consequently the complete backtest requires prepared
datasets for 2020–21 through 2025–26. The shortened 2020–21 season uses its 868-game
expected size and a matching plausibility floor. Missing seasons are prepared
through the existing historical dataset importer.

Every target-season snapshot runs that same gap-aware classifier independently,
stores its boundary diagnostics and variable tier sizes, and freezes its team
assignments before replay. Current-window boundaries are never reused for a
historical target, and target-season results cannot affect their own snapshot.
Backtest comparisons include the tier sizes used by each target season.

The control is Base Model v1: starting range 42–50 centered on 46, probability
scale 20, Base Home Advantage 3.5, K 1.3, and result multipliers 1.0 / 0.4 /
0.1. Symmetric tier magnitudes 0, 0.25, 0.50, 0.75, and 1.00 are compared, with
an optional custom magnitude. Strong receives `3.5 + X`, Normal remains `3.5`,
and Weak receives `3.5 - X`; only the home team's tier affects a game.

## Home Adjustment Migration

Older PowerRating records may contain the previous team-level default value of
exactly `2.5` in the compatibility storage field. To inspect affected records,
run:

```bash
npm run migrate:home-adjustments
```

To migrate only those exact old defaults to the new `0` Home Adjustment, run:

```bash
npm run migrate:home-adjustments -- --confirm
```

The migration is idempotent and does not run automatically.

## Pre-Auth Test Data Cleanup

The auth migration does not delete data on startup. To inspect pre-auth
user-specific test data that lacks `userId`, run:

```bash
npm run cleanup:pre-auth-data
```

To delete only those pre-auth `bets`, `injuries`, and `powerratings` documents,
and remove obsolete global unique Power Ratings indexes, run:

```bash
npm run cleanup:pre-auth-data -- --confirm
```

Do not run the cleanup until the affected collection counts have been reviewed.

## Rating Lab Phase 3: Schedule & Context

`GET /api/power-rating-simulations/schedule-context/options` reports prepared
season readiness, production schedule-rule definitions, and the authenticated
user's persisted Quick Rematch values (or the canonical defaults when no record
exists). `POST /api/power-rating-simulations/schedule-context/run` loads each
selected prepared `HistoricalNhlGame` season once, precomputes all schedule
facts, and replays candidates chronologically in memory. The replay never calls
an NHL provider, writes ratings or simulation output, or changes Settings.

Phase 3 uses `nhlSeasonIdentity.normalizeSeasonId`, the shared
`historicalNhlDataService.loadPreparedSeasons` reader, and Base Model
Calibration's `prepareDataset` eligibility filter. The stored-game reader shape
uses canonical `season`, nested home/away teams and scores, and
`gameOutcome.lastPeriodType`; Phase 3 does not require duplicate top-level
`seasonId` or `resultType` fields. Its minimum historical inputs are the season,
game ID, replay date/start time, regular-season game type, final/off state,
resolvable home and away team identities, final scores, and supported
regulation/OT/SO result metadata. Rest days, back-to-back, 3-in-4, travel, and
Quick Rematch fields are not stored prerequisites; they are derived from the
chronological games in memory.

Every successful run reports per-season historical eligibility counters under
`diagnostics.historicalEligibility`: loaded, season-matched, regular-season,
completed, valid-team, valid-result, skipped, and eligible counts plus safe skip
reason totals. A zero-eligible response returns the same counters in structured
error details. Zero schedule-context or Quick Rematch occurrences remain a
valid replay result as long as historical games themselves are eligible.

The control is calibrated Base Model v1 with Team Home Advantage and all
schedule adjustments disabled. Phase 3A treats 3 Games in 4 Days,
Back-to-Back, and Back-to-Back + Travel as its primary Rest & Fatigue rules.
They are swept independently against zero and remain mutually exclusive under
the production priority Back-to-Back + Travel > Back-to-Back > 3 Games in 4
Days > Well Rested. Well Rested remains available under Optional Experiments,
but is excluded from combined replay unless the request explicitly opts in.
Combined replay carries that enabled state separately from the numeric value:
when disabled, Well Rested is fixed at zero and removed from applied precedence.
Diagnostics report matched and applied counts separately, so historical Well
Rested detections remain visible without being labeled as adjustments.

Phase 3B uses `gameContextRules.buildQuickRematchContext`, the same detector as
production. For each target game it considers only the most recent earlier
head-to-head, measures the selected Max Days as elapsed 24-hour periods, and
applies the adjustment once to the previous loser's rating. Regulation,
overtime, and shootout losses are treated equally. The target result and future
games cannot affect eligibility. The standard grid is five windows (3, 5, 7,
10, and 14 days) by four adjustments (0, +0.10, +0.25, and +0.50). Zero is
reported as one disabled baseline rather than five redundant rows; optional
custom windows from 1 through 30 days and adjustments from 0 through +1.00 are
supported.

The final Combined Schedule & Context replay uses only the manually submitted
Rest & Fatigue and Quick Rematch values. Rest & Fatigue remains exclusive and
Quick Rematch is additive. Independently ranked sweep winners are never copied
into the final candidate automatically. Results include occurrence counts and
rates, games affected, pooled Brier/log loss/ECE/accuracy, baseline deltas,
per-season diagnostics, stability, and combined context counts. Small samples,
negligible changes, and inconsistent seasons are diagnostic only; there is no
production Apply workflow.

Base Home Advantage remains stored once in `RatingEngineSettings`, with Rating
Model as its user-facing save owner. Special Teams production mode, threshold,
and magnitude are shown in Game Context. Both UI groups use the existing scoped
model-adjustment endpoint while preserving the other group's saved values; the
scoped Power Rating Engine save updates only K, result multipliers, and
probability scale.

## Rating Lab Phase 4: Special Teams Matchup Calibration

Phase 4 is exposed through authenticated, production-isolated endpoints:

- `GET /api/power-rating-simulations/special-teams/options`
- `POST /api/power-rating-simulations/special-teams/historical-seasons/:seasonId/prepare`
- `POST /api/power-rating-simulations/special-teams/reference-seasons/:seasonId/prepare`
- `POST /api/power-rating-simulations/special-teams/run`

Target game seasons remain in the shared `HistoricalNhlGame` and
`HistoricalSeasonDataset` collections. The minimum additional dataset is one
shared `HistoricalSpecialTeamsSeason` document per completed reference season.
It stores team-season PP goals, PP opportunities, PP%, times shorthanded,
power-play goals allowed, and PK%. Preparation makes one bounded season-level
power-play and penalty-kill report load, persists the normalized result, and is
safe to retry. Prepared replay reads those documents once and performs no NHL
provider calls or per-game database queries.

The default target seasons are 2023-24, 2024-25, and 2025-26. Their required
frozen references are respectively 2020-21 through 2022-23, 2021-22 through
2023-24, and 2022-23 through 2024-25. A target season is never included in its
own reference. All three predecessor datasets must be ready; partial windows
are reported and excluded from pooled comparison rather than falling back to
end-of-target-season data. Arizona and Utah rows resolve through the canonical
UTA franchise identity.

PP rank sorts higher PP% first and PK rank sorts higher PK% first. Exact ties
receive the same deterministic competition rank. Three-season ranks average
the three completed regular-season percentages, matching the production alert
concept. Matchup classification calls `shared/specialTeamsMatchups.js`, the
same detector imported by Dashboard and Game Analyzer, so positive, negative,
neutral, unavailable, dynamic league boundaries, and `rankGap` are identical.

One standard run evaluates Top/Bottom N values 4, 6, 8, and 10 against symmetric
rating magnitudes 0, 0.25, 0.50, 0.75, and 1.00 (20 combinations). One optional
custom integer N from 2 through 12 can be added. Each team is evaluated
independently: positive is +X and negative is -X, so both teams may receive
opposite adjustments in one game. Phase 4 does not independently optimize PP
and PK, use continuous rank-gap weighting, or combine contextual layers.

The control is canonical Base Model v1: ratings 42-50 centered at 46,
probability scale 20, Base Home Advantage 3.5, K 1.3, and result multipliers
1.0/0.4/0.1. Results report pooled Brier as the primary metric, log loss, ECE,
accuracy, average and worst-season Brier, stability, baseline deltas,
per-season scoring, positive/negative occurrences, games affected, both-team
signals, signal-side expected versus actual win rates, and rank-gap diagnostics.
Frozen rankings and their source identities are returned for audit.

Phase 4 is experimental. It never reads or writes production Special Teams
Settings, writes Power Ratings or history, changes Dashboard or Analyzer
probabilities, or applies a result to fair odds. Production uses its independently
persisted mode, threshold, and magnitude; Alert only remains the default.

## User data reset lifecycle

All reset routes are below `/api/settings`, run after the normal authentication
middleware, and derive their only user scope from `request.user.id`:

- `POST /reset/settings` restores canonical settings defaults.
- `POST /reset/new-season` prepares current-season operational state for a new
  season.
- `POST /reset/factory` requires `{ "confirmation": "RESET" }` and restores
  the authenticated user to a fresh data state.

`services/userDataResetService.js` coordinates each multi-collection operation
inside a Mongoose transaction and returns a structured result with reset type,
affected-record counts, preserved scopes, and a concise message. Successful
operations write a server log entry containing only reset type, authenticated
user ID, timestamp, and counts. Missing records are treated as zero-count
successes, so every reset is idempotent.

Settings reset removes the user's persisted `RatingEngineSettings`,
`QuickRematchSettings`, `BettingSettings`, `BookmakerPreferences`, and
`PowerRatingSettings` documents. Reads then resolve through the same canonical
defaults used for a new user. It does not modify bets, bankroll data, ratings or
history, injuries, game contexts, or historical datasets. This restores the
Starting Rating Scale to `42–50`.

New-season reset preserves every settings document and reads the current
Starting Rating Scale before resetting each current team to that scale's center.
It clears the authenticated user's current-season `ProcessedRatingGame`
records, all operational `Injury` records, and persisted `GameContext` rows.
Deleting the current-season processed markers unlocks the scale lifecycle for
preseason editing. Bets, settled outcomes, bankroll state/history, team-level
goalie configuration, settings, and all Rating Lab history remain unchanged.

Factory reset removes the user's settings, bets, bankroll profiles and
transactions, Power Ratings and processed history, injuries, game contexts,
goalie adjustments, team goalie lists, team lineups, and Rating Lab promotion
audit records. It does not delete the
`User` account. It also deliberately never references the global
`HistoricalNhlGame`, `HistoricalSeasonDataset`, or
`HistoricalSpecialTeamsSeason` models, so shared NHL data and provider caches
survive every user reset. Supplying any client `userId` has no effect on scope.

## Rating Lab controlled production promotion

Completed Model Calibration runs that use `CURRENT_PRODUCTION` keep a trusted,
user-scoped in-memory analysis context for 30 minutes. A reviewed, completed,
directly comparable Team Home Advantage, Rest & Fatigue, Quick Rematch, Special
Teams, or supported `COMBINED` candidate can enter the separate promotion
command path:

- `POST /api/power-rating-simulations/model-calibration/promotion/preview`
  accepts only `runId` and `candidateId` and performs no writes.
- `POST /api/power-rating-simulations/model-calibration/promotion/apply`
  accepts only the server-issued `promotionPreviewId`.

Base Model parameters, starting ratings, injuries, goalies, motivation, and
manual Analyzer values are not promotable. Metrics, ranking, shortlist state,
and robustness results never grant eligibility. When robustness exists, the
preview carries only its concise completed summary; it is not rerun.

The stale-state identity is the frozen replay-relevant baseline: Base Model
version/parameters plus Team Home Advantage, Rest & Fatigue, Quick Rematch,
and Special Teams. Goalie and injury guardrails and other unrelated user data
are excluded. This is narrower than the diagnostic full production snapshot
ID, so an unrelated guardrail edit does not invalidate promotion. Every
preview binds the authenticated user, frozen identities, candidate signature,
current relevant-state identity, and exact diff. Previews expire after 10
minutes and are single-use.

Apply opens a MongoDB transaction, re-reads and revalidates the relevant state,
uses the existing settings/rating services with the transaction session,
reads the affected families back, and creates one immutable
`RatingLabPromotionAudit` record before commit. Multi-family writes therefore
commit together or roll back together. No-op previews, ordinary validation
failures, stale attempts, and transaction failures do not create audit records.
Settings reads are not cached, so Dashboard, Analyzer, Settings, and later
calibration snapshots resolve the committed values directly without a separate
Rating Lab cache.

## Rating Lab promotion history and final workflow

Rating Lab now follows one completed workflow: Historical Replay remains a
separate replay tool; Model Calibration proceeds through Calibration →
Shortlist → Robustness Analysis → Controlled Promotion; Promotion History is
the durable read-only audit view; and Advanced Labs retain specialist research
and diagnostic workflows.

Promotion history reads the immutable `RatingLabPromotionAudit` collection:

- `GET /api/power-rating-simulations/model-calibration/promotions` returns the
  authenticated user's newest records first, with a default limit of 20, a
  maximum of 50, and an opaque load-more cursor.
- `GET /api/power-rating-simulations/model-calibration/promotions/:promotionId`
  returns one user-scoped historical diff and its concise provenance and
  robustness summary.

These endpoints return deliberate DTOs, never expose MongoDB or user metadata,
and perform no production or audit writes. Historical before/after values come
only from the audit record; production settings repositories remain the source
of truth for current configuration. Factory Reset removes these user-owned
audits as part of the established reset lifecycle.

Production promotion remains explicit, and Base Model promotion is unsupported.
Calibration contexts, robustness results, and promotion previews remain
single-process in-memory state and do not survive server restart; durable
promotion history does. Rating Lab includes no optimizer, automatic tuning,
automatic candidate selection, or automatic promotion.
