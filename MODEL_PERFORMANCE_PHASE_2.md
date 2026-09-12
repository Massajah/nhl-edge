# NHL Edge Model Performance — Phase 2 contract

## Scope and architecture

Phase 2 adds authenticated, read-only, on-demand Model Performance aggregation.
It does not add UI, background aggregation, materialized metrics, new prediction
checkpoints, model changes, or Odds API calls.

The join path is:

1. Select the authenticated owner's immutable `ForwardPredictionSnapshot` cohort.
2. Resolve results at read time from `HistoricalNhlGame`, falling back for missing
   stored games to the existing NHL game-landing helper.
3. Join shared Odds Snapshot v2 `T2` rows by exact game/start/team/season/type
   identity.
4. Join finalized `OddsClosingMarket.finalBookmakers` by the same exact identity.
5. Select the authenticated owner's `Bet` records using the existing period
   convention: `scheduledStart`, or `analyzedAt` only when scheduled start is absent.
6. Calculate metrics in memory for the selected NHL season. No source document is
   mutated.

Shared odds and NHL result data are queried only after the private prediction and
bet scopes have been selected. No client-provided `userId` participates in a query.

## Cohort

The forward cohort is exactly one authenticated owner, one canonical season, the
optional inclusive `from`/`to` date range, one model version, and:

`predictionDefinition = OFFICIAL_T2_AUTOMATIC_V1`

Official snapshots are revalidated against `automatic-prediction-v1`, their exact
game identity, complementary probabilities, fingerprint shape, target time, and
the inclusive 120-to-75-minute capture window. Missing predictions are never
reconstructed.

When season is omitted, the canonical current season from the existing NHL season
service is selected. That service's `endDate` is a regular-season boundary, while
official predictions support playoff game type 3, so the analytical date envelope
runs from canonical season start through July 15 of the ending year. Exact
`seasonId` remains authoritative for prediction and market records; the envelope is
needed for `Bet`, which has no season field. The API exposes both
`regularSeasonEndDate` and `performanceEndDate`. When model version is omitted, the newest owner-scoped
official snapshot within the selected season/range determines it; if there is no
such snapshot, the configured current version (`power-rating-v1`) is reported.
Different model versions are never combined. Fingerprints are not split into
separate V1 aggregates, but `settingsFingerprintCount` and `mixedSettings` expose
whether the version contains multiple settings variants.

## Result semantics

The existing `resolveForwardPredictionResult` contract is authoritative. FINAL and
OFF NHL states with unequal non-negative integer scores resolve normally, including
regulation, overtime, and shootout winners. Pending, postponed/cancelled/suspended,
invalid-score, team/game/season/type mismatch, and scheduled-start mismatch states
remain unscored with explicit reason codes. An old prediction cannot be attached to
a rescheduled start.

`HistoricalNhlGame` is the durable first source. Because that collection currently
contains prepared regular-season history only, a missing row is resolved through
the existing cached NHL game-landing helper. Provider failure is represented as
unavailable rather than failing or mutating the aggregate.

## Forward metrics

- Model Brier uses one home-win event per resolved game:
  `mean((officialHomeProbability - homeWon)^2)`.
- Accuracy selects probabilities strictly greater than 0.5; exact 0.5 is
  `NO_PICK` and excluded from its denominator.
- Calibration uses favorite confidence and fixed lower-inclusive buckets:
  `[.50,.55)`, `[.55,.60)`, `[.60,.65)`, `[.65,.70)`, `[.70,.75)`,
  `[.75,.80)`, `[.80,1.00]`. Empty buckets remain present with null values.
  `calibrationGapPercentagePoints = actualWinRate - averagePrediction`, in
  percentage points. Exact 50/50 is retained at the lower boundary using home as a
  deterministic event-side tie break only for calibration; it remains NO_PICK for
  accuracy.

Unavailable numerical metrics are null, never zero. Counts and coverage percentages
may correctly be zero.

## Market contracts

Each valid bookmaker must supply decimal home and away odds greater than one. Its
home no-vig probability is:

`(1 / homeOdds) / ((1 / homeOdds) + (1 / awayOdds))`

Consensus is the median of bookmaker home no-vig probabilities; away is
`1 - medianHome`, which is mathematically identical to the median of the paired
away probabilities. Raw decimal odds and vigged implied probabilities are never
averaged.

T2 consensus uses immutable schema-v2 `OddsSnapshot` documents whose
`snapshotType` is `T2`. FINAL consensus uses only a finalized closing document's
bookmaker-specific, two-sided `finalBookmakers` rows. `latestSafeBookmakers` is not
substituted, and independently selected `bestFinal.home`/`away` prices never enter
the predictive FINAL consensus.

T2 and FINAL Brier comparisons are paired separately: a row contributes only when
the same game has a resolved result, official model probability, and the applicable
valid market probability. Improvement is `marketBrier - pairedModelBrier`, so a
positive value favors NHL Edge on that paired sample.

Market movement requires model T2, market T2, and market FINAL probabilities. It
compares absolute home-probability distances with a `1e-12` probability tolerance.
`averageDistanceChangePercentagePoints = averageFinalDistance - averageT2Distance`;
negative means closer to the model. This is directional diagnostics, not evidence
that the model beat the market.

## Bets, ROI, and CLV

Bet Performance is independent of the forward model-version cohort. It describes
the authenticated owner's saved bets in the selected season/date period. Pending
bets are excluded from financial metrics. Stored settled `profit` is authoritative.
The ROI denominator is settled stake, including WIN, LOSS, PUSH, and VOID stakes,
matching existing history semantics; PUSH and VOID contribute zero stored profit.

Primary CLV is strict same-bookmaker CLV:

`100 * (betOdds / sameBookFinalOdds - 1)`

Eligibility requires provider odds, a recognized exact bookmaker key, valid odds,
10-digit NHL game linkage, exact scheduled-start match, explicit home/away side,
creation before start, a finalized closing document, and the same bookmaker's safe
pregame `finalBookmakers` row observed strictly after bet creation. There is no
free-text bookmaker inference or fallback to another book.

An optional separately labeled `vs Best FINAL` comparison is calculated only when
the selected-side `bestFinal` entry can be cross-checked against a safe row in
`finalBookmakers`. It never enters average or median CLV.

## API

- `GET /api/model-performance?season=&from=&to=&modelVersion=`
- `GET /api/model-performance/games?season=&from=&to=&modelVersion=&status=&page=&limit=`

Both routes require the existing cookie-backed authentication middleware. The
games endpoint supports `all`, `resolved`, `pending`, `missing_market`, and
`excluded` status filters, defaults to page 1 / limit 20, and caps limit at 100.

Aggregate domains are `metadata`, `cohortDefinition`, `dataQuality`, `coverage`,
`forwardOverview`, `calibration`, `marketComparison`, `betPerformance`, and `clv`.
Game rows contain compact model, result, consensus, distance, completeness,
fingerprint, and owner-bet summary fields. They do not return provider payloads,
odds histories, selected bookmaker lists, or preference provenance.

## Coverage and storage

Forward coverage percentages use official predictions as denominator. Paired Brier
sample sizes use resolved predictions with the applicable market. CLV coverage uses
all relevant owner bets as denominator. Bet ROI uses settled stake only.

No schema, collection, materialized aggregate, worker, cron, or index was added.
Storage growth for Phase 2 is therefore zero beyond code; it reads the existing
Phase 0–1, result, Odds Snapshot v2, closing-market, and bet records on demand.

## Known limitations

- The durable historical result collection currently covers prepared regular
  seasons; current-season and playoff misses rely on the NHL game-landing cache and
  provider availability.
- V1 reports mixed fingerprints but does not filter or split by fingerprint.
- CLV is unavailable for manual odds, legacy bets without exact metadata, and books
  absent from the finalized same-book rows by design.
- The optional Best FINAL comparison is coverage-limited and is not CLV.
- Small samples are returned transparently without confidence intervals, ECE,
  rolling metrics, or backend quality thresholds.

## Phase 3 read-only presentation compatibility

The Phase 3 UI required durable audit values that the original compact games DTO
did not expose. The accepted calculations and capture semantics remain unchanged;
the read-only contract now additionally exposes:

- available canonical seasons and owner-scoped model versions for filters;
- stored official fair odds, base/effective state, and compact adjustments;
- stored Bet-time probability, fair odds, edge, EV, price, stake, result, and
  profit;
- strict same-book FINAL odds plus the separately labeled Best FINAL price; and
- same-book T6/T2 prices and the earliest valid exact-identity schema-v2 price
  found among existing T24/T6/T2 checkpoints.

“Earliest captured market” is deliberately not bookmaker opening odds. It is the
earliest NHL Edge checkpoint already stored for that exact game start, bookmaker,
and selected side. Missing values remain null and are not reconstructed. No odds
observations, provider payloads, new checkpoints, writes, or provider calls were
added.
