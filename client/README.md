# NHL Edge Frontend

## Manual Power Rating Updates

Authenticated users can manually update persisted Power Ratings from the Power
Ratings page.

1. Open `Power Ratings`.
2. Select `Update Power Ratings`.
3. Review or adjust `Date From` and `Date To`.
4. Select `Run Update`.

The update panel defaults to the last seven local calendar days through today.
Date inputs use `YYYY-MM-DD`, cannot be in the future, and are limited to a
small manual range for normal use.

Manual updates are idempotent. Completed NHL regular-season games that already
have `ProcessedRatingGame` audit records for the current user are reported as
already processed and are not recalculated. New eligible games are processed
chronologically using the user's current production Power Rating Engine
settings. Rating Lab stays independent.

If one or more games are processed, the page refreshes the Power Ratings list
and summary cards without a full browser reload. The update result also shows
games found, already processed, processed, skipped, errors, and compact
per-game rating changes when available.

## Power Rating Update History

Authenticated users can inspect persisted update audit records from
`Power Ratings` by switching from `Team Ratings` to `Update History`.

Update History shows user-specific `ProcessedRatingGame` records created by the
manual update workflow. Records are immutable audit entries: changing current
Power Rating Engine settings does not alter prior snapshots, and the history
view does not edit, delete, roll back, or reprocess games.

Supported filters:

- `Season`
- `Date From`
- `Date To`
- `Team`
- `Result Type`: All, Regulation, Overtime, Shootout

The default History view selects the current NHL season. Season labels use
hockey-season formatting such as `2026–27`; raw IDs such as `20262027` are not
shown in the UI. Selecting a named season fills `Date From` and `Date To` with
that regular-season range and leaves the date inputs visible but disabled so the
represented range is clear.

`All seasons` removes date filtering while preserving Team and Result Type.
`Custom date range` enables `Date From` and `Date To` and keeps the existing
date validation, including future-date and Date From after Date To checks.
`Clear Filters` resets Team and Result Type to All and returns Season to the
current season.

Season boundaries come from the authenticated
`/api/power-ratings/history/seasons` API. The backend derives boundaries from
NHL API regular-season club schedules when available. If live season metadata
cannot be loaded, it returns a centralized fallback table with a warning; the
history page still allows `Custom date range` and `All seasons`.

During the offseason, the backend marks the upcoming regular season as current
once the prior regular season has ended and reliable season metadata or fallback
metadata is available.

The view loads paginated records instead of fetching the entire audit
collection. Season, Team, Result Type, and custom date filters are preserved
while using Previous and Next, and the row count selector changes only the page
size for the current query.

Each history row shows game date, matchup, final score, result type, both team
rating transitions, and signed rating changes. `View calculation details`
expands the stored audit snapshot, including engine settings and home-advantage
inputs when available. Older records may have partial audit details; unavailable
legacy fields are labeled without rewriting historical records.

## Bet Tracker Bankroll

Bet Tracker includes a Phase 1 bankroll section above the saved-bets summary.
Before use, the page shows a setup form for Starting Balance, Start Date, and
Currency. The starting balance becomes the first ledger transaction; existing
historical bets are not imported automatically.

After initialization, summary cards show Current Bankroll, Available Bankroll,
Betting Profit, Pending Exposure, Deposits, and Withdrawals. Current Bankroll is
the full transaction-ledger balance. Available Bankroll subtracts pending stake
exposure. Betting Profit is separate from deposits and withdrawals so cash
movement does not inflate model performance.

The period selector supports All time, available NHL seasons, and custom date
ranges using the same season metadata conventions as Power Rating Update
History. Named seasons fill and lock the date fields; Custom dates enables them
with the usual future-date and inverted-range validation. The ledger can also
be filtered by transaction type and paged with the row-count selector.

Deposits and withdrawals are recorded from compact inline forms. Withdrawals are
validated client-side and server-side against current bankroll; the backend is
authoritative for insufficient-funds errors.

Settled saved bets synchronize into the bankroll ledger from the server. Editing
a settled result or stake updates the related settlement transaction, moving the
bet back to pending removes it, and deleting the bet removes the settlement.

Scheduling, cron jobs, bankroll charts, Dashboard bankroll widgets, and Kelly
staking remain intentionally deferred.
