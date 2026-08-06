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
player ID, with a model adjustment from `-5.00` to `+5.00` in `0.05`
increments plus an optional note and nullable active override. A provider
goalie with no mapping has an implicit `0.00` adjustment and creates no
database record. The API never accepts a client-provided owner ID, and the
`{ userId, teamId, nhlPlayerId }` mapping is unique.

Legacy user-maintained goalie documents remain readable for compatibility.
Rows with a valid NHL player ID are normalized onto matching current provider
goalies; unmatched manual rows are excluded from current roster choices.
Historical game-context and bet snapshots retain legacy status values and are
normalized for display without being rewritten.

Game-specific starting-goalie selections live in the existing `GameContext`.
Selections snapshot the provider goalie identity, team default, any game
override, effective adjustment, display name, and source. Custom and unknown
selections remain game-specific. Later adjustment edits therefore do not
rewrite saved game contexts or bet snapshots.

Injury records can be explicitly flagged with `isGoalie`. Flagged records stay
visible and count as active injury records, but their point impact is excluded
from the regular injury aggregate so the Analyzer goalie adjustment is not
counted twice. Legacy injury records are not guessed or reclassified.

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

Protected endpoints:

- `GET /api/teams/:teamId/model-values` returns the current user's saved values
  or a fixed empty four-line/three-pair shape.
- `PUT /api/teams/:teamId/model-values/lines` upserts four optional forward
  lines, three optional defense pairs, and one optional plain-text lineup note.
- `DELETE /api/teams/:teamId/model-values/lines` clears positions and the note.

Selections store NHL player IDs, not authoritative player names. Current
provider forwards validate forward slots and current provider defensemen
validate defense slots. Previously saved IDs remain readable and may be saved
unchanged if a player later disappears from the provider roster, allowing the
client to display an unavailable-player fallback and let the user clear or
replace it.

Team Model Values are personal notes only. They are not read by Power Ratings,
Dashboard, Game Analyzer, Game Context, injuries, goalie adjustments,
special-teams calculations, Bet Candidate logic, Kelly sizing, or saved bets.
Phase 1 has no PP/PK units, automatic lineup feed, historical versions,
game-specific lineups, or lineup automation. Provider goalie adjustments
remain a separate persisted feature and retain their existing model effects.

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
  settings. The request must include all fields.
- `POST /api/settings/rating-engine/reset` deletes the current user's persisted
  settings so the centralized defaults are used.

Default values:

```json
{
  "kFactor": 1.2,
  "homeAdvantage": 4,
  "regulationMultiplier": 1,
  "overtimeMultiplier": 0.7,
  "shootoutMultiplier": 0.5
}
```

Validation ranges:

- `kFactor`: greater than `0` and no more than `10`
- `homeAdvantage`: `0` to `15`
- `regulationMultiplier`: `0` to `2`
- `overtimeMultiplier`: `0` to `2`
- `shootoutMultiplier`: `0` to `2`

Team-level `homeAdjustment` values are validated between `-5` and `5`.

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
