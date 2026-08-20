# NHL Edge Frontend

## NHL Standings

The sidebar includes a read-only `Standings` page after Teams. It defaults to
the canonical current NHL season and offers the current season plus five recent
historical regular seasons. Conference is the default hockey-focused view;
League and Division views regroup the same normalized league-wide response
without additional provider requests.

Each compact table follows official NHL ordering and displays Rank, Team, GP,
W, L, OT, PTS, P%, GF, GA, DIFF, Last 10, and streak. Provider logos and
season-specific names are retained, including Arizona Coyotes, Utah Hockey
Club, and Utah Mammoth branding. Official clinch markers are shown when the NHL
response includes them; the client does not infer playoff qualification. A
compact legend immediately below the controls explains `x` playoff berth, `y`
division title, `z` conference title, `p` Presidents' Trophy, and `e`
elimination. Each badge also has its own accessible label and tooltip. Combined
codes render as separate badges, while an unknown provider code remains visible
with a neutral official-indicator description rather than a guessed meaning.

The selector keeps League, Conference, and Division in one visual group and
places Playoffs on the same row after a 16px gap. Only one view is active. The
existing Season selector controls both standings and playoffs, and switching
back restores the already loaded standings view.

Playoffs shows official NHL bracket series and results for completed seasons
and an active current postseason. Conference sections progress through Round 1,
Round 2, and Conference Final, followed by a dedicated Stanley Cup Final. Cards
show season-specific team identity, logos, series wins, an explicit text winner,
and TBD for unknown future teams. A completed official final adds a compact
Stanley Cup Champion summary. Rounds stack vertically on narrow screens.

Before the current playoffs begin, the same view is labeled `Projected` and
`If playoffs started today`. These matchups come from the official standings
division and wildcard order and are explicitly described as a standings
snapshot—not NHL Edge model predictions. Future-round teams remain TBD. Clean
loading, `provider_error`, `unavailable`, and `projected_unavailable` states
replace empty bracket shells.

Current standings come from the official NHL Web API's latest standings
resource. Historical selections are final regular-season snapshots requested
at each season's canonical end date. The client caches loaded seasons for the
life of the page, while the server applies short current and long historical
caches. Preseason, unsupported historical data, loading, and safe provider
failure states stay inside the page and never blank the application.

Standings are explicitly informational. The page imports no model calculation
pipeline and does not change Power Ratings, Effective Rating, probabilities,
Home Advantage, Motivation, bet recommendations, or Rating Lab. Its normalized
records and conference/division ranks are reusable for a future Season
Simulator, but no simulator, playoff probability, series probability,
date-specific standings snapshot, or automatic Motivation feature is included.

## Market Odds Phase 1

Authenticated Dashboard loads request current NHL moneyline odds from the NHL
Edge server after the schedule is available. Odds are requested once for the
selected date on initial load, again for a different selected date, and with a
bounded forced-refresh hint when the user selects `Refresh`. There is no
background polling and no request per game card.

Phase 1 uses The Odds API's EU region and decimal `h2h` prices. Dashboard cards
show the best valid away and home price with its bookmaker; the two best prices
may come from different bookmakers. Existing preliminary analysis then reuses
the same EV, probability-edge, Bet Candidate, and Kelly calculation paths.
One-sided responses calculate only the available side.

Manual Dashboard odds remain fully supported and take priority over provider
values. Analyzer receives the displayed Dashboard values and provider metadata,
does not silently overwrite edits, and offers `Use Latest Market Odds` as an
explicit action when a provider snapshot is available. Saved bets preserve the
odds actually used plus their source; an edited provider value is stored with
source `Manual` and no provider provenance. Later refreshes do not mutate saved
historical snapshots.

The compact Dashboard status reports loading, provider/cache freshness,
configuration, availability, quota exhaustion, and low-credit warnings when
quota metadata exists. Settings includes a read-only Market Odds status card.
The provider API key is server-only and must never be added to client `.env`
files or any `VITE_` variable.

## Market Odds Phase 2A

Settings now includes `External Data` → `Preferred Bookmakers`. It lists the
bookmakers observed in the latest provider response, defaults all of them to
enabled, and saves the selection for the authenticated user. Attempting to
disable every bookmaker restores all selections and shows an explanation.

Dashboard and Analyzer calculate best home and away prices only from enabled
bookmakers. `View Market Odds` and `View All Bookmakers` expose the complete
bookmaker table, including disabled rows, and can sort by home odds, away odds,
or bookmaker. Analyzer identifies the current price source and provider update
time. Provider event IDs, timestamps, selected bookmaker, and selected odds are
preserved when a provider-backed bet is saved; editing an odds input changes
the source to `Manual`.

Current limitations: no market consensus, de-vig, historical/opening odds,
line movement, live updates, spreads, totals, props, polling, or betting
automation.

## Provider Goalie Adjustments and Analyzer Selection

The Teams page uses the existing NHL provider roster as the authoritative
goalie list. Each provider goalie row includes a compact inline editor for the
authenticated user's model adjustment and optional note. Adjustments use the
authenticated user's configured Maximum Goalie Penalty through `0.00`, in
`0.05` increments; positive adjustments are not allowed. Team Power Rating is
assumed to include the normal #1 goalie, so `0.00` is that team baseline and
backup or third-goalie values are relative negative downgrades. The inline
editor includes a compact guidance scale and displays the current maximum.
Unedited goalies display an implicit `0.00` and do not create a database
record; there is no separate Add goalie or user-maintained roster flow.

Analyzer starts both teams at `Unknown starter` with a zero adjustment and does
not auto-select a goalie. Each side lists every current provider goalie with
its user adjustment, followed by `Other / Unlisted goalie` and `Unknown
starter`. Provider selections can use the team default or one game-specific
override. A custom name/note is optional, but its single game adjustment is
required, bound by Maximum Goalie Penalty, and never saved as a team default.
Unknown starter remains neutral at `0.00` with no adjustment input. Exactly one
effective goalie adjustment per side reaches the shared calculation path.

Maximum Goalie Penalty is a user-scoped setting shown in the dedicated Goalie
card under Model Adjustments, with default `-4.00`. It remains in the existing
Power Rating Engine settings document; the UI relocation does not introduce a
second settings source. Existing saved defaults outside a newly tightened range
are preserved without clamping or rewriting. Teams surfaces the issue when the
value is edited; Analyzer continues to show the exact saved value but requires
review or a valid game override before the selection or a bet can be saved.

Scheduled-game choices save into the existing game context and appear on the
Dashboard. Saved analyses and bets carry full immutable goalie-selection
snapshots with `provider_goalie`, `custom`, or `unknown` provenance, so later
default edits do not change historical display. Legacy goalie selections remain
readable. Injury Manager automatically treats current roster goalies, and
manual entries whose position is `G`, as reference-only goalie availability.
Those records remain visible but contribute `0.00`; Starting Goalies remains the
only goalie model-adjustment source.

Current limitations: no automatic starter detection, depth-chart roles,
automatic goalie ratings, scraping, projections, performance automation, or
historical goalie analytics.

## Injury Manager and Analyzer Injury Context

Injury Manager uses the existing team roster provider only for player identity.
Its single Player combobox can be browsed or searched by name, canonical
position, or jersey number, then snapshots player name, provider player ID, and
position. `Other / Unlisted player` remains available during loading, empty, and
error states and reveals the manual fields only after selection. Saved records
remain readable after roster movement; old records without an ID or position
display as manual/unknown and are not guessed onto a current player.

Injury adjustment is the manually reviewed downgrade caused by an absence for
that specific team, not an absolute player value. Replacement quality and team
depth matter, so `0.00` is valid for an active, adequately replaceable player.
Skater choices use `0.50`-point steps from `0.00` down to the authenticated
user's Maximum Player Injury Penalty, which defaults to `-2.50`. That setting
caps one skater record only: multiple active skaters may sum beyond `-2.50`, and
there is no team-level cap. Existing arbitrary values are preserved; when their
impact is changed, a current valid step is required.

Stored injury impact is the sum of negative active skater records only. Healthy
and historical records contribute zero, while active `0.00` skaters stay visible
for lineup context. Provider goalies and unlisted position-`G` records are
reference-only even if a legacy row contains a stale negative impact. Analyzer
shows the active players and positions behind both team totals, de-emphasizes
zero-impact rows, and labels goalie availability separately. Its existing Game
injury adjustment remains additive for cumulative, positional-depth, or
matchup-specific effects not already represented by stored records; users should
avoid double counting.

Teams with historical records expose `Clear history` beside `Show history`.
After an explicit team-and-count confirmation, it deletes only that signed-in
user's inactive or healthy rows for that team, refreshes Injury Manager and the
shared summary in place, and leaves active skaters, active goalies, and stored
model impact unchanged. Individual delete and Mark healthy remain available.

No injury feed, player valuation, lineup optimizer, replacement projection, or
automatic cumulative penalty is introduced. Player selection supplies identity
and context only; impact remains a deliberate user judgment.

## Team Model Values Phase 1

Team Details includes a compact, user-maintained `Model Values` card after the
provider Special Teams statistics and before the provider roster sections. It
summarizes the existing goalie adjustments without duplicating their editor,
plus all four optional forward lines, all three optional defense pairs, and the
saved personal lineup note. The summary is read-only and has one shared
`Manage Model Values` action. Forward Lines and Defense Pairs share a compact
two-column summary on wide layouts and stack without horizontal scrolling on
narrow screens.

`Manage Model Values` opens one responsive modal with four optional forward
lines, three optional defense pairs, Team Notes, and a read-only goalie summary
that links to the existing provider goalie editor. Player selection uses NHL
player IDs from the current provider roster: forwards are available in any
LW/C/RW slot and defensemen are available in either LD/RD slot. Incomplete and
empty rows are valid. Saved slot names are non-authoritative snapshots, so the
summary and existing modal selections remain visible if the NHL provider is
unavailable. The current provider name wins when present. During an outage,
player replacement is disabled but Team Notes remain editable and saved player
IDs are never cleared. Duplicate selections show a non-blocking warning.

Model Values, goalie adjustments, Power Ratings, injuries, and notes load as
local user-scoped application data independently from provider sections.
Special Teams begins shortly after Team Details renders. The lower roster area
loads near the viewport (or immediately when the editor needs selectors), and
one shared client/server roster request supplies forwards, defensemen, and
goalies. Goalie summaries begin when the goalie section approaches the
viewport. Client requests reuse cached and in-flight work, retain loaded data
during refresh, and isolate late responses by team. NHL 429 responses degrade
only their provider section; safe stale cache is labeled subtly. There is no
continuous polling or automatic roster synchronization into saved lines.

These lineups are personal, authenticated, user-scoped notes. They do not
affect Power Ratings, Dashboard preliminary analysis, Game Analyzer, injuries,
goalie adjustments, special-teams ratings, Bet Candidate logic, Kelly sizing,
or saved bets. Provider PP/PK statistics remain separate. Phase 1 has no PP/PK
units, automatic lineup feed, historical versions, game-specific lineups, or
lineup automation. Existing goalie adjustments remain separate and continue to
affect the model through their existing calculation path.

## Special Teams Matchup production modes

Dashboard game cards and Game Analyzer use one normalized Special Teams
matchup result from the existing **Previous 3 seasons** Power Play and Penalty
Kill league ranks. Alert only is the default, with a Top/Bottom threshold of
`6` and symmetric magnitude `0.50`. For a 32-team league, Top/Bottom 6 means
ranks `1–6` and `27–32`; the bottom boundary follows the league-team count
returned with the cached dataset.

- `Strong PP vs Weak PK` is shown when a Top N power play faces a Bottom N
  penalty kill.
- `Weak PP vs Strong PK` is shown when a Bottom N power play faces a Top N
  penalty kill.
- Away PP versus Home PK and Home PP versus Away PK are evaluated
  independently, so both teams may have signals in one game.

Settings > Game Context contains one `Special Teams Matchup` configuration:
Off, Alert only, or Automatic adjustment; a validated integer threshold from
`3` through `12`; and `0.25`, `0.50`, `0.75`, or `1.00` magnitude choices.
These authenticated, user-scoped fields remain in the existing rating-engine
settings document. Existing users without a mode default to Alert only, while
the legacy disabled state maps to Off. Settings reset and Factory Reset use the
same canonical defaults.

The client loads one shared league dataset through the existing team-data
coordinator. In-flight and short-lived client requests are deduplicated, while
the server reuses its existing eight-hour league Special Teams cache. Opening
Dashboard does not issue one request per NHL team.

Off hides Dashboard and Analyzer context and applies zero. Alert only shows the
existing signal with a read-only `0.00` contribution. Automatic adjustment
keeps the alert and maps Strong PP vs Weak PK to `+X` and Weak PP vs Strong PK
to `-X`, independently for each team. Dashboard preliminary analysis and
Analyzer both apply the same normalized field exactly once to Effective Rating;
Kelly receives no separate Special Teams logic. Missing data never fabricates
ranks or a rating effect. Saved analyses and bets retain the original mode,
signal, threshold, ranks, and applied value even if Settings later change.

## Starting Rating Scale

The Power Ratings page owns the persisted `Starting Rating Scale`. It is an
initialization guardrail, not a live-rating boundary. The compact control uses
range-first presets: `42–48`, `42–50` (the Base Model v1 calibrated default),
`40–50`, and `40–52`. Custom mode accepts minimum and maximum starting ratings;
center and total spread are derived internally and persisted.

The scale remains editable during preseason. It locks only after the current
active season contains a real processed production rating game, using season
metadata rather than the calendar date alone. Prior-season history does not
lock an upcoming preseason. Once locked, the saved range remains visible but
the selector and Custom inputs cannot be changed.

The lock applies only to scale configuration. Manual live Rating, Home
Adjustment, and Manual Adjustment edits remain available, Rating Engine updates
are never clamped, and ratings can move above or below the starting range.
Changing or saving an unlocked selector does not redistribute or rewrite team
ratings; only explicit seed/reset behavior uses the selected center. No
automatic rank-to-rating distribution is implemented.

Non-default ranges have not been calibrated to the same degree as `42–50`.
`Probability Scale`, K factor, Home Advantage, and other model parameters are
not changed by this control. Rating Lab keeps its own calibration controls.

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
settings. Changes affect future rating updates only. Previously processed games
are not recalculated. Rating Lab stays independent.

If one or more games are processed, the page refreshes the Power Ratings list
and summary cards without a full browser reload. The update result also shows
games found, already processed, processed, skipped, errors, and compact
per-game rating changes when available.

## Rating Lab Base Model Calibration

Rating Lab now includes a separate `Base Model Calibration` Phase 1 mode. It is
visually marked Experimental and production-isolated. The setup defaults to the
latest completed regular season. Historical Seasons are visible checkboxes with
single-season, multi-season, Select all, and Clear behavior. Each season uses its
central metadata boundaries by default; an explicit custom range is available
only when exactly one season is selected. The control shows selected-season and
estimated-game counts plus the season-boundary source. Each season also shows
its shared historical dataset state: `Ready` with the local game count,
`Partial` with persisted progress, `Not prepared`, or active preparation. The
row exposes Prepare, Resume, or explicit Refresh dataset actions as appropriate.

Selecting an unavailable season automatically queues one preparation attempt.
Multiple selected seasons prepare sequentially, and render changes do not start
duplicate imports. Preparation runs independently from the calibration controls,
shows saved progress, and leaves the rest of the form usable. If the NHL service
rate limits a request, the preparation queue pauses with a friendly explanation;
all completed windows stay in MongoDB and the manual Resume action reuses them.
Ready old seasons are reused locally without automatic time-based refresh.

Starting-rating comparisons include Current production values and fixed-spread
presets `37–55`, `40–52`, and `42–50`, plus a configurable centered spread. A
fixed spread uses current ordering only for the latest historical season. Older
seasons explicitly report the franchise-normalized fallback ordering when a
historical preseason snapshot is unavailable. Current production starts are
disabled for cross-season runs and warned as potentially biased for older
single-season runs. At least two runs must be selected.

Every selected season is replayed independently with a fresh starting state.
Results include pooled metrics calculated from every prediction, unweighted
average season Brier, best/worst season, Brier range and standard deviation, a
transparent stable/mixed/unstable label, and a per-season table. The comparison
can sort by pooled Brier, average season Brier, worst season Brier, pooled log
loss, pooled ECE, or accuracy. If one season fails, successful seasons remain
visible and aggregate coverage is marked incomplete. A visible Season Coverage
section lists every selected season, inclusive boundaries, data source,
found/included/skipped counts, expected full-season range, and a readable failure
reason. One completed season leaves stability not assessed; two or more completed
seasons calculate range and standard deviation, with partial coverage qualified.

Complete and partial coverage sets are not ranked as though they were equivalent.
Complete runs take precedence; partial runs are ranked only against runs with the
same requested and completed season sets and are labeled as partial. Comparison
requests run sequentially, retain successful responses, keep the Run button
disabled while active, and ignore a response that is no longer the newest run.

The editable probability scale, home advantage, K factor, result multipliers,
and fixed starting spread use the calibrated Base Model v1 references: range
`42â€“50` centered at `46`, scale `20`, Home Advantage `3.5`, K `1.3`, regulation
`1.0`, overtime `0.4`, and shootout `0.1`. Production Settings changes do not
silently alter these Rating Lab inputs. A live reference table shows the
formula's home-win probabilities as scale and home advantage change. Phase 1
explicitly excludes goalie, injury, lineup, rest, travel, manual, and Analyzer
adjustments.

The baseline was calibrated from the 2023â€“24, 2024â€“25, and 2025â€“26 regular
seasons (approximately 3,936 games). The UI does not present it as statistically
optimal or as guaranteed predictive performance.

Settings keeps Probability Scale inside the collapsed Power Rating Engine
Advanced Model Settings. Maximum Goalie Penalty and Maximum Player Injury
Penalty appear in dedicated Goalie and Injury cards under Rating Model
while remaining persisted in the same authenticated user's Power Rating Engine
settings document. They default to `-4.00` and `-2.50`; the injury value uses
`0.50` increments and limits one skater record rather than the team total.
Probability Scale is used by Dashboard
preliminary analysis, Game Analyzer, fair odds, and future automatic rating
updates. Power Rating Engine reset restores scale `20`, K `1.3`, and result
multipliers `1.0`/`0.4`/`0.1` without resetting Base Home Advantage, Maximum
Goalie Penalty, or Maximum Player Injury Penalty. Rating Model reset
restores Base Home Advantage `3.5`, Maximum Goalie Penalty `-4.00`, and Maximum
Player Injury Penalty `-2.50` within its own scope. Previously processed Power
Rating history is never recalculated.
Team-specific Home Adjustment calibration remains separate from Phase 1.

## Rating Lab Team Home Advantage (Phase 2)

The `Team Home Advantage` Rating Lab tab is a production-isolated Phase 2
workflow. It shows the current 2023–24 through 2025–26 pooled home-strength
ranking, gap-aware Strong/Normal/Weak tiers, tier summaries, exact boundary
diagnostics, league rates, and stability against the previous available
three-season window. The classifier starts near the one-third and two-third
ranks, searches ±3 ranks for the largest meaningful adjacent Home Points
Advantage gap, and never cuts an adjacent cluster whose gap is at most `0.001`
in proportion terms (0.1 percentage points). If no local gap is preferable, the
closest valid cut is deterministic. Each tier has at least the smaller of six
teams or one-third of the available league. Percentage differences are displayed
in percentage points (`pp`); Home Points Advantage uses two decimals, and the
table can be sorted by Home Points Advantage, Home Win Advantage, Home Points %,
or Home Win %.

Backtest readiness explicitly lists the three predecessor seasons used to
classify each replay season and allows missing seasons to be prepared using the
existing historical dataset controls. Tiers are frozen before each target
season, so the target's games never classify that same target. The result table
compares the Base Model v1 control with symmetric tier adjustments and shows
pooled Brier, Log Loss, ECE, Accuracy, season Brier diagnostics, stability, and
baseline deltas. It also reports the variable Strong/Normal/Weak tier sizes used
for each target season. Results from a different tier-algorithm version are not
shown as current comparisons.

The recommendation area is read-only. It previews Strong, Normal, and Weak
team lists plus their effective Home Advantage values, but exposes no apply or
production-write action. Arizona Coyotes and Utah Hockey Club history is shown
under the current Utah Mammoth franchise according to the centralized identity
mapping.

Results show Brier, log loss, weighted ECE, accuracy context, prediction range,
calibration buckets, favorite-confidence buckets, games found/included/skipped,
skip reasons, warnings, and center-invariance diagnostics. The final readout is
comparison guidance only: runs remain in page memory, are not saved, and never
modify production ratings or settings.

The results also show non-rating sanity baselines for a constant `50%`
prediction and a constant probability equal to the included dataset's
historical home-win rate. Each rating run is labeled as better than, equal to,
or worse than those baselines by Brier score; the baselines do not appear as
rating runs and produce no final team ratings.

## Automatic Dashboard Power Rating Updates

Dashboard runs an authenticated automatic Power Rating check on initial load and
when the user selects `Refresh`. It does not run merely because the selected
schedule date changes. The check runs alongside normal Dashboard data loading,
uses the same backend update workflow as the manual action, and refreshes the
shared Power Ratings state when new games are processed so preliminary
Dashboard analysis recalculates without a page reload.

Automatic updates only process newly completed eligible NHL regular-season
games. If update history already exists, the backend starts from the latest
processed game date with a small overlap and relies on idempotency to avoid
duplicate movement. If current-season history is empty, the backend uses the
configured ratings as the starting state and processes eligible games from the
canonical current-season start. Before the first eligible game, Dashboard
shows the neutral `Power Ratings ready for season start` state; it does not ask
the user to run an empty manual update.

The compact Dashboard status row can show checking, updated, up to date,
preseason-ready, unprocessed-games, partial, or unavailable states. An
unprocessed-games state uses an `Update Power Ratings` maintenance action.
Manual updates remain available for recovery, testing, selected date ranges,
and detailed processed-game inspection. A zero-game manual run creates no
history marker and does not lock the Starting Rating Scale. Cron jobs, polling,
WebSockets, full-season recalculation, and automatic replay after setting
changes are intentionally deferred.

## Power Rating Update History

Authenticated users can inspect persisted update audit records from
`Power Ratings` by switching from `Team Ratings` to `Update History`.

Update History shows user-specific `ProcessedRatingGame` records created by
manual and automatic update workflows. Records are immutable audit entries:
changing current Power Rating Engine settings does not alter prior snapshots,
and the history view does not edit, delete, roll back, or reprocess games.

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
represented range is clear. The official regular-season end date is preserved
in season metadata, while History derives `Date To` by adding one local calendar
day. This includes late games that appear on the following date in the user's
timezone; for 2025–26, the official end remains `2026-04-16`, while `Date To`
is shown and filtered as `2026-04-17`.

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
Betting Profit, Pending Exposure, Deposits, and Withdrawals. Available Bankroll
is spendable balance after new-bet stake debits. Current Bankroll adds open
exposure back as an equity view, while Pending Exposure is informational and is
not deducted twice. Betting Profit is separate from bankroll returns, deposits,
and withdrawals so cash movement does not inflate betting performance.

The period selector supports All time, available NHL seasons, and custom date
ranges using the same season metadata conventions as Power Rating Update
History. Named seasons fill and lock the date fields; Custom dates enables them
with the usual future-date and inverted-range validation. The ledger can also
be filtered by transaction type and paged with the row-count selector.

Deposits and withdrawals are recorded from compact inline forms. Withdrawals are
validated client-side and server-side against available bankroll; the backend is
authoritative for insufficient-funds errors.

Saving a new linked moneyline bet deducts stake immediately. `Settle completed
bets` deliberately calls one authenticated backend action, then refreshes bets
and bankroll data. Only final linked NHL games settle automatically. Regulation,
overtime, and shootout all count for moneyline; a win credits the full
`stake * decimal odds` return, a loss adds no further bankroll movement, and a
manual void or push returns stake. Cards show Pending, Auto-settled, or Manual
source labels and reuse stored final scores without an extra display request.

Unlinked legacy bets explain that automatic settlement is unavailable and keep
the manual result selector. Manual corrections reverse prior bankroll effects
before applying the new result. Stake is locked after settlement, settled bets
cannot be deleted, and deleting a pending transactionally funded bet returns its
stake exactly once. No background polling or scheduler runs from the client.

## Betting Settings

The Settings page includes `Betting & Staking`, a user-specific configuration
section for future Kelly stake recommendations in Game Analyzer. These settings
do not place bets automatically and do not modify existing bets.

Defaults:

- Kelly Mode: Quarter Kelly
- Custom Kelly Fraction: `0.25`
- Maximum Stake: `3%` of the selected bankroll basis
- Minimum Edge: `2` percentage points
- Stake Rounding: the active bankroll currency rounded to `0.50`
- Bankroll Basis: Available bankroll

Kelly modes map to fractions of Full Kelly:

- Full Kelly: `1.00`
- Half Kelly: `0.50`
- Quarter Kelly: `0.25`
- Custom: the saved Custom Kelly Fraction

Maximum Stake is a hard cap for future single-bet recommendations. Minimum
Edge is measured in probability points, not relative percent growth, and can
suppress low-edge recommendations. Stake Rounding controls the future displayed
stake increment.

Bankroll Basis can use Available bankroll, which excludes pending stakes, or
Current bankroll, which includes them. Settings shows bankroll currency and
status read-only. Currency remains owned by the bankroll profile; until a
bankroll is initialized, the display falls back to EUR. No currency conversion
is performed.

Scheduling, cron jobs, bankroll charts, and Dashboard bankroll widgets remain
intentionally deferred.

## Game Analyzer Kelly Recommendations

Game Analyzer shows a `Stake Recommendation` panel for the currently selected
side. The panel uses the displayed model probability, selected decimal market
odds, authenticated Betting Settings, and authenticated bankroll summary. NHL
Edge never places bets automatically.

The Full Kelly formula for decimal odds is:

```text
fullKellyFraction = (decimalOdds * modelProbability - 1) / (decimalOdds - 1)
```

Kelly modes then scale Full Kelly:

- Full Kelly: `1.00`
- Half Kelly: `0.50`
- Quarter Kelly: `0.25`
- Custom Kelly: the saved custom multiplier

The displayed recommendation uses:

```text
fractionalKellyPercent = fullKellyFraction * selectedKellyFraction * 100
recommendedStakePercent = min(fractionalKellyPercent, maximumStakePercent)
unroundedStakeAmount = selectedBankroll * recommendedStakePercent / 100
```

Stake amounts round down to the nearest configured increment so rounding never
increases risk. For example, `10.49` with `0.50` rounds to `10.00`, `10.50`
with `0.50` stays `10.50`, and `10.99` with `1.00` rounds to `10.00`.

Minimum Edge is measured as model probability percentage minus market implied
probability percentage. If the edge is below the saved threshold, the panel
shows the Kelly percentages but suppresses the stake amount. The maximum-stake
cap is shown when it reduces the fractional Kelly stake.

Bankroll Basis controls the amount used:

- Available bankroll excludes pending stake exposure.
- Current bankroll uses the full ledger balance.

If bankroll is not initialized, Game Analyzer still shows Full Kelly,
Fractional Kelly, and the recommended stake percentage when odds and
probability inputs are valid. It does not fabricate a currency amount; the
panel links to Bet Tracker for bankroll setup. If the selected bankroll basis
is zero, no amount is recommended.

`Use Recommended Stake` is an explicit action. It fills the review stake input
and opens Review & Save, but it does not save a bet or place a bet. The user can
edit the stake afterward. Saved bets may include a passive Kelly recommendation
snapshot, but actual stake and recommended stake remain separate.

Known limitations: Kelly sizing depends directly on probability-estimate
quality, and NHL Edge model probabilities may be uncertain. Treat the
recommendation as sizing guidance, not a guarantee of profit.

## Rating Lab Schedule & Context

The Schedule & Context tab is a production-isolated historical lab organized as
Phase 3A Rest & Fatigue, Phase 3B Quick Rematch, and a final Combined Schedule &
Context comparison. It defaults to prepared 2023–24, 2024–25, and 2025–26
historical seasons and identifies Base Model v1 with Team Home Advantage and
all schedule adjustments disabled as the common control.

Phase 3A puts 3 Games in 4 Days, Back-to-Back, and Back-to-Back + Travel in the
primary sweep. Well Rested is retained under collapsed Optional Experiments and
is excluded from the combined candidate until explicitly enabled. The combined
Rest & Fatigue selectors preserve the exclusive Back-to-Back + Travel >
Back-to-Back > 3-in-4 > Well Rested priority. When Well Rested is disabled, it
is removed from applied precedence and contributes to No fatigue adjustment;
its separate detected count remains available for diagnostics. Combined results
show the immutable configuration snapshot used for that run.

Phase 3B displays the user's actual persisted Quick Rematch setting, or the
canonical enabled / 5 days / +0.25 default, as a reference. One run evaluates
the standard 3, 5, 7, 10, and 14-day windows against 0, +0.10, +0.25, and +0.50,
with optional custom values. The repeated zero candidates are collapsed into a
single disabled baseline. Results show occurrences and rates, games affected,
pooled and per-season scoring, baseline deltas, and a cautious best-tested
diagnostic.

The final replay uses the manually selected values only: Rest & Fatigue remains
exclusive and Quick Rematch is additive. Individual sweep winners are never
inserted automatically. There is no production Apply button, and running the
lab does not change defaults, persisted settings, or live ratings.

Schedule facts are derived during replay from the shared prepared historical
game records. Prepared games do not need stored rest, fatigue, travel, or Quick
Rematch fields. Phase 3 uses the same canonical season IDs and regular-season
eligibility filter as Base Model Calibration; zero context occurrences still
produce a valid control comparison rather than an empty-season error.

In Settings, Base Home Advantage remains visually under Rating Model and is
saved by Save Rating Model. Save Rating Engine owns only K, the result
multipliers, and Probability Scale; their dirty states remain separate.

## Rating Lab Special Teams (Phase 4)

The `Special Teams` tab runs the production-isolated Phase 4 matchup
calibration. It uses Base Model v1 only: ratings 42-50 centered at 46,
probability scale 20, Base Home Advantage 3.5, K 1.3, and regulation/OT/SO
multipliers 1.0/0.4/0.1. Team Home Advantage, Rest & Fatigue, Quick Rematch,
injuries, and goalies are disabled so the PP/PK signal is tested independently.

Historical readiness separates target game seasons from their prior-season
Special Teams snapshots. For each target season, the UI lists the exact three
completed regular seasons used for its frozen preseason PP/PK ranking. Missing
snapshots can be prepared or retried, but a partial three-season window is
explicitly excluded from the main pooled comparison. The target season's final
PP/PK results are never substituted, and Arizona/Utah history remains one
canonical franchise.

One action tests Top/Bottom 4, 6, 8, and 10 against symmetric X values 0.00,
0.25, 0.50, 0.75, and 1.00. An optional custom integer N from 2 through 12 can
be added. Positive (`Top N PP vs Bottom N PK`) and negative (`Bottom N PP vs
Top N PK`) signals use the exact shared Dashboard/Game Analyzer classifier.
Home and away are evaluated independently, so two signals may occur in one
game; a single team's classification remains positive, negative, neutral, or
unavailable.

Results highlight the lowest tested pooled Brier without calling it a
recommendation. The grid includes positive and negative occurrences, games
affected, pooled Brier and log loss with baseline deltas, ECE, accuracy,
average/worst-season Brier, stability, and seasons beating the control.
Additional views show threshold breadth, positive-versus-negative expected and
actual win rates, rank-gap extremity, expandable per-season diagnostics, and
the full frozen ranking inputs for every target season. Occurrence counts are
shown because narrow thresholds may produce small samples.

The workflow is experimental and has no Apply action. It does not modify the
production Special Teams mode, threshold, or magnitude, Dashboard or Analyzer
probabilities, fair odds, Power Ratings, or saved Settings. Production uses its
independently persisted configuration, with Alert only remaining the default.

## Settings tabs and reset lifecycle

Settings is organized into five keyboard-accessible tabs. The selected tab is
also reflected in the `?tab=` query parameter without reloading the application:

- `General` owns account information, Market Odds status, and Preferred
  Bookmakers.
- `Rating Model` owns Base Home Advantage, goalie/injury guardrails, K Factor,
  result multipliers, and Probability Scale.
- `Game Context` owns Rest & Fatigue, Well Rested, 3 Games in 4 Days,
  Back-to-Back variants, the existing Quick Rematch setting (displayed as
  Quick Rematch / Revenge), and the Special Teams production mode, threshold,
  and symmetric magnitude.
- `Betting` owns Kelly, stake caps, edge thresholds, rounding, and bankroll
  basis configuration. Bet history remains in Bet Tracker.
- `Data & Reset` owns the three explicit reset workflows below.

The controls continue to use their existing authenticated APIs, stored keys,
validation, defaults, and separate save groups. Changing tabs does not recreate
the settings drafts, so unsaved input remains available until it is saved or
locally reset.

`Reset Settings to Defaults` restores configuration only. It preserves bets,
bankroll and its transaction history, current Power Ratings and update history,
injuries, saved analyses, game inputs, and all historical datasets. Starting
Rating Scale returns to the calibrated `42–50` default.

`Reset for New Season` resets teams to the center of the currently configured
Starting Rating Scale, clears current-season rating history/processed markers,
injuries, game contexts, browser-local analyses, and current Dashboard odds.
The scale configuration is preserved and becomes editable because the new
season has no processed marker. Settings, bets, settled outcomes, bankroll,
Rating Lab datasets, and provider caches are preserved.

`Factory Reset / Delete All Data` requires the exact typed confirmation
`RESET`. It deletes all authenticated user-owned settings, bets, bankroll data,
Power Ratings/history, injuries, team goalie/lineup data, game contexts, and
browser-local analysis state. The signed-in account and authentication token
remain valid. Starting Rating Scale returns to `42–50`; ratings are initialized
from the resulting fresh state when reloaded. Shared `HistoricalNhlGame`,
`HistoricalSeasonDataset`, `HistoricalSpecialTeamsSeason`, and provider caches
are never deleted.
