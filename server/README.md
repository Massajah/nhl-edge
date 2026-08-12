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
- `GET /api/settings/bookmakers`
- `PUT /api/settings/bookmakers`
- `GET /api/market-odds/nhl?date=YYYY-MM-DD&refresh=true|false`
- `GET /api/market-odds/status`
- `GET /api/teams/:teamId/goalie-adjustments`
- `PUT /api/teams/:teamId/goalie-adjustments/:nhlPlayerId`
- `DELETE /api/teams/:teamId/goalie-adjustments/:nhlPlayerId`
- `PATCH /api/game-context/:gameId/goalies`

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

## Special Teams Matchup Alerts

`GET /api/teams/special-teams` exposes a compact league dataset for Dashboard
and Game Analyzer using only the existing Previous 3 seasons PP/PK averages and
league ranks. The endpoint calls the existing league Special Teams service, so
its provider work, eight-hour cache, stale fallback, and in-flight request
deduplication are shared with the Teams page. It does not add a provider or
perform one upstream request per displayed game or team. The response includes
`leagueTeamCount`, the three source season IDs, and canonical team
abbreviations with 3-season PP and PK ranks.

`RatingEngineSettings` stores two authenticated user-scoped presentation
controls: `specialTeamsAlertsEnabled` (default `true`) and
`specialTeamsRankThreshold` (default `6`, integer range `3–12`). Existing
documents missing either field receive schema/service defaults, while explicit
values are preserved. Model Adjustments reset restores both defaults.

Detection evaluates Away PP versus Home PK and Home PP versus Away PK
independently. Top N PP versus Bottom N PK is positive; Bottom N PP versus Top
N PK is negative. The bottom boundary is calculated as
`leagueTeamCount - N + 1`. Missing or invalid ranks are unavailable rather than
alerts.

This feature is informational only. Its settings and matchup data are not read
by the Power Rating update engine, probability calculation, fair-odds logic,
or historical replay. No automatic Special Teams rating adjustment exists in
this version.

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
are scoped from the authenticated token. When the user already has
`ProcessedRatingGame` history, the service finds the latest processed game
date, backs up by a small overlap, and calls the same chronological update
workflow used by the manual endpoint. Already processed games are skipped by
the existing `userId + gameId` uniqueness rule.

If the user has no processed-game audit baseline, automatic updates return
`status: "requires_initialization"` instead of replaying an arbitrary season on
Dashboard load. The user should run the existing manual update/replay workflow
to choose an initial processing point. Full-season recalculation, cron jobs,
background workers, polling, and automatic replay after setting changes are
intentionally deferred.

Automatic responses include `status` (`updated`, `up_to_date`, `partial`,
`requires_initialization`, or `unavailable`), counts, per-game errors, the
latest processed game when known, and the Rating Engine settings snapshot used
for newly processed games. Concurrent automatic requests share a user-scoped
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

## Bankroll Phase 1

Authenticated users can initialize and track a transaction-based bankroll from
Bet Tracker. The ledger is the source of truth: current bankroll is calculated
from the starting-balance transaction, deposits, withdrawals, and one
idempotent settlement transaction per settled bet. No authoritative
`currentBankroll` field is stored.

Protected endpoints:

- `POST /api/bankroll/initialize` with `startingBalance`, `startDate`, and
  optional `currency` initializes the user once. The starting balance is stored
  as a `STARTING_BALANCE` transaction at the selected start date. Initialization
  does not infer or import older settled bets.
- `POST /api/bankroll/deposits` records positive cash inflow.
- `POST /api/bankroll/withdrawals` records cash outflow. Phase 1 rejects
  withdrawals greater than the user's current bankroll.
- `GET /api/bankroll/summary?period=all-time|season|custom&season&from&to`
  returns initialization status, currency, starting balance, current bankroll,
  betting profit, deposits, withdrawals, cash flow, settled bet count, pending
  stake, available bankroll, and the resolved period.
- `GET /api/bankroll/transactions?page&limit&from&to&type&season` returns a
  newest-first, user-scoped ledger page.
- `GET /api/bankroll/seasons` reuses the centralized NHL regular-season
  metadata used by Power Rating Update History.

Money is stored in integer minor units as `amountCents` and serialized with
both cent and decimal fields. Betting profit uses the existing Bet Tracker
server-side profit calculation rounded to cents for ledger storage. `Current
Bankroll` is the full ledger balance. `Available Bankroll` is current bankroll
minus pending stakes from pending bets on or after the bankroll start date.
`Betting Profit` includes only `BET_SETTLEMENT` transactions for the selected
period; deposits and withdrawals are reported separately as cash flow.

Settled Bet Tracker bets create or update exactly one `BET_SETTLEMENT`
transaction per `{ userId, betId }`. Changing stake or result updates that
transaction, moving a bet back to pending removes it, and deleting a bet removes
the settlement transaction. The unique partial index on
`BankrollTransaction` enforces that idempotency.

To inspect eligible historical settled bets for one user, run:

```bash
npm run backfill:bankroll-settlements -- --userId=<userId>
```

To write settlement transactions after reviewing the dry run, add `--confirm`.
Use `--all` instead of `--userId=<userId>` only when intentionally backfilling
every initialized bankroll. The script never runs automatically.

Phase 1 intentionally does not add bankroll reset, transaction deletion,
charts, Dashboard integration, Kelly sizing, or automatic historical inference.

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
seasons. For the latest historical season, centered fixed-spread starts can use
current `baseRating` ordering. Older seasons use an explicit,
franchise-normalized alphabetical fallback when no historical preseason rating
snapshot exists; that source is returned per season and never presented as a
historical rating estimate.

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

Base Home Advantage remains stored once in `RatingEngineSettings`, but its
user-facing save owner is Model Adjustments. The scoped Model Adjustments save
updates Home Advantage plus the informational Special Teams alert toggle and
rank threshold; the scoped Power Rating Engine save updates only K, result
multipliers, and probability scale.

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
probabilities, or applies a result to fair odds. Production remains
informational alert-only until a result is manually reviewed in a future task.
