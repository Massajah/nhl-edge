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
- `/api/bets`
- `/api/injuries`
- `/api/power-ratings`
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

The update workflow is idempotent per user: processed games are recorded in
`ProcessedRatingGame`, and rerunning the same range reports already-processed
games without applying duplicate rating changes. Scheduling is intentionally
deferred for this phase; future cron or job-runner work should call the same
rating update service.

Production update engine settings are centralized in
`services/ratingEngineSettingsService.js`.

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
