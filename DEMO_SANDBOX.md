# Demo Sandbox Phases 1–2

`POST /api/auth/demo` creates a new `User` with explicit
`accountType: DEMO_SANDBOX`, a collision-safe MongoDB ObjectId and no email,
password or Google identity. Creation, default Power Rating initialization,
and the mutable Phase 2 seed commit in one transaction. The normal opaque,
hashed auth-session cookie is
used, but its expiration is capped at the sandbox expiration.

Existing users are `NORMAL` by schema default. Production account queries also
accept a missing/null historical `accountType` as normal for backward
compatibility. Unknown account types fail closed. No API accepts a client owner
ID or account type for demo creation.

## Lifetime and cleanup

The lifetime is fixed from creation; activity does not extend it. The default
is four hours and `DEMO_SANDBOX_TTL_HOURS` is the single override. At
`expiresAt <= now`, session resolution rejects the sandbox even before cleanup
runs.

The existing Railway five-minute one-shot cron entrypoint runs the idempotent
cleanup service alongside odds and Official T2 jobs. Each candidate must match
both `accountType: DEMO_SANDBOX` and `expiresAt <= now`. Cleanup rechecks that
exact predicate inside a per-account transaction, deletes only the exact
`userId` from the explicit owner-scoped model inventory, deletes that owner's
auth sessions, and deletes the guarded User last. A second run is a no-op.
`DEMO_CLEANUP_BATCH_SIZE` defaults to 100.

The explicit `userId` cleanup inventory is: bankroll profiles and
transactions, bets, betting settings, bookmaker preferences, forward
prediction snapshots, game contexts, goalie adjustments, injuries, Power
Ratings and Power Rating settings, processed rating games, Quick Rematch and
Rating Engine settings, Rating Lab promotion audits, team goalies, and team
lineups. Auth sessions are removed separately before the guarded User deletion.

For a focused operator/development run, use
`npm run cleanup:demo-sandboxes` from `server/`. This is a one-shot command,
not a second scheduled worker or cron definition.

There is intentionally no TTL index on `User`: MongoDB TTL deletion would not
cascade. `AuthSession` retains its existing TTL index as defense-in-depth for
standalone expired session documents, while application cleanup still removes
demo sessions explicitly.

Shared schedules, NHL/team data, historical datasets, odds snapshots, closing
markets, capture runs, quota ledgers, leases, migrations and provider caches
are never cleanup targets.

## Production-data separation

Demo accounts are excluded from the Official T2 user iterator and its final
pre-write account recheck, so they cannot create
`OFFICIAL_T2_AUTOMATIC_V1`. Demo bookmaker preferences are excluded from the
scheduled odds-capture union. Interactive demo odds reads are cache-only: they
may reuse a fresh shared response (or an already in-flight production request)
but cannot initiate a paid provider request, including on refresh.

## Phase 2 mutable sandbox seed

`DEMO_SEED_VERSION = 1` creates the seed only from the new-sandbox creation
path. Each record is owned by that sandbox's `userId`, remains writable through
the normal product endpoints, and is removed by the existing cleanup inventory.
No startup, login, or NORMAL-account path invokes it.

The seed contains the existing 32 default Power Ratings, a EUR 1,000.00
starting bankroll, 24 unlinked sample bets, 10 fictional skater injury records,
and one Bookmaker Preferences document that enables Veikkaus, Unibet FI, and
Coolbet. The bets contain 10 wins, 10 losses, one push, one void, and two
pending moneylines. Settled records use the existing historical-bet settlement
ledger path; the two pending moneylines use transactional stake debits. Their
settled net is EUR -6.00, so current bankroll is EUR 994.00, pending exposure
is EUR 22.00, and available bankroll is EUR 972.00.

Bet `placementId` values and private injury `demoSeedKey` values include the
seed version. Bankroll and bookmaker preferences retain their existing unique
owner constraints and insert-only checks. Re-running V1 for the same owner
therefore does not duplicate records or overwrite visitor changes. Sample bets
deliberately have no NHL provider game ID, so they cannot be mistaken for
official historical games and pending examples cannot initiate game-provider
settlement reads.

## Phase 2 Model Performance sample

`DEMO_PERFORMANCE_DATASET_VERSION = 1` is a shared, deterministic, module-level
read-only dataset. It has 150 generated NHL-like game observations in the
explicit sample season `20242025`, model version `DEMO_SAMPLE_V1`, prediction
definition `DEMO_SAMPLE_MODEL_PERFORMANCE_V1`, and calculation contract
`demo-sample-performance-v1`. It is generated once with stable inputs and an
explicit fixed PRNG seed, then frozen and reused across requests. It contains
no owner IDs or private user information and creates zero per-sandbox MongoDB
documents.

The authenticated server-side `accountType` selects the provider for the same
`GET /api/model-performance` and `GET /api/model-performance/games` routes.
`DEMO_SANDBOX` receives `dataMode: DEMO_SAMPLE`; every production response
receives `dataMode: PRODUCTION`. Client query parameters cannot select the
sample provider. NORMAL and historical-normal accounts keep the original
owner-scoped MongoDB repository and never fall back to sample observations.

The adapter supplies observations—not precomputed KPI answers—to the existing
Brier, paired market Brier, accuracy, calibration, movement, bet-performance,
strict same-book CLV, coverage, pagination, and price-timeline calculations.
Its explicit Capture Health provider reports sample fixture gaps and never
calls the production schedule expectation engine. The UI displays a neutral
`Demo Dataset` banner only when the server response says `DEMO_SAMPLE`.

This fixture is not persisted as `ForwardPredictionSnapshot`, is never named
`OFFICIAL_T2_AUTOMATIC_V1`, is not production forward data, does not enter
scheduled prediction or odds capture, and is not Rating Lab/backtest data.
