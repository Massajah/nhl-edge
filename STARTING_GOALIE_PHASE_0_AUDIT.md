# NHL Edge automatic starting goalie — Phase 0 audit

Investigation date: 2026-09-17  
Scope: read-only architecture and public-source research. No production endpoint, production credential, database, cron entrypoint, or paid API was used.

## 1. Executive verdict

NHL Edge has a mature manual goalie-adjustment path, but it does **not** have an automatic starting-goalie provider path today. Current roster candidates, identities, and goalie statistics come from NHL APIs. A user then chooses the game goalie in Analyzer, and that owner-scoped selection is stored in `GameContext`.

The largest finding is that `OFFICIAL_T2_AUTOMATIC_V1` currently treats a manually selected roster goalie in `GameContext` as valid automatic goalie evidence. It ignores the game-specific numeric override, but it still uses the manually chosen identity, user-scoped team-default adjustment, and `confirmationStatus`. The API accepts `selected`, `expected`, or `confirmed` status from the authenticated client. Therefore the existing T2 path cannot prove that goalie identity or confirmation status was objectively available at capture time. See `server/services/automaticPredictionService.js:64-98`, `server/services/forwardPredictionInputsService.js:36-64`, `server/services/gameGoalieSelectionService.js:41-71`, and `server/tests/automaticPrediction.test.js:30-76`.

The immutable snapshot machinery itself is strong: insert-once persistence, a unique key including scheduled start, model-level immutable fields, and update middleware prevent later application updates. The missing piece is immutable **goalie provenance**. The snapshot stores player ID, numeric adjustment, and a free-text completeness value, but not goalie name, provider, original source, observed time, provider-published time, confirmation time, or provider/mapping version.

The safest Phase 1 design is:

1. Use only a supported/licensed structured pregame feed. Of the investigated options, RotoWire is the only provider that publicly advertises a supported commercial XML/JSON syndication path. Daily Faceoff has richer visible source/timestamp information, but its accessible mechanism is an undocumented Next.js website payload and its `robots.txt` disallows `/api/`; a production connector should not be built without written permission or a documented feed.
2. Add one provider-neutral, global current-goalie state keyed by canonical NHL game/start/team. Do not store it in owner-scoped `GameContext` and do not fetch per user.
3. Keep automatic state separate from manual Analyzer overrides. Official T2 must never read Analyzer goalie selections.
4. Normalize only `UNKNOWN`, `PROJECTED`, and `CONFIRMED`. Treat `CONFLICT` and `UNAVAILABLE` as resolution/health outcomes, not identities or provider statuses.
5. In the first model version, apply goalie adjustment automatically only for fresh, mapped `CONFIRMED` observations. Persist fresh `PROJECTED` identity/status for audit, but use the current neutral missing-goalie behavior until measured accuracy justifies a versioned model change.
6. Resolve identity through NHL player IDs where contractually available; otherwise require a unique, team-restricted exact canonical name match. Never silently fuzzy-match.
7. Resolve actual starters after the game from the NHL gamecenter boxscore `playerByGameStats.{homeTeam,awayTeam}.goalies[].starter` field.

Provider authorization and a sample feed contract remain blockers for implementing a live connector, but not for completing a Phase 1 technical design.

## 2. Current starting-goalie architecture

There are three related but distinct concepts in the repository:

| Concept | Current owner/scope | Storage | Purpose |
|---|---|---|---|
| NHL roster goalie | Global public provider data | Server memory cache only | Candidate identity and roster validation |
| Goalie rating adjustment | Per user/team/NHL player | `GoalieAdjustment` | Persistent penalty relative to the normal number-one goalie |
| Game goalie selection | Per user/game/side | `GameContext.goalieSelections` | Analyzer/Dashboard game input and manual override snapshot |

Relevant implementation inventory:

- React: `client/src/components/GameAnalyzer.jsx`, `client/src/components/AdjustmentComparison.jsx`, `client/src/components/Dashboard.jsx`, `client/src/components/Teams.jsx`, and `client/src/components/TeamModelValues.jsx`.
- Client normalization/API: `client/src/utils/goalies.js`, `client/src/utils/gameContext.js`, `client/src/utils/modelAnalysis.js`, `client/src/services/teamsApi.js`, `client/src/services/gameContextApi.js`, and `client/src/services/teamsDataCoordinator.js`.
- API routes/controllers: `server/routes/teamsRoutes.js`, `server/controllers/teamsController.js`, `server/routes/playersRoutes.js`, `server/controllers/playersController.js`, `server/routes/gameContextRoutes.js`, and `server/controllers/gameContextController.js`.
- Server services: `goalieAdjustmentsService`, `gameGoalieSelectionService`, `gameContextService`, `gameContextRules`, `nhlApiService`, `forwardPredictionInputsService`, `automaticPredictionService`, and `scheduledForwardPredictionService`.
- Persistence: `GoalieAdjustment`, legacy `TeamGoalies`, `GameContext`, and `ForwardPredictionSnapshot`.
- Shared calculation: `shared/predictionCalculation.js`.
- Principal focused tests: `server/tests/goalieAdjustments.test.js`, `server/tests/automaticPrediction.test.js`, `server/tests/forwardPredictionInputs.test.js`, `server/tests/forwardPredictionCapture.test.js`, `server/tests/nhlApiService.test.js`, and `client/src/tests/goalies.test.mjs`.

There is no starting-goalie provider configuration, credential, fetch service, parser, global cache, history collection, or scheduled refresh job. The word `provider_goalie` currently means “goalie from the NHL team roster,” not “goalie selected by an automatic starting-goalie provider.” This naming collision is important for Phase 1.

## 3. Analyzer goalie data flow

### Candidate loading

`GameAnalyzer.loadTeamGoalies` performs two parallel authenticated/public app requests (`client/src/components/GameAnalyzer.jsx:713-795`):

1. `GET /api/teams/:teamId/goalie-adjustments` through `fetchGoalieAdjustments`.
2. `GET /api/teams/:teamAbbreviation/goalie-summaries` through `fetchTeamGoalieSummaries`.

The first route calls `getProviderGoalieAdjustments` (`server/controllers/teamsController.js:79-95`). That service loads owner-scoped saved adjustments, fetches the NHL current roster, keeps valid positive NHL player IDs, and merges each roster goalie with the user's saved adjustment or an implicit `0.00` (`server/services/goalieAdjustmentsService.js:283-400`). Provider failure returns no candidate goalies and a safe `unavailable` state; saved adjustments remain readable.

The second route calls `nhlApiService.getGoalieSummariesForTeam` (`server/controllers/teamsController.js:197-219`). It joins current NHL roster goalies to NHL Stats API current-season summaries (`server/services/nhlApiService.js:1400-1463`).

### Dropdown and Other / Unlisted

`GoalieSelectionPanel` renders one card per team in the existing Starting goalies section (`client/src/components/AdjustmentComparison.jsx:638-739`). `GoalieSelectionCard` presents:

- `Unknown starter`;
- one option per NHL roster goalie, keyed by `nhlPlayerId` and labelled with the saved/default adjustment;
- a preserved “saved snapshot” option when a former roster goalie is no longer in the current candidate list; and
- `Other / Unlisted goalie` (`client/src/components/AdjustmentComparison.jsx:741-916`).

Selecting a roster goalie calls `createProviderGoalieSelection`; it snapshots NHL player ID, display name, team-default adjustment, and status `selected` (`client/src/utils/goalies.js:226-247`). Selecting Other / Unlisted creates a `custom` selection with null NHL player ID, optional name/note, required game-specific adjustment, and `overrideEnabled: true` (`client/src/utils/goalies.js:249-257`, `client/src/components/AdjustmentComparison.jsx:837-861`).

The current UI does not expose a control to choose `expected` or `confirmed`; ordinary UI selection produces `selected`. The server nevertheless accepts all four statuses `unknown`, `selected`, `expected`, and `confirmed` from the request (`server/services/gameGoalieSelectionService.js:14-71`). Consequently, status is a stored manual assertion, not externally verified evidence.

### Save and calculation flow

The flow is:

```text
NHL current roster + NHL goalie stats + user GoalieAdjustment
  -> GameAnalyzer/GoalieSelectionCard
  -> client normalizeGoalieSelection/updateGoalieInputs
  -> PATCH /api/game-context/:gameId/goalies
  -> normalizeGameGoalieSelection
  -> owner-scoped GameContext.goalieSelections
  -> applyGameGoalieSelectionsToInputs
  -> shared calculateGame
  -> Analyzer result and Dashboard preliminary prediction
```

Exact references:

- Client selection normalization and input fields: `client/src/utils/goalies.js:165-220`, `259-298`, and `412-493`.
- Save payload and API call: `client/src/components/GameAnalyzer.jsx:340-383`, `956-1005`; `client/src/services/gameContextApi.js:29-36`.
- Authenticated owner binding: `server/routes/gameContextRoutes.js:5-14`; `server/controllers/gameContextController.js:30-40`. The server uses `request.user.id`; it does not accept a client `userId`.
- Roster/team validation and snapshotting: `server/services/gameGoalieSelectionService.js:119-255`.
- Atomic owner/game update: `server/services/gameContextService.js:406-509`.
- Schema: `server/models/GameContext.js:25-105`, `329-405`.
- Live input composition: `client/src/utils/modelAnalysis.js:170-208`; `client/src/utils/goalies.js:280-298`.
- Shared formula: `shared/predictionCalculation.js:193-231`.

### Current answers

- NHL player IDs are stored for roster selections. Custom selections intentionally have null NHL player ID.
- Manual goalie entry exists only as game-scoped Other / Unlisted. Legacy team-maintained rows remain compatibility input but unmatched manual rows are excluded from current roster choices.
- Current statuses are `unknown`, `selected`, `expected`, and `confirmed`.
- `source` exists, but values describe selection type (`provider_goalie`, `custom`, and legacy values), not Daily Faceoff/RotoWire or an original reporting source.
- Confirmation state exists as an enum but has no independent provenance, timestamp, or server-side confirmation verification.
- A roster goalie can use the team default or a game-specific override. Custom is always a game-specific override.
- Goalie details use current NHL roster and NHL Stats API season data: GP, GS, wins/losses, save percentage, GAA, saves, shots, and shutouts.

## 4. Current goalie adjustment calculation

The conceptual baseline is documented and implemented as follows: the team power rating is assumed to include its normal number-one goalie, so `0.00` is neutral. Backups or weaker alternatives are user-configured negative adjustments.

### Inputs and formula

For each team, `calculateGame` adds:

```text
base rating
+ home advantage (home only)
+ stored injury impact
+ game injury adjustment
+ goalie adjustment
+ rest/fatigue
+ quick rematch
+ special teams
+ motivation
+ manual adjustment
```

See `shared/predictionCalculation.js:193-231`. Home and away goalie values enter the same additive formula; home advantage is separate.

### Configuration and limits

- Default Maximum Goalie Penalty: `-4.00`.
- Configurable range for that maximum: `-5.00` through `0.00` (`server/config/baseModel.js:24-28`, `42-52`).
- Saved and game-specific goalie adjustments must be `0.00` or negative, no lower than the configured maximum, in `0.05` increments (`server/services/goalieAdjustmentsService.js:63-130`).
- `GoalieAdjustment` persists one record per owner/team/NHL player and enforces model range `-5` through `0` (`server/models/GoalieAdjustment.js:3-61`).
- An NHL roster goalie without a saved adjustment receives implicit `0.00` and creates no database row (`server/services/goalieAdjustmentsService.js:330-346`).

### Runtime behavior

- No selected goalie: normalized `unknown`, null identity, `0.00` adjustment. Dashboard flags an unconfirmed/default input; Analyzer remains calculable.
- Selected goalie changes: client inputs immediately change to the new goalie ID/name/team default, `calculateGame` recomputes, and a save updates only that game/owner.
- Roster goalie with game override: live Analyzer/Dashboard use the manual value. Official T2 currently ignores `manualAdjustment`/`effectiveAdjustment` and uses `teamDefaultAdjustment`.
- Other / Unlisted: live calculation uses the required manual adjustment; Official T2 excludes the selection and uses `0.00`.
- Missing/failed NHL roster response: current candidates are unavailable; the existing saved game snapshot can remain displayable, but a new roster selection cannot be validated.
- Saved team-default value outside a subsequently tightened Maximum Goalie Penalty causes a review error; it is not silently clamped (`server/services/gameGoalieSelectionService.js:136-155`, `225-235`).

Dashboard preliminary analysis and Analyzer use the same input builder and shared `calculateGame` path (`client/src/utils/modelAnalysis.js:170-235`, `280-370`; `client/src/components/GameAnalyzer.jsx:385-410`). Official T2 also calls the same shared formula, but assembles inputs separately in `automaticPredictionService`.

## 5. Automatic-input goalie behavior

`createForwardPredictionInputsService.loadUserInputs` loads, per production owner:

- power ratings;
- rating and schedule settings;
- owner-scoped injury summaries;
- owner-scoped `GameContext` rows whose `scheduledStart` exactly equals the current NHL scheduled start; and
- shared schedule/special-teams provider data (`server/services/forwardPredictionInputsService.js:11-65`).

It does not fetch a starting goalie, infer roster order, choose the goalie with the most starts, inspect an NHL lineup, or query a pregame provider. It copies `stored.goalieSelections` from `GameContext` specifically to preserve the team-default/manual distinction (`forwardPredictionInputsService.js:50-58`).

`calculateAutomaticPrediction` considers a goalie valid when:

- `selectionType` is `provider_goalie` or legacy `team_goalie`;
- the stored team matches the game side;
- the NHL player ID is a positive integer; and
- `teamDefaultAdjustment` is finite.

It then applies that team-default adjustment regardless of whether `confirmationStatus` is `selected`, `expected`, or `confirmed` (`server/services/automaticPredictionService.js:64-74`). The status only changes `completeness.goalies[side]`. A custom selection is neutral and marked `custom_excluded`. Missing/mismatched data is neutral and marked `unknown`.

This means the current service does not confuse roster order with confirmation, but it does allow manually chosen roster identity/status to stand in for automatic evidence. `server/tests/automaticPrediction.test.js:63-76` explicitly proves that an `expected` roster selection still applies its goalie adjustment.

## 6. Official T2 goalie representation

`ForwardPredictionSnapshot` currently persists:

- `modelState.{side}.goalieNhlPlayerId`;
- `adjustments.{side}.goalie`;
- `completeness.goalies.{side}` as required strings;
- the calculated effective rating and probability; and
- the normal game, model, settings, and capture timestamps (`server/models/ForwardPredictionSnapshot.js:5-41`).

It does **not** persist goalie name, provider, provider record/reference, original source, provider event start, observed/fetched timestamp, provider-published timestamp, confirmation timestamp, mapping method/version, or whether multiple providers disagreed.

The current schema can technically store `projected` and `confirmed` as different free-text completeness values. It is not a sufficient semantic contract because:

- the current producer uses `selected`, `expected`, `confirmed`, `custom_excluded`, and `unknown`;
- the schema does not restrict those strings;
- the status is not tied to a provider observation;
- identity and status provenance are absent; and
- there is no way to prove the information existed at or before `generatedAt`.

The smallest safe future snapshot change is a required embedded `startingGoalies.{home,away}` observation object containing canonical identity (nullable), normalized status, provider, provider/source references where present, observation/freshness timestamps, and the exact applied adjustment. Keep the existing numeric fields for compatibility if needed. A provider/parser or goalie-input contract version must also be captured. Do not overload `settingsFingerprint`: `getPredictionSettings` intentionally excludes goalie data and Maximum Goalie Penalty (`server/services/automaticPredictionService.js:15-40`; `server/tests/automaticPrediction.test.js:94-110`).

## 7. Immutability assessment

Strengths:

- Every schema path is marked immutable.
- `save` rejects any non-new document.
- query update middleware permits only insert-once `$setOnInsert` upserts.
- bulk writes are rejected.
- a unique index covers owner, game ID, scheduled start, and prediction definition.
- repository insertion validates the full document and handles a concurrent first-writer race without replacing the winner (`server/models/ForwardPredictionSnapshot.js:43-68`; `server/services/forwardPredictionRepository.js:4-24`).
- Snapshot fields are embedded values, not references to `GameContext` or `GoalieAdjustment`; later updates to those documents do not mutate the snapshot.

Risks relevant to future goalies:

1. Current T2 snapshots cannot establish when the manual goalie selection/status was observed. Immutability freezes the value, but not trustworthy provenance.
2. A `GameContext` refresh preserves existing selections while updating scheduled start (`server/services/gameContextRules.js:1230-1250`). Although the forward loader normally rejects a stored row whose old start differs, a Dashboard refresh after rescheduling can re-save the old manual selection with the new start. This is unsuitable for future automatic state.
3. The T2 job rechecks NHL schedule identity after loading inputs but does not re-read the goalie source immediately before calculation (`server/services/scheduledForwardPredictionService.js:76-98`). A future design needs an observation record with `observedAt <= generatedAt` rather than mutable shared state without a version/time.
4. Direct database/collection writes can always bypass Mongoose middleware; no ordinary application path found does this.

Later live confirmation will not mutate an existing Official T2 document under current repository paths. The future provider state must likewise be copied into the snapshot, never referenced.

## 8. Existing NHL API capabilities

`nhlApiService` uses:

- `https://api-web.nhle.com/v1` for schedules, current rosters, standings, player landing, and game landing;
- `https://api.nhle.com/stats/rest/en` for goalie/statistical summaries (`server/services/nhlApiService.js:1-22`).

Current capabilities:

| Need | Existing endpoint/service | Result |
|---|---|---|
| Canonical team/game identity | `/schedule/{date}` and `getScheduleForDate` | NHL game ID, season, game type, start time, ordered teams, game state/status |
| Current team goalies | `/roster/{abbr}/current` and `getRosterForTeam` | NHL player ID, full name, position, sweater number, handedness, biographical data |
| Player validation | `/player/{id}/landing` | Position, active/current team context |
| Goalie stats | `/goalie/summary?...` | Current/previous season aggregates including games started and save percentage |
| Game landing | `/gamecenter/{gameId}/landing` and `getGameLanding` | Current implementation returns only simplified game identity/result fields |

The service has bounded eight-second requests, low concurrency, one retry, in-flight deduplication, and endpoint-specific memory caches. Current roster requests allow stale fallback (`nhlApiService.js:1898-1940`); stale roster data must not independently certify a starting goalie.

### Pregame versus postgame

The NHL schedule and current roster data do not identify a pregame starter. The existing landing normalization discards any lineup detail and returns only `simplifyGame` (`nhlApiService.js:1562-1577`). No existing code consumes an NHL pregame starter field.

On 2026-09-17, the public NHL schedule and boxscore endpoints were minimally inspected for game `2025020622`. The schedule provided canonical identity and timing. The completed-game boxscore at [`/v1/gamecenter/2025020622/boxscore`](https://api-web.nhle.com/v1/gamecenter/2025020622/boxscore) provided `playerByGameStats.awayTeam.goalies[]` and `.homeTeam.goalies[]`, each with NHL `playerId`, `starter`, TOI, saves, shots against, and goals against. It identified Jonathan Quick and Charlie Lindgren with `starter: true`.

There is no documented or observed guarantee in the existing integration that this field is available reliably before puck drop. Treat NHL as authoritative for canonical identity and the actual result, not as the pregame announcement provider.

## 9. Authoritative actual-starter resolution

The best authoritative result path is NHL gamecenter boxscore:

```text
GET /v1/gamecenter/{canonicalNhlGameId}/boxscore
playerByGameStats.homeTeam.goalies.find(goalie => goalie.starter === true)
playerByGameStats.awayTeam.goalies.find(goalie => goalie.starter === true)
```

Validation should require exactly one `starter: true` goalie per team, a positive NHL player ID, matching canonical game/teams, and an appropriate live/final game state. If the response is incomplete or contradictory, leave actual starter unknown and retry later.

NHL Edge does not currently capture enough information for this analysis. `HistoricalNhlGame` stores game identity, teams, score, result type, state, and source timestamps, but no players (`server/models/HistoricalNhlGame.js:9-114`). The historical importer similarly persists no goalie (`server/services/historicalNhlDataService.js:271-337`). `getGameLanding` also strips boxscore players. Future provider-accuracy analysis therefore requires either a small authoritative actual-starter record or a later, cacheable boxscore lookup; neither is implemented in Phase 0.

## 10. Daily Faceoff findings

Research URLs:

- [Starting goalies page for 2025-12-31](https://www.dailyfaceoff.com/starting-goalies/2025-12-31)
- [Daily Faceoff robots.txt](https://www.dailyfaceoff.com/robots.txt)
- [Daily Faceoff privacy policy](https://www.dailyfaceoff.com/privacy-policy)

### Data available

The public page exposes, per game/side: internal team ID/name/slug/logo, internal goalie IDs/name/slug, goalie performance/rating fields, game date/time (`dateGmt`), confirmation/news strength, source name/URL, and news creation time. The inspected page displayed confirmed counts, goalie identity, `Confirmed`/`Unconfirmed`, timestamp for confirmed records, source attribution, and statistics.

### Projected/confirmed

Confirmed records have `homeNewsStrengthName`/`awayNewsStrengthName: "Confirmed"`. Unconfirmed sides can still contain a named goalie; the page describes its overall product as projected/probable starters and renders these sides as `Unconfirmed`. The payload does not expose a literal `PROJECTED` value in the inspected sample. A connector would need an explicitly documented mapping: named + unconfirmed may normalize to `PROJECTED`; blank/missing identity must normalize to `UNKNOWN`.

### Timestamps

`homeNewsCreatedAt`/`awayNewsCreatedAt` is present for confirmed news and is displayed alongside the confirmation. Without provider documentation it should be preserved as `providerPublishedAt`, not asserted to be the exact real-world confirmation time. `confirmedAt` must remain null unless Daily Faceoff contractually defines that timestamp as such. NHL Edge's own fetch completion is a separate `observedAt`/`lastVerifiedAt`.

### Source attribution

The payload contains source name and URL (for example, a beat reporter/social post). This supports keeping `provider: DAILY_FACEOFF` separate from optional original-source attribution.

### Delivery mechanism

Minimal unauthenticated inspection returned HTTP 200, `text/html; charset=utf-8`, approximately 224 KB for the sampled date page. It is a Next.js page containing `__NEXT_DATA__`, `/_next/static/` assets, static-generation markers, and the starting-goalie data under `props.pageProps.data`. The page's meaningful goalie content is server-rendered/embedded; JavaScript execution was not required to read the sampled data.

The payload is structured, but it is a website implementation detail. The sampled object had 10 game records and many presentation/editorial fields. It had Daily Faceoff team/goalie IDs and FantasyData IDs, but no canonical NHL game ID and no field identified as NHL player ID.

### Documented versus undocumented interfaces

No documented public Daily Faceoff starting-goalie API was located. `api.dailyfaceoff.com` appeared for media assets, but the public `robots.txt` explicitly disallows `/api/` and `/cms/`. The Next.js payload and page chunk are undocumented website contracts. They can change with a deploy and should not be treated as an API SLA.

### Access restrictions

The sampled public page required no login, cookie, or browser execution. Response markers indicated Cloudflare infrastructure, but no challenge was encountered during the few audit requests. Rate limits were not tested and no public rate-limit contract was found. No standalone Terms of Service link was located in the page footer or public search; the footer linked Privacy Policy instead. That is an unresolved access/permission question, not a legal conclusion.

### Stability and production suitability

Technically, one date-page fetch can return a full slate with excellent confirmation/source detail. Operationally, parsing `__NEXT_DATA__` is materially less brittle than DOM scraping, but it remains an undocumented internal website payload with no canonical NHL IDs. Daily Faceoff is **not suitable for production Phase 1 unless** NHL Edge obtains written permission and preferably a documented/licensed feed contract. Do not call the disallowed `/api/`, bypass Cloudflare, or add browser automation.

## 11. RotoWire findings

Research URLs:

- [Projected NHL Starting Goalies](https://www.rotowire.com/hockey/starting-goalies.php)
- [Advertising & Content Syndication / API](https://www.rotowire.com/partner/)
- [Content syndication overview](https://www.rotowire.com/advertise/content-syndication.pdf)
- [Terms and Conditions](https://www.rotowire.com/termsandconditions.php)
- [RotoWire robots.txt](https://www.rotowire.com/robots.txt)

### Data and statuses

The public page explicitly defines:

- `Confirmed`: team or reliable source has confirmed the starter;
- `Expected`: RotoWire's unconfirmed expectation; and
- `Unknown`: waiting for news/expectation.

This maps cleanly to `CONFIRMED`, `PROJECTED`, and `UNKNOWN`. The initial server HTML did not expose the day's individual goalie records, timestamps, or original source attribution; it rendered “Loading NHL Games...”.

### Delivery mechanism

Minimal unauthenticated inspection returned HTTP 200, `text/html; charset=UTF-8`, approximately 326 KB. The page is not Next.js and includes client-side code that requests the undocumented internal HTML endpoint `/hockey/tables/projected-goalies.php?date=...`. The endpoint appears to be a website fragment, not a documented REST/GraphQL contract. The audit did not probe it after locating RotoWire's explicit crawling restriction.

### Documented API and access

RotoWire publicly advertises a business content-syndication service delivered through XML/JSON. Its materials include expected/confirmed NHL starting goalies/lineups and state that custom player IDs can be supplied. Access is through a demo/contact-sales onboarding path; price, authentication, exact schema, timestamps, NHL ID availability, and SLA are not publicly specified.

The public page required no login for the shell/status definitions. RotoWire's terms state that Services are for personal, non-commercial use and prohibit manual or automated processes that crawl/spider website pages. The terms also restrict reproducing/distributing site content. `robots.txt` generally allows the public page for ordinary agents but does not override the terms. This is not a legal opinion; it is a material operational restriction.

### Stability and production suitability

- Public-page/internal-fragment scraping: unsuitable for NHL Edge production.
- Licensed XML/JSON syndication feed: potentially the strongest investigated production option, subject to contract, cost, authentication, a sample schema, NHL ID mapping, source/timestamp semantics, and acceptable polling rights.
- Cloudflare-related markers were present, but no challenge occurred in the minimal page request. No load/rate-limit testing was performed.

## 12. Provider comparison

| Criterion | Daily Faceoff public page | RotoWire public page | RotoWire licensed feed | NHL API |
|---|---|---|---|---|
| Projected starter | Named unconfirmed goalie, but no literal projected field in sample | Explicit Expected definition; rows client-loaded | Advertised expected starter data | No reliable pregame starter in existing integration |
| Confirmed starter | Yes | Explicit Confirmed definition | Advertised confirmed data | Not established reliably pregame |
| NHL player ID | No identified NHL ID; provider IDs only | Not established | Custom ID support advertised; NHL ID must be confirmed | Yes |
| NHL game ID | Not in sampled payload | Not established | Must be confirmed | Yes |
| Confirmation timestamp | News creation timestamp visible; exact semantics undocumented | Not visible in initial page | Must be confirmed in contract | Actual result only; no announcement time |
| Original source attribution | Name and URL available | Public status definition mentions source, but no row-level evidence observed | Must be confirmed | NHL is the authoritative result source |
| Machine-readable | Embedded JSON in HTML | Internal HTML fragment | XML/JSON | JSON |
| Documented/supported API | No | No | Yes, commercial syndication offering | De facto official NHL endpoints; no pregame starter contract found |
| Authentication/cost | Public page; licensing unknown | Public page; scraping restricted | Onboarding/auth/cost not public | No auth/cost in current use |
| Stability | Website build contract; medium/high maintenance | Website fragment; high maintenance | Expected highest, contract-dependent | Good existing use for identity/result; no SLA assumed |
| Five-minute polling | Technically batchable, permission unresolved | Unsuitable under terms | Contract-dependent | Suitable for schedule/result; not pregame announcement |
| Actual starter | No authoritative result role | No authoritative result role | Useful for accuracy comparison, not canonical result | Yes, boxscore `starter` |
| Integration complexity | Medium parser + hard identity/game mapping | High and disallowed for production scraping | Medium adapter + onboarding | Low for canonical identity; small new boxscore adapter needed |

## 13. Player identity mapping

Recommended fail-closed hierarchy:

1. If the licensed feed supplies NHL player ID, validate it against NHL player/roster data, position `G`, and the canonical game team.
2. If the provider has a stable proprietary ID, maintain an explicit reviewed mapping from `(provider, providerPlayerId)` to NHL player ID, and validate current game/team context.
3. Otherwise, compare a canonicalized full name only against goalies associated with the canonical game team. Accept only one exact result.
4. If zero or multiple candidates match, return `UNKNOWN` with `IDENTITY_UNRESOLVED`; do not apply an adjustment.

Name canonicalization may normalize Unicode representation, case, whitespace, apostrophe/dash variants, and explicitly handled suffixes. Accent removal, initials, abbreviations, nicknames, or edit-distance matching must not silently decide identity. If a controlled alias is needed, store it as reviewed mapping data. Duplicate names or collisions fail closed.

Trades and roster changes require special care. Validate provider team and observation time against the game team; do not assume the player's current team at a later date represents the historical observation. Emergency call-ups absent from a stale current roster should remain unresolved unless NHL player identity is independently exact. A wrong mapped adjustment is worse than neutral `UNKNOWN`.

## 14. Game identity mapping

NHL game ID, season/game type, ordered teams, and current scheduled start are canonical. External provider identity is evidence to be joined, not the source of truth.

If a feed supplies NHL game ID, validate all fields against current NHL schedule. If it does not, require:

- exact canonical home and away teams after explicit provider-team mapping;
- provider event start matching the current NHL scheduled start within a very small documented clock tolerance;
- compatible season/game type and provider event date; and
- exactly one NHL schedule candidate.

Date/team-only matching is insufficient. Same teams can play on nearby dates, timezones can shift the displayed date, and preseason/regular/playoff games must not cross-match. Persist `providerEventStartAt` and `canonicalScheduledStartAt`. Any NHL schedule change invalidates the prior mapping until a fresh provider record matches the new start. This mirrors `getGameIdentity`, T2 eligibility, and result reschedule checks (`server/services/forwardPredictionContracts.js:9-55`).

The Daily Faceoff sampled payload has ordered team names/IDs and `dateGmt`, but no NHL game ID; it therefore requires this strict join. A stale provider record must never be re-keyed onto a rescheduled game merely because NHL game ID/teams remain the same.

## 15. Proposed normalized contract

Design only:

```js
{
  contractVersion: 'starting-goalie-observation-v1',       // required
  gameId: '2025020622',                                   // required NHL ID
  scheduledStartAt: '2025-12-31T17:30:00.000Z',           // required canonical NHL start
  providerEventStartAt: '2025-12-31T17:30:00.000Z',       // required for providers without NHL game ID
  teamId: 'WSH',                                           // required canonical NHL team
  goalie: null | {
    nhlPlayerId: 8479292,                                  // required when goalie is non-null
    name: 'Charlie Lindgren'                               // required immutable display snapshot
  },
  status: 'UNKNOWN' | 'PROJECTED' | 'CONFIRMED',           // required
  provider: 'ROTOWIRE',                                    // required
  providerPlayerId: null | '...',                          // optional; useful for explicit mapping
  providerReference: 'https://...',                        // optional stable record/page reference
  source: null | { label: 'Bailey Johnson', reference: 'https://...' },
  providerPublishedAt: null | '...',                       // optional, only if provider exposes it
  confirmedAt: null | '...',                               // optional, only with documented semantics
  observedAt: '...',                                       // required: fetch/parse completion for this observation
  stateFirstObservedAt: '...',                             // required: first time this exact identity/status was seen
  lastVerifiedAt: '...'                                    // required: latest successful identical verification
}
```

`goalie` must be null for unresolved identity. `CONFIRMED` with null goalie is invalid. `providerPublishedAt` and `confirmedAt` are not synthesized from fetch time. Mapping/freshness failures should be represented by a separate resolver outcome/diagnostic, not by inventing provider data. No raw provider body, editorial narrative, fantasy rating, contract, salary, or unrelated stats should be stored.

For multiple providers, retain provider observations separately in memory/current storage and create a resolved view. The Official T2 snapshot should embed the resolved result plus enough provider observations to explain a conflict without saving entire payloads.

## 16. Proposed status model

Provider-normalized goalie status should contain only:

- `UNKNOWN`: no safely mapped goalie identity/status is available.
- `PROJECTED`: a safely mapped provider expectation, not confirmation.
- `CONFIRMED`: a safely mapped provider confirmation under documented provider semantics.

Do not add `EXPECTED`, `LIKELY`, or `STARTING` internally; map provider words to the three values. Existing manual `selected` remains a manual Analyzer state and must not enter the automatic contract.

Use separate resolver/health outcomes such as `RESOLVED`, `CONFLICT`, `STALE`, `PROVIDER_UNAVAILABLE`, `IDENTITY_UNRESOLVED`, and `GAME_UNRESOLVED`. `CONFLICT` is not a goalie status because it describes competing observations. For model input, every non-`RESOLVED` outcome degrades to `UNKNOWN`.

## 17. Freshness/staleness rules

A record is eligible for live display/Official T2 only when all are true:

1. Canonical game ID, teams, type, and scheduled start still match current fresh NHL schedule.
2. Provider event start/date matches that canonical start.
3. `observedAt` and `lastVerifiedAt` are valid, not in the future, and at or before the prediction capture.
4. The observation is within a configured freshness interval. Initial recommendation: no more than 15 minutes old inside T-4h/T0 and no more than 45 minutes old in T-12h/T-4h, aligned with proposed polling cadence.
5. Player identity mapping remains valid for the observed team/game.
6. Provider parser/contract validation succeeded for the whole relevant record.

On reschedule, invalidate all prior current-state rows tied to the old `scheduledStartAt`; never carry a confirmed state forward. A provider record dated yesterday or lacking a defensible event start cannot satisfy Official T2. Keep last good data for diagnostics/UI as explicitly stale, but never apply it to the official model.

## 18. Conflict policy

Recommended conservative resolver:

- Same mapped NHL player from all fresh providers: resolve that player and use the strongest supported status, preserving every provider/status.
- Different mapped players from two fresh providers, at any status combination: `CONFLICT`; Official T2 uses `UNKNOWN`/neutral. Live UI may show both observations and their statuses.
- Two different confirmed players: always `CONFLICT`; never break the tie through provider ordering.
- One valid provider plus another provider failure/stale/missing record: use the one valid provider, but retain health metadata. Absence is not disagreement.
- A mapped result must never outrank an unmapped name by fuzzy inference; the unmapped record is a mapping warning, not a conflicting identity.

This deliberately prioritizes auditability over coverage. If later evidence supports a `CONFIRMED`-over-`PROJECTED` arbitration rule, introduce it only as a versioned resolver change with tests and metrics.

## 19. Manual override separation

Future automatic state must be global and read-only from the user's perspective. Existing `GameContext.goalieSelections` should be treated strictly as manual live-Analyzer overrides.

Resolution by surface:

- Official T2: automatic global state only; never read `GameContext.goalieSelections`.
- Live Dashboard: automatic state by default, optionally replaced by that owner's explicit manual game override.
- Analyzer: show the automatic observation and allow the current manual dropdown/adjustment without altering global state.
- Saved bet snapshots: preserve the live/manual analysis actually used, as today.

Do not copy automatic data into `GameContext`; doing so would blur provenance and make later provider updates look like owner edits. Existing roster selection `source: provider_goalie` should be relabelled conceptually as a manual NHL-roster selection in future contracts, even if the persisted legacy value remains for compatibility.

## 20. Cron integration assessment

The existing Railway one-shot command connects once and dispatches Official T2, odds capture (only when configured), and demo cleanup through `Promise.allSettled` (`server/scripts/runOddsCaptureCron.js:14-51`). This is a good host for a fourth independent starting-goalie refresh job. Odds key/quota and goalie-provider configuration must remain independent.

Pure parallel dispatch would create a race: T2 might read old state while refresh is still running. Recommended orchestration:

```text
goalie refresh (bounded; failures converted to a result)
    -> Official T2 capture reads only observations completed at/before generatedAt

odds capture ------------------------------- independent/in parallel
demo cleanup ------------------------------- independent/in parallel
```

The T2 dependency must continue after refresh failure and apply fresh prior state or `UNKNOWN`. Odds and cleanup must never await goalie refresh. Give the provider fetch a short timeout so it cannot consume the T2 window; the existing T2 service already rechecks window eligibility immediately before insert.

Use a dedicated scheduled-job lease. Avoid a frontend trigger, per-user fetch, interval worker, or second Railway service until operational evidence requires one.

## 21. Polling-window and request-volume estimate

Recommended window/cadence for an authorized batch/date feed:

- T-12h through T-4h: at most every 30 minutes.
- T-4h through scheduled start: every five-minute cron tick.
- Stop after game start; invalidate/replan on schedule change.
- Fetch once per relevant provider date/slate, not once per user or game.

This captures morning projections while concentrating confirmation checks near game time. The five-minute Railway cron remains the scheduler; the job skips non-due slots.

Estimates below use six games for a normal day, 14 for a heavy day, 1,312 regular-season games, a 12-hour window, and inclusive endpoints. They are request opportunities, not guaranteed provider billable units:

| Strategy | Normal day | Heavy day | Regular season |
|---|---:|---:|---:|
| Per-game, five minutes for full T-12h | 870 | 2,030 | 190,240 |
| One date/slate fetch, five minutes; games span ~4h/~6h | ~193 | ~217 | ~36,700–41,200 over ~190 active dates |
| One date/slate fetch, proposed tiered cadence | ~113 | ~137 | ~21,500–26,000 over ~190 active dates |

The date/slate estimates include the extra span from the first game's polling start to the last game's start. Early confirmation does not automatically justify stopping all refreshes because assignments can change, but contract limits may support slowing already-confirmed slates. Provider contract/rate limits remain authoritative.

## 22. Persistence/cache recommendation

One-shot cron and web processes do not share server memory, so current state needs small global persistence if live UI and T2 both consume it.

Add one global current-state document per `(gameId, scheduledStartAt, teamId, provider)`, or a game document with two bounded side/provider entries. Update the same document on successful checks. On identical data, update only `lastVerifiedAt`/provider health; do not append a five-minute history record. On a meaningful identity/status change, update `stateFirstObservedAt` and emit one change log.

Keep three concepts separate:

- current global provider observations/resolution;
- immutable owner-specific Official T2 snapshot; and
- optional authoritative actual starter.

Do not use owner-scoped `GameContext` for global data. Do not store raw provider JSON/HTML. A TTL or scheduled cleanup can remove current-state rows after a conservative postgame retention period, but deletion design is out of Phase 1 unless required for bounded storage.

## 23. Failure isolation

Future behavior:

- Timeout/HTTP error/rate limit/block: record one bounded provider failure, honor `Retry-After`, retain but mark prior state health, and use it only while fresh.
- HTML/layout/schema change: reject the payload atomically; do not partially rewrite current state.
- Missing goalie: store/resolve `UNKNOWN` for that side if the provider response is otherwise valid.
- Malformed timestamps or stale date: reject that record.
- Unknown/ambiguous goalie: `IDENTITY_UNRESOLVED` -> `UNKNOWN`.
- Game mapping failure: no write under a guessed NHL game.
- Provider unavailable at T2: capture the rest of Official T2 normally with goalie `UNKNOWN`/`0.00`.
- Provider failure: never prevent Dashboard load; live endpoint returns explicit stale/unavailable state.

Minimal logs/counters should be change/error oriented: `starting_goalie_fetch_failure`, `starting_goalie_mapping_failure`, `starting_goalie_game_mapping_failure`, `starting_goalie_conflict`, and `starting_goalie_status_change`. A success summary per run is sufficient; do not log every unchanged side or raw response. Never log credentials.

## 24. Demo/multi-user implications

`scheduledForwardPredictionService.ACTIVE_USER_FILTER` combines active status with `getProductionAccountFilter`, excluding `DEMO_SANDBOX` from Official T2 (`server/services/scheduledForwardPredictionService.js:10-15`; `server/config/accountTypes.js:18-31`). Odds bookmaker selection is also production-account scoped, while cleanup independently targets demos. The cron is globally scheduled, not demo-triggered.

Starting-goalie provider retrieval should be global schedule work and make zero queries/requests per demo or per production user. Demo UI may read the same already-fetched objective global NHL state if product policy wants it, but a demo request must never initiate or refresh the provider. A global current-state model must be excluded from demo-owned cleanup inventories (`server/services/demoSandboxCleanupService.js:24-45`).

Per-user goalie adjustments and manual Analyzer overrides remain owner-scoped and strictly isolated. At T2, join one global confirmed identity to each owner's saved `GoalieAdjustment`; default to `0.00` when the owner has no mapping. Never accept a client user ID.

## 25. Official T2 ordering/timestamp semantics

Recommended timestamp definitions:

- `providerPublishedAt`: provider-supplied record/news publication time; nullable.
- `confirmedAt`: provider-supplied confirmation time only when its contract explicitly defines it; nullable.
- `fetchedAt`: transport response completion time (can be internal run metadata).
- `observedAt`: when NHL Edge successfully parsed/validated this provider observation; normally the same instant or just after `fetchedAt`.
- `stateFirstObservedAt`: first NHL Edge observation of this exact `(goalie,status)` state.
- `lastVerifiedAt`: most recent successful verification of unchanged state.
- `officialPredictionCapturedAt`: existing snapshot `generatedAt`/write time.
- `scheduledStartTime`: canonical current NHL scheduled start; existing `scheduledStartAtCapture` in the snapshot.

Deterministic semantics: a refresh must finish before T2 reads it, and the observation used must have `observedAt <= officialPredictionCapturedAt`. Never backdate `observedAt` to a cron slot, and never substitute fetch time for provider confirmation time. If a refresh finishes after the captured snapshot, it affects live state only. If refresh delay pushes capture outside T-75, the existing eligibility check should decline late capture rather than reconstructing an earlier information state.

## 26. Forward-performance implications

To support future analysis without reconstructing history, each Official T2 side must preserve:

- mapped NHL goalie ID/name or null;
- normalized status;
- provider and provider/parser/contract version;
- observation, provider publication, and confirmation timestamps where legitimate;
- source attribution/reference where supplied;
- resolution/conflict/freshness outcome;
- exact applied adjustment; and
- canonical game/start identity.

That permits later counts by status, provider agreement, confirmation timing, projected-to-actual accuracy, and Brier/calibration segmentation by goalie completeness. The NHL actual-starter ID can be joined after the game by canonical game ID. Do not add UI KPIs in Phase 1.

## 27. Future test strategy

Provider fixtures/parsing:

- projected, confirmed, missing, malformed, renamed/missing field, and total layout/contract change;
- source and timestamp present/absent;
- no invention of `confirmedAt`;
- unauthorized/auth/rate-limit responses;
- fixture-only tests with no live provider dependency.

Player identity:

- provider NHL ID validates;
- unique exact team/name match;
- accent/punctuation/Unicode normalization;
- initials/suffixes and explicit aliases;
- duplicate/ambiguous name fails closed;
- unknown player and non-goalie fail closed;
- trade, roster move, and emergency call-up behavior.

Game identity:

- exact normal game;
- timezone/date edge;
- preseason, regular season, playoffs;
- same teams on nearby dates;
- postponed/rescheduled game invalidates old start;
- stale provider date/start cannot match;
- ambiguous candidate fails closed.

State transitions/resolution:

- `UNKNOWN -> PROJECTED -> CONFIRMED`;
- projected goalie changes;
- confirmation switches identity;
- identical observation changes only `lastVerifiedAt`;
- confirmed/confirmed, projected/projected, and confirmed/projected identity conflicts;
- provider failure versus true disagreement;
- stale and future timestamps.

Official T2:

- confirmed before T2 is embedded/applied;
- projected at T2 is embedded but neutral in Phase 1;
- unknown/conflict at T2 is neutral;
- later confirmation changes live state but not snapshot;
- observation after capture is ineligible;
- manual roster/custom/adjustment/status submissions are all excluded;
- user team-default adjustment joins by mapped NHL ID and its exact value is snapshotted;
- missing user goalie adjustment is neutral;
- provider failure does not block the snapshot;
- reschedule creates a new identity and cannot inherit old goalie state;
- settings/provider/resolver versions are reproducible.

Cron/failure isolation:

- goalie refresh deterministically precedes T2 read;
- refresh timeout/failure still runs T2, odds, and cleanup;
- missing Odds API key still permits goalie/T2 work;
- goalie credentials absent skips only goalie refresh;
- demo users trigger zero provider requests;
- one provider fetch is shared globally, never per owner;
- leases/concurrent runs are idempotent.

Actual result:

- one NHL `starter: true` per side;
- goalie substitution preserves original starter;
- incomplete/multiple/no starter fails closed;
- final actual starter joins only matching game/start/teams.

## 28. Security/access assessment

Daily Faceoff public page required no observed login/cookie and exposed embedded data, but no supported API/license was found. Do not use or probe its disallowed `/api/`, bypass Cloudflare, or rely on undocumented browser tokens.

RotoWire's supported syndication feed likely requires commercial credentials and agreement; exact mechanism is unknown until onboarding. Public-page automation conflicts with its published use restrictions and is unsuitable.

Any future key/token belongs only in server/Railway secret configuration, never the client, database record, logs, provider references, fixtures, or repository. Use bounded timeouts, strict response size/content-type/schema validation, HTTPS, and allowlisted provider hosts. Never send NHL Edge user data to a goalie provider. No Playwright/Puppeteer/Selenium is justified.

## 29. Architecture options

### Option A — licensed RotoWire primary + NHL verification

- Complexity: medium; structured adapter, global state, mapping, T2 integration.
- Reliability: potentially high; supported XML/JSON route and custom IDs are publicly advertised.
- Maintenance: lower than website parsing, contract-dependent.
- Dependence/cost: commercial single-provider dependency; price/SLA unknown.
- Official T2: suitable if feed delivers timely status/timestamps and permits cadence.
- Risk: procurement, credentials, exact NHL ID/game ID availability, and timestamp semantics unresolved.

### Option B — Daily Faceoff supported/licensed feed if available + NHL verification

- Complexity: medium.
- Reliability: potentially good because visible data has confirmation/source/timestamps.
- Maintenance: acceptable only with a documented feed; high if based on Next.js payload.
- Dependence/cost: licensing/API availability unknown.
- Official T2: attractive if the timestamp and confirmation semantics are contractually clear.
- Risk: no public supported API located. Public page parsing must not be the default production plan.

### Option C — provider-neutral foundation first; connector disabled until authorized

- Complexity: medium initially, lowest external operational risk.
- Reliability: preserves current behavior while schema, resolver, fixtures, actual-starter capture, and T2 isolation are built/tested.
- Maintenance: clean provider adapter boundary.
- Provider dependence: deferred.
- Official T2: stays `UNKNOWN` until a provider is enabled; no false automation.
- Risk: does not deliver live automatic goalies by itself, but avoids building against an unauthorized/unstable interface.

A two-provider Daily Faceoff + RotoWire launch is not recommended. It doubles mapping/conflict/contract/operational surface before either feed's real accuracy and timing are measured.

## 30. Recommended Phase 1 architecture

1. **Pregame provider:** start with RotoWire only if NHL Edge secures its supported XML/JSON feed and acceptable terms. In parallel, ask Daily Faceoff whether a supported/licensed feed exists; prefer it only if documented terms/data semantics are at least as strong.
2. **Secondary provider:** later, after measuring primary accuracy/availability. Do not scrape a secondary for nominal redundancy.
3. **Player identity:** provider NHL ID if available; otherwise explicit provider-ID map or unique exact team-roster name match; all failures -> unknown.
4. **Game identity:** NHL game ID/start/teams/type are canonical. Strictly validate provider start/team mapping and invalidate on reschedule.
5. **Statuses:** `UNKNOWN`, `PROJECTED`, `CONFIRMED`; keep conflict/health separate.
6. **Projected model use:** preserve/display/snapshot, but do not apply adjustment in the first automatic model version.
7. **Unknown:** retain current neutral `0.00` behavior and explicit incompleteness.
8. **Current state:** one small global provider-neutral store, not `GameContext` and not per user.
9. **Official T2:** embed full normalized observation/provenance and applied adjustment; never reconstruct or mutate it.
10. **Cron:** use the existing five-minute one-shot entrypoint with a dedicated lease and deterministic refresh-before-T2 dependency; keep odds/cleanup parallel and independent.
11. **Polling:** T-12h/T-4h every 30 minutes, T-4h/start every five minutes, batch per date/slate, no post-start polling.
12. **Failure:** retain last data for diagnostics, but stale/unresolved data becomes `UNKNOWN`; other jobs and Dashboard continue.
13. **Conflict:** differing fresh mapped identities become `CONFLICT` and neutral for Official T2.
14. **Schema/storage:** add global current state and embedded snapshot goalie observation; do not alter `GameContext` into a global store or save raw payload/history.
15. **Actual starter:** add NHL boxscore normalization for postgame validation and later metrics.

## 31. Exact proposed Phase 1 scope

Phase 1 should implement, only after provider authorization/sample contract:

- provider-neutral observation/resolution contracts and validators;
- one authorized provider adapter with recorded parser/contract version;
- strict NHL game and goalie identity mapping;
- global current-state persistence with change detection and freshness;
- NHL boxscore actual-starter normalization;
- read-only live API composition for Dashboard/Analyzer;
- minimal Starting goalies status/provider/updated display without redesign;
- explicit manual override precedence for live calculations;
- removal of `GameContext.goalieSelections` from Official T2 input assembly;
- owner-specific saved goalie-adjustment lookup by automatic NHL player ID;
- immutable snapshot expansion and a versioned calculation/input contract;
- bounded cron refresh, ordering, lease, failure isolation, and low-noise logs;
- the focused test matrix in section 27.

Before model activation, run a shadow period that records/snapshots status and compares against NHL actual starters without changing Official T2 probabilities. Promote confirmed-goalie model use only through an explicit versioned release. Projected-goalie model use remains a later evidence-based decision.

## 32. Explicit out-of-scope items

- Public-site scraper implementation or browser automation.
- Bypassing authentication, paywalls, robots rules, rate limits, or bot protection.
- Secondary provider at launch.
- Fuzzy player matching.
- Raw provider payload/history storage or five-minute observation history.
- Goalie adjustment formula changes.
- Automatic power-rating updates from Analyzer state.
- Reconstructing or updating historical Official T2 snapshots.
- Provider-accuracy dashboards/KPI clutter in Phase 1.
- Railway schedule/service redesign, Docker changes, or Odds API coupling.
- Production credentials, database writes, deployment, commit, or push.

## 33. Files changed

- `STARTING_GOALIE_PHASE_0_AUDIT.md` — this audit only.

No application source, package manifest/lockfile, schema, test, deployment, Docker, Railway, GitHub Actions, or cron file was changed.

## 34. Production side effects

**NONE.**

No production endpoint or credential was used. No production database was read or written. No cron, server, provider job, deployment, commit, or push was run. External research used a few read-only requests to public pages/endpoints only.

## 35. Open questions / blockers

1. Will Daily Faceoff offer NHL Edge a supported/licensed starting-goalie feed, and what are its schema, IDs, timestamp semantics, polling rights, SLA, and cost?
2. What are RotoWire syndication pricing, authentication, rate limits, NHL game/player ID support, source attribution, update/confirmation timestamps, redistribution/display rights, and historical correction behavior?
3. Which provider contract supplies the strongest canonical ID mapping? Obtain sample payloads before final schema naming.
4. Confirm the allowed polling cadence contractually; estimates in section 21 are upper-bound planning numbers.
5. Decide whether Phase 1 is allowed to add the small global current-state collection and immutable snapshot fields proposed here.
6. Decide whether to shadow automatic confirmed goalies for a period before letting them affect Official T2. This audit recommends yes.
7. Define the stale threshold with observed real feed behavior; the proposed 15/45-minute thresholds are conservative starting values.
8. Confirm whether NHL actual-starter records should be persisted once per game or resolved on demand and cached. Existing historical storage is insufficient.

Implementation of a live provider connector is blocked until an authorized structured feed and sample contract are available. Provider-neutral Phase 1 design, fixtures, and migration planning can proceed now.
