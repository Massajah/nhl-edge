# NHL Edge — Starting Goalie Manual Integrity Phase 1

Implementation date: 2026-09-20  
Scope: Official T2 isolation, immutable Model @ Bet goalie snapshots, NHL actual-starter audit, and Model Performance drill-down. No provider integration, production write, deployment, commit, or push was performed.

## 1. Executive verdict

Phase 1 is implemented and verified.

- Official T2 no longer consumes owner-scoped manual starting-goalie selections.
- Analyzer and Dashboard interactive manual-goalie behavior is unchanged.
- New bets freeze both home and away manual goalie selections because both adjustments affect the calculated probability.
- Completed-game Model Performance audit data can resolve actual starters from the NHL GameCenter boxscore and compare them by canonical NHL player ID.
- Old bets and old Official T2 snapshots are left unchanged and remain readable.
- No database migration, new collection, polling job, provider, scraper, cron, or production side effect was introduced.

## 2. Root cause of Official T2 contamination

`forwardPredictionInputsService.loadUserInputs` loaded the owner-scoped `GameContext`, copied `stored.goalieSelections`, and returned those selections to the scheduled prediction path. `calculateAutomaticPrediction` then accepted `provider_goalie` and legacy `team_goalie` selections with a positive NHL player ID and finite team-default adjustment. It applied that adjustment regardless of whether the client/manual status was `selected`, `expected`, or `confirmed`.

The stored values were immutable once copied into `ForwardPredictionSnapshot`, but the source was still a manual Analyzer choice. Immutability therefore preserved contaminated provenance rather than making it objective.

## 3. Exact Official T2 isolation fix

The correction is enforced at two boundaries:

1. `forwardPredictionInputsService` excludes `goalieSelections` from its GameContext query projection and creates its automatic context with an empty goalie-selection object. Other owner-scoped inputs remain available under their established rules.
2. `calculateAutomaticPrediction` does not inspect `gameContext.goalieSelections`. Until an authorized automatic pregame starter provider exists, both sides always receive the established neutral automatic goalie behavior.

This defense-in-depth arrangement means a direct caller also cannot reintroduce a manual goalie by supplying a populated `gameContext`.

## 4. Official T2 behavior after the fix

For both teams, new Official T2 calculations now store:

- goalie adjustment: `0`
- goalie NHL player ID: `null`
- goalie completeness: `unknown`

Manual `selected`, `expected`, and `confirmed` statuses are all ignored. No starter is inferred from roster order, previous games, quality, current Analyzer state, or an Other/Unlisted entry. Official capture remains valid with no automatic starter.

Historical Official T2 snapshots are not rewritten.

## 5. Analyzer and Dashboard behavior

Analyzer remains unchanged. A user can still select roster goalies or Other/Unlisted goalies, use the existing game-specific override rules, inspect goalie information, and see the existing calculation update before saving.

Dashboard remains an interactive analysis surface and continues to use the owner's current `GameContext` goalie selections. This phase changes only the scheduled Official T2 automatic path.

The goalie formula, adjustment bounds, ratings, probability scale, home advantage, injuries, schedule/context adjustments, Special Teams, Kelly, and odds behavior were not changed.

## 6. Model @ Bet goalie snapshot design

`Bet` now has one additive nullable embedded field:

```text
startingGoaliesAtBet: {
  away: {
    adjustment,
    displayName,
    nhlPlayerId,
    selectionType,
    sourceType: "MANUAL",
    teamId
  } | null,
  home: { ... } | null
} | null
```

The server validates team/side identity, adjustment consistency with the stored model-at-bet adjustment, player ID shape for roster goalies, and manual provenance. A custom Other/Unlisted goalie remains valid with no NHL player ID. An unknown/unselected goalie is stored as `null`, not as a fake identity.

The existing `analyzedAt` remains the decision-time timestamp and Mongo `createdAt` remains the server persistence timestamp. No separate `selectedAt` was added because NHL Edge does not know when the human learned or selected the information, and neither timestamp is described as provider confirmation.

The older selected-side-only `goalieSelectionSnapshot` remains for backward compatibility. `startingGoaliesAtBet` is the new complete historical audit contract.

## 7. Why both team goalies are persisted

`calculateGame` adds the goalie adjustment independently to the home and away effective ratings. Both values therefore influence both win probabilities and fair odds. Preserving only the wagered-side goalie would be insufficient to explain the saved probability.

New bet payloads consequently freeze both available team selections. Each side may independently be absent.

## 8. Actual starter resolution design

Actual starters are resolved read-only when the paginated production Model Performance Games response is assembled.

Eligibility is deliberately narrow:

- the row is on the current visible page;
- the result is final;
- at least one bet on the row has the new `startingGoaliesAtBet` snapshot.

The resolver validates exact NHL game ID, season, game type, scheduled start, home team, and away team before accepting any starter. Provider or identity failures return unavailable data and never fail the page.

No actual starter is written to MongoDB. No raw NHL response is retained.

## 9. NHL endpoint and service reused

`nhlApiService` now exposes a normalized `getGameBoxscore` wrapper over:

```text
GET https://api-web.nhle.com/v1/gamecenter/{gameId}/boxscore
```

It extracts exactly one `starter: true` goalie from each of:

- `playerByGameStats.awayTeam.goalies`
- `playerByGameStats.homeTeam.goalies`

The normalized result contains only `playerId`, display `name`, and canonical team ID. Pregame payloads, missing arrays, malformed flags, missing/invalid player IDs, or multiple starters fail closed to `null`.

The wrapper uses the existing NHL request infrastructure, including bounded timeout/retry behavior, concurrency limiting, in-flight request de-duplication, and memory caching.

## 10. Match-status semantics

Comparison is per team and uses canonical NHL player IDs only:

- `MATCH`: both IDs are reliable and equal.
- `MISMATCH`: both IDs are reliable and different.
- `UNAVAILABLE`: selected identity is absent/unreliable, actual identity is absent/unreliable, or the saved selection is Other/Unlisted without an NHL ID.

Missing data is never interpreted as a mismatch. Names are display-only and are not used as an identity fallback.

## 11. Model Performance API changes

For game-detail responses only:

- `betDetails[].modelAtBet.startingGoalies` exposes the durable two-side decision-time snapshot or `null`.
- `items[].actualStartingGoalies` exposes normalized NHL starter data plus source `NHL_GAMECENTER_BOXSCORE` when resolution was attempted.
- `betDetails[].goalieComparison.{home,away}` exposes `MATCH`, `MISMATCH`, or `UNAVAILABLE`.

Aggregate metrics and top-level KPI contracts are unchanged. The new values are diagnostic and do not feed Brier score, accuracy, CLV, settlement, profit, or other calculations.

## 12. Model Performance UI changes

The existing expanded bet/game audit now shows a compact two-team “Starting goalies @ Bet vs actual” section with:

- Goalies @ Bet and explicit “Manual selection” provenance;
- exact adjustment used at bet time;
- Actual Starter;
- Match, Different starter, or Unavailable status.

No KPI, tab, or main Games-table column was added. Games without a bet retain the existing “No bet was saved” treatment. Old bets without the snapshot do not render fabricated goalie history. The two-column audit stacks to one column on narrow screens.

## 13. Historical data and backward compatibility

- Existing bets without `startingGoaliesAtBet` remain valid and report unavailable history.
- No backfill is performed from current GameContext, current roster, or the actual starter.
- Existing selected-side `goalieSelectionSnapshot` remains supported.
- Historical Official T2 snapshots are unchanged.
- Existing Model Performance model-version selection keeps prior cohorts accessible.
- Schema changes are additive and nullable.

## 14. Model/versioning decision

The underlying power-rating engine and goalie formula did not change, but the Official T2 input semantics did. New automatic calculations therefore use:

```text
power-rating-v1-goalie-neutral-v2
```

The existing `modelVersion` mechanism was chosen so old and new Official T2 cohorts remain distinguishable and selectable without inventing another version system.

`predictionDefinition` remains `OFFICIAL_T2_AUTOMATIC_V1`, and `calculationContractVersion` remains `automatic-prediction-v1`. Their stored shapes and calculation contract are unchanged; the behavior release is represented by `modelVersion`. `settingsFingerprint` remains settings-only and is not overloaded with input provenance.

## 15. Demo behavior

The DEMO_SAMPLE adapter remains self-contained and unchanged. Demo requests are routed to the separate demo service and never enter the production actual-starter resolver. No fictional demo goalie audit was added.

Demo Analyzer manual-goalie behavior remains unchanged. There is no new pregame provider or external demo call.

## 16. Storage impact

Storage impact is one compact optional embedded field on new Bet documents. No collection, index, raw payload, actual-starter record, high-frequency history, or migration was added.

Model @ Bet data remains owner-scoped with the parent bet. Public NHL actual-starter data is resolved transiently and is not mixed into user-owned storage.

## 17. NHL API/network impact

There are no new scheduled or pregame requests.

On Model Performance Games reads, boxscore requests are limited to final, visible, paginated rows that contain at least one new goalie-at-bet snapshot. The default page is 20 rows and the existing maximum is 100. Requests use concurrency 6, the shared NHL concurrency limiter, in-flight de-duplication, and the existing five-minute memory cache. A game is requested once per qualifying row, regardless of how many bets it contains.

Old bets, games without bets, pending games, aggregate Model Performance, and demo data create zero boxscore requests for this feature.

## 18. Performance impact

Pagination is unchanged and actual-starter enrichment runs after page slicing. Aggregate calculations and all Model Performance metrics run on the same data as before. Diagnostic enrichment is non-fatal and bounded by the visible page.

The client adds a small responsive drill-down block only when goalie-at-bet data exists.

## 19. Files added

- `STARTING_GOALIE_PHASE_1_REPORT.md`

The existing untracked `STARTING_GOALIE_PHASE_0_AUDIT.md` was preserved without modification.

## 20. Files modified

Application:

- `server/services/forwardPredictionContracts.js`
- `server/services/forwardPredictionInputsService.js`
- `server/services/automaticPredictionService.js`
- `server/models/Bet.js`
- `server/services/betsService.js`
- `server/services/nhlApiService.js`
- `server/services/modelPerformanceRepository.js`
- `server/services/modelPerformanceResultService.js`
- `server/services/modelPerformanceService.js`
- `client/src/utils/savedAnalyses.js`
- `client/src/components/ModelPerformance.jsx`
- `client/src/App.css`

Tests:

- `server/tests/automaticPrediction.test.js`
- `server/tests/forwardPredictionInputs.test.js`
- `server/tests/goalieAdjustments.test.js`
- `server/tests/nhlApiService.test.js`
- `server/tests/modelPerformanceResultService.test.js`
- `server/tests/modelPerformanceService.test.js`
- `client/src/tests/goalies.test.mjs`
- `client/src/tests/modelPerformance.test.mjs`

No workflow, Docker, runtime dependency, package manifest, lockfile, cron, or deployment file changed.

## 21. New and updated tests

Coverage includes:

- home and away manual selections ignored by Official T2;
- `selected`, `expected`, and `confirmed` statuses ignored by Official T2;
- changing GameContext goalie identity/adjustment cannot change automatic output;
- legitimate schedule, injury, rating, and Special Teams automatic inputs remain active;
- Analyzer parity remains unchanged for manual goalie scenarios;
- both bet-time goalie selections freeze with player ID, name, adjustment, team, and manual provenance;
- later source mutations cannot mutate the normalized saved snapshot;
- no selection and historical missing fields remain null/valid;
- Other/Unlisted without NHL ID remains valid;
- home/away NHL boxscore starter normalization;
- missing, pregame, malformed, multiple-starter, and unknown-ID behavior;
- NHL request cache reuse;
- exact game identity enforcement and non-fatal provider failure;
- ID match, mismatch, selected missing, actual missing, and custom/no-ID comparison;
- Model Performance goalie audit response, historical-bet safety, and no unnecessary NHL request;
- responsive drill-down rendering with both teams and match statuses.

## 22. Focused test results

- Server focused suite: **81/81 passed**.
- Client focused suite: **39/39 passed**.

## 23. Full server test result

- **911/911 passed**.
- Baseline was 901; Phase 1 adds 10 server tests.

## 24. Full client test result

- **466/466 passed**.
- Baseline was 464; Phase 1 adds 2 client tests.

## 25. Lint and build result

- Server lint/syntax check: passed for 247 server JavaScript files.
- Client ESLint: passed.
- Client production build: passed; 1,864 modules transformed.
- Vite retained its existing advisory that the main JavaScript chunk exceeds 500 kB. The build completed successfully.
- Docker build: not run because no Docker/runtime/dependency/startup file changed.

## 26. Production side effects

**NONE.**

No production database, cron, credentials, deployment, commit, push, provider integration, or production mutation was used.

## 27. Database migration

**NONE.**

The Bet schema change is additive and optional. Existing documents remain valid and no history is fabricated.

## 28. Manual verification checklist

### A. Analyzer

1. Open a future game.
2. Select both starting goalies.
3. Verify probability and fair odds change as before.
4. Change one goalie.
5. Verify the prediction updates and Other/Unlisted still works.

### B. Bet save

1. Select both goalies and save a bet.
2. Verify the saved bet retains its Model @ Bet probability and goalie choices.
3. Change one or both Analyzer goalies afterward.
4. Verify the saved historical goalie snapshot does not change.
5. Save a separate bet with no goalie selected and verify it remains valid.

### C. Model Performance

For a completed real game with a qualifying new bet:

1. Open Model Performance → Games.
2. Expand the game and bet audit.
3. Verify both Goalies @ Bet and “Manual selection” provenance.
4. Verify both Actual Starters when NHL boxscore data is available.
5. Verify Match/Different starter status by team.
6. Verify an old bet without the new snapshot renders without a goalie audit or error.

### D. Official T2

Using tests or development-safe inspection only:

1. Populate GameContext with different manual home/away goalies and statuses.
2. Run the automatic calculation path.
3. Verify both goalie adjustments remain `0`, player IDs remain `null`, and completeness remains `unknown`.
4. Verify the new automatic model version is `power-rating-v1-goalie-neutral-v2`.

## 29. Known limitations

- Pregame starter selection remains manual; no automatic provider exists.
- Old Official T2 snapshots may contain the former manual contamination and are intentionally not rewritten. They remain distinguishable by their older model version.
- Actual-starter names use the NHL boxscore display form, which may be abbreviated; canonical player ID is authoritative.
- Other/Unlisted selections without an NHL player ID cannot be reliably matched and remain `UNAVAILABLE`.
- Actual starters are resolved only for final, visible Model Performance rows with a new goalie-at-bet snapshot.
- NHL caching is process-memory based and is not shared between application instances.
- Visual behavior is covered by render/CSS tests and production build; a signed-in browser walkthrough with a qualifying completed new bet remains the final manual check.

## 30. Recommended next step

Perform the manual verification checklist with one new saved bet on a real completed game. After a short period of production observation, review boxscore availability/error rates and the frequency of manual selected-vs-actual mismatches. Do not add an automatic pregame provider without a separately authorized, structured source and a new versioned design.

READY FOR MANUAL STARTING GOALIE VERIFICATION
