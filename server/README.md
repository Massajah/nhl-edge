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
