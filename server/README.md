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
- `/api/settings/rating-engine`

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

## Manual Power Rating Updates

Authenticated users can apply completed NHL regular-season games to their
persisted current Power Ratings with:

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

History records are audit snapshots. Changing current Power Rating Engine
settings affects only future manual updates and does not rewrite prior
`ProcessedRatingGame` records. Older audit records may not contain every
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

## Rating Engine Settings

Power Rating Engine settings are user-specific and control future live rating
updates only. Changing them does not recalculate already processed games, does
not alter existing `ProcessedRatingGame` snapshots, and does not change Rating
Lab replay defaults or simulation behavior.

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
