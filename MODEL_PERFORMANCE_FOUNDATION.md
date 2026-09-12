# Model Performance foundation — Phase 0 and Phase 1

## 1. Architecture chosen

The original `calculateGame` module now lives in `shared/predictionCalculation.js`, using the repository's existing browser/CommonJS export pattern. The browser wrapper and server import the same implementation. The common probability-scale default also comes from that module.

The server assembles automatic inputs from existing private records and NHL services, calculates a prediction, and inserts it once. There is no new prediction HTTP endpoint or browser authority. Existing client input preparation remains in place; migrating that interactive preparation to an endpoint is a later decision. Its automatic-input equivalence is covered by golden fixtures and live-client parity tests.

## 2. Calculation path before and after

Before: Dashboard → `calculatePreliminaryAnalysis` → rating/injury/context/goalie/special-teams input preparation → client `calculateGame`. Analyzer prepares editable inputs and calls the same client function.

After: both browser paths retain their input preparation and call the shared calculation through the original client import path. Scheduled capture → server input loader → existing schedule/context and special-teams services → automatic input adapter → the same shared calculation → immutable repository.

No rating-update equations, adjustment weights, calibration parameters, market comparisons, or betting thresholds changed.

## 3. Files added

- `shared/predictionCalculation.js`
- `server/models/ForwardPredictionSnapshot.js`
- `server/services/automaticPredictionService.js`
- `server/services/forwardPredictionContracts.js`
- `server/services/forwardPredictionInputsService.js`
- `server/services/forwardPredictionRepository.js`
- `server/services/scheduledForwardPredictionService.js`
- `server/tests/automaticPrediction.test.js`
- `server/tests/forwardPredictionCapture.test.js`
- `server/tests/forwardPredictionInputs.test.js`
- `server/tests/fixtures/forwardPredictionFixtures.js`
- `MODEL_PERFORMANCE_FOUNDATION.md`

## 4. Files modified

- `client/src/utils/calculateGame.js`: compatibility export wrapper.
- `client/src/config/baseModel.js`, `server/config/baseModel.js`: common scale default.
- `server/services/ratingEngineSettingsService.js`: expose the existing pure settings serializer.
- `server/scripts/runOddsCaptureCron.js`: run independent prediction and odds jobs in one process.
- `server/services/privateDataModels.js`: register private prediction data.
- `server/services/userDataResetService.js`: factory deletion and explicit new-season preservation.
- `server/services/legacyOwnerMigrationService.js`: avoid reassignment of immutable prediction records.
- `server/tests/legacyOwnerMigration.test.js`, `server/tests/scheduledOddsCapture.test.js`, `server/tests/userDataResetService.test.js`: regression coverage for those integrations.

Pre-existing user edits in `App.css`, `Dashboard.jsx`, and `dashboard.test.mjs` were not edited by this task.

## 5. Snapshot schema

Collection: `forward_prediction_snapshots`.

| Group | Fields |
| --- | --- |
| Identity | Owner ObjectId, NHL game ID, season ID, game type, exact scheduled start, canonical home/away team IDs |
| Contract | Prediction definition, model version, calculation contract version, SHA-256 settings fingerprint |
| Timing | `generatedAt`, `targetAt` |
| Output | Home/away probabilities and fair odds |
| Model state, per side | Stored base rating, final effective rating, goalie player ID when usable, rest/fatigue condition |
| Adjustments, per side | Persistent rating adjustment, effective home advantage, injuries, goalie, rest/fatigue, quick rematch, special teams |
| Effective settings | Only normalized prediction-affecting configuration needed to reproduce the calculation |
| Completeness | Ratings and per-side injury, schedule, goalie, special-teams statuses |

No market odds, provider payloads, UI state, or live result mutations are stored. The settings and applied totals allow the probabilities to be reproduced without current ratings.

Indexes: unique `(userId, gameId, scheduledStartAtCapture, predictionDefinition)`; query `(userId, seasonId, predictionDefinition, generatedAt)`.

The full document is validated before `$setOnInsert`. Query middleware rejects ordinary updates/replacements, existing-document saves are rejected, and the unique index arbitrates concurrent inserts. Database administrators with raw collection access remain outside application-level immutability.

## 6. Exact T2 timing

`OFFICIAL_T2_AUTOMATIC_V1` is eligible when `start − 120 minutes <= generatedAt <= start − 75 minutes`. Both endpoints are inclusive to the millisecond. For a 19:00 start, 17:00:00.000 through 17:45:00.000 qualifies; 17:45:00.001 does not.

Eligibility is checked during planning and again after asynchronous inputs/account checks, immediately before insertion. FUT/PRE, valid regular-season/playoff identity, and a fresh NHL schedule are required. Started, postponed, cancelled, suspended, abandoned, invalid, and late observations are excluded. No retroactive capture path exists.

## 7. Scheduling and integration

The existing `npm run cron:odds-capture` one-shot command now dispatches both jobs. A separate `nhl-edge-forward-prediction-t2` lease uses the existing five-minute slot and lease service. MongoDB connects once and closes after both jobs settle. Fatal job errors are propagated after the other job completes.

There is no new interval, worker loop, or frontend trigger. No Railway configuration or deployment was changed. After a future deployment of this code, the existing configured cron command will run the prediction job automatically.

Structured logs report attempts, captured count, already-captured count, skip reasons, provider/input failures, and final outcome. No prediction-run collection was added. The existing global lease retention applies.

## 8. Eligible users and work size

Stream active users, including legacy accounts with no status field; skip disabled accounts. Require valid stored ratings for both teams. Uninitialized accounts do not get seeded or trigger expensive input loads. Account status is rechecked before insertion.

Only games inside T2 are processed. Existing snapshots are checked before input loading. Private inputs load once per user; public schedule-history and special-teams requests are shared within a run. Processing is sequential per account and suited to the current small application.

## 9. Automatic inputs included

Current stored ratings, persistent team rating adjustment, base plus team-specific home advantage, existing rest/fatigue precedence, B2B, actual venue/travel classification, 3-in-4, enabled well-rested adjustment, quick rematch/revenge, stored active skater injury impacts, usable stored provider-goalie default, and automatic special-teams adjustment.

The stored team `manualAdjustment` is included because Dashboard already treats it as part of effective base strength. This is distinct from the Analyzer's game-specific manual field. Goalie injuries continue to be excluded from skater injury impact by the existing injury service.

## 10. Subjective inputs excluded

Analyzer motivation, X-factor/manual adjustment, extra Analyzer injury adjustment, manual rest/fatigue override, manual quick-rematch override, custom goalies, and provider-goalie manual overrides. A provider goalie's stored team default remains usable even when its game-specific override is excluded.

No automated motivation or new adjustment was introduced.

## 11. Completeness

Missing/invalid team ratings prevent capture. Private database-read failures prevent capture and permit a later attempt; known injuries/settings are never silently replaced after a database error. Missing settings documents use the application's normal configured defaults.

Unavailable optional schedule/special-teams data and unknown/custom/unusable goalies contribute neutral adjustments with explicit statuses. A zero applied adjustment in these cases is model fallback behavior, not a claim that the source measured zero. Injury summaries distinguish `stored_user_data` from unavailable; they do not claim an external feed is complete or recently verified.

Expected/selected goalies can contribute their valid stored default and retain that confirmation status. Missing goalie IDs remain null. Legacy provider selections with valid provider identity/default are supported. A missing saved team-default adjustment is treated as unknown rather than inferred from a potentially manual override.

Stale schedule and special-teams provider fallback responses are unavailable for official capture. A fresh current-game schedule is required; optional history/special-teams outages remain explicitly neutral.

## 12. Version and fingerprint

`modelVersion = power-rating-v1`; `calculationContractVersion = automatic-prediction-v1`; `predictionDefinition = OFFICIAL_T2_AUTOMATIC_V1`.

SHA-256 hashes recursively sorted JSON of normalized effective settings. It includes probability scale, base home advantage, enabled rest/fatigue configuration, quick-rematch configuration, and special-teams weights/rank threshold only when automatic. Disabled adjustment magnitudes and UI fields do not affect it.

Rating-update K/result multipliers are excluded because they do not directly change this prediction given its stored ratings. Injury/goalie validation caps are excluded because existing saved adjustment values, rather than those validation caps, enter the live probability calculation. Team-specific strength/home adjustments are recorded as model inputs.

The four-field unique identity follows Parts E/K/S of the brief: a mid-window model/settings change cannot generate a second official record for the same start. This resolves the brief's broader opening reference to one observation “per model version” conservatively. Future aggregation must group the stored version and fingerprint. A material calculation change must bump the contract version; a different checkpoint policy must use a new prediction definition.

## 13. Rescheduled games

Any exact scheduled-start change creates a different identity. The earlier record is retained unchanged; the new start can capture only within its own T2 window. A start change discovered during capture aborts that attempt. Stored goalie selections from the old start are not carried into the new observation.

The pure result resolver compares game ID, season, type, both teams, and exact scheduled start. A mismatched start returns `RESCHEDULED` with no outcome. It handles FINAL/OFF regulation/OT/SO moneyline wins and rejects missing, tied, negative, fractional, or invalid scores. No result fetch job, scoring aggregation, or result mutation is implemented here.

## 14. Private data and reset

The server cursor supplies the owner; no browser-supplied user ID participates. Every private database query and insert carries that owner. Factory Reset deletes only that owner's prediction records in its existing transaction. New Season Reset preserves all forward history.

The private-data inventory includes snapshots. Legacy ownership migration audits them but cannot reassign them; unexpected ownerless prediction records block that migration before mutations.

## 15. Odds independence

The prediction service imports no odds provider, quota ledger, bookmaker preferences, or odds-history repository. Missing API credentials skip only the odds job. Quota blocks/provider failures cannot prevent prediction execution. Conversely, prediction failure cannot prevent the odds job from running. No real odds requests were used for validation.

## 16. Tests added

Golden baseline and Dashboard/Analyzer parity fixtures cover neutral, home advantage, B2B, B2B travel, 3-in-4, rematch, injuries, confirmed/unconfirmed goalies, special teams, combined adjustments, and persistent team adjustments. Additional tests cover effective fingerprints, missing inputs, override exclusion, exact boundaries, repeated/concurrent inserts, duplicate-key races, rescheduling, late completion, account disablement, stale providers, source ownership, optional outages, result identity, actual Mongoose query casting, and independent cron failure paths.

Reset and migration tests verify retention, owner-scoped deletion, and immutability. Tests use fixtures and mocks, including a mocked Mongo collection for the Mongoose write path; no production capture was executed.

## 17. Verification

Resumed review on 2026-09-10: both lint checks passed again; all 64 focused prediction, parity, reset, migration, and cron tests passed; `git diff --check` passed. A normalized source comparison also confirmed the shared calculation body is identical to the original implementation. No implementation code was changed during the resumed review.

Full verification completed before the interruption (the final server run included two additional regression tests beyond the earlier 815-test progress update):

- Full server tests: passed, 817 tests.
- Server lint: passed (repository syntax-check script).
- Full client tests: passed, 437 tests.
- Client ESLint: passed.
- Production Vite build: passed; warning about a bundle larger than 500 kB remains.
- `git diff --check`: passed.

No commit, deployment, production database mutation, or real Odds API quota consumption occurred.

## 18. Parity findings

All 11 original golden scenarios match the pre-extraction probabilities within 1e-14 and match the live calculation exactly. Persistent team adjustment and legacy home-adjustment storage also match Dashboard normalization.

Official observations intentionally differ from live Analyzer calculations when excluded subjective overrides are present. Strict stale-source handling and a missing goalie default may also produce explicit neutral inputs. These are official-input policy decisions, not changed model weights.

The review found that legacy goalie normalization can fall back to an effective adjustment when a team default is missing. Capture preserves raw provenance to avoid mistaking a manual override for an automatic default; the live UI behavior was not changed.

## 19. Limitations

Operational capture has been tested with mocks, not deployed against production. Schedule freshness uses the existing NHL provider cache and a five-minute maximum fetched age, not an uncached authoritative league transaction. Provider outages may leave valid predictions preliminary or miss a window entirely; no backfill is allowed.

The source is the user's stored injury/goalie state, not a new independent injury/confirmed-starter feed. Input reads are not a cross-collection transaction, so concurrent settings edits or resets are not serialized with capture. Larger account populations may eventually need bounded concurrency or partitioning; missed-window reason counts make overruns visible.

Client input preparation and the server automatic adapter remain separate, with one shared final calculation and shared/existing context services. The parity suite is the compatibility guard for future changes. Database indexes use the existing Mongoose initialization convention. No historical predictions, metrics API, CLV, or UI was added.

## 20. Storage estimate

The representative validated BSON document measured 1,552 bytes without a database. At 1,312 regular-season games, that is approximately 2.04 MB per user per season before indexes. Allow approximately 2–3 MB of documents plus index overhead, with extra records for playoffs or reschedules. There is one record per identity, not one per five-minute run.

## 21. Acceptance

The implementation is suitable for code acceptance based on the automated verification above. Production activation still occurs only when this code is deployed through the normal workflow. Observe capture logs and initial completeness distribution after that deployment; no historical records should be manufactured to populate the dataset.

## 22. Recommended next phase

Establish actual capture coverage, then implement authenticated result resolution and read-only aggregation over immutable predictions, paired market cohorts, and explicit missing-data reasons. Build the Model Performance UI after those contracts and real observations exist. Keep Rating Lab historical results separate from forward observations.
