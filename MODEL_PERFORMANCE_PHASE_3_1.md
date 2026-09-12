# Model Performance Phase 3.1: Capture Health

Phase 3.1 adds read-only monitoring for missed Official T2 predictions and market checkpoints. It does not create, repair, or backfill predictions, odds, results, bets, or ratings.

## Cohort and schedule authority

Capture health uses the same authenticated owner, season, inclusive date filter, model version, and `OFFICIAL_T2_AUTOMATIC_V1` prediction cohort as Model Performance. The expected population comes from the canonical NHL schedule service. Schedule requests are padded by one UTC day at each end, then filtered by the exact scheduled-start timestamp so games near UTC date boundaries are not lost.

An eligible schedule identity must:

- be regular season or playoffs (`gameType` 2 or 3);
- match the selected eight-digit season;
- have a valid game ID, scheduled start, and supported home/away team identity;
- fall within the normalized selected date interval (`start <= scheduledStart < endExclusive`); and
- not be postponed, cancelled, abandoned, suspended, or otherwise unusable under the existing forward-prediction game contract.

Duplicate schedule entries are de-duplicated by the full immutable identity: game ID, season, game type, home team, away team, and scheduled start.

If the canonical schedule is unavailable or stale, or the capture repositories cannot be read, all capture-health counts are returned as `null` with status `UNAVAILABLE` and a reason. Existing Model Performance metrics remain available.

## Due-time semantics

All accepted capture windows remain inclusive. A checkpoint becomes expected only after its inclusive window has fully closed. At the exact closing boundary, a capture is still legal, so the checkpoint remains `NOT_DUE`; one millisecond later it is expected.

| Capture | Existing accepted window before scheduled start | Expected after |
| --- | --- | --- |
| Official T2 | 120–75 minutes, inclusive | strictly later than T−75m |
| T24 | 24–18 hours, inclusive | strictly later than T−18h |
| T6 | 6–4 hours, inclusive | strictly later than T−4h |
| T2 market | 120–75 minutes, inclusive | strictly later than T−75m |
| FINAL | 30–5 minutes, inclusive | strictly later than T−5m |

Future and not-yet-due checkpoints contribute neither to the expected count nor the missing count.

## Captured and missed definitions

An expected Official T2 is captured only when an authenticated-owner, selected-version, valid `OFFICIAL_T2_AUTOMATIC_V1` snapshot matches the complete canonical schedule identity and its `generatedAt` remains inside the inclusive Official T2 window. Otherwise it is missed.

T24, T6, and T2 are captured only by an existing Odds Snapshot schema-v2 document whose checkpoint type and complete schedule identity match and whose `capturedAt` passes the authoritative acceptance-window contract. Duplicate snapshots are set-de-duplicated and cannot inflate a numerator.

FINAL is captured only by an exact-identity finalized `OddsClosingMarket` with an accepted two-sided no-vig consensus in `finalBookmakers`, matching the existing Model Performance FINAL semantics.

An existing prediction or market document for the same game ID but a different full identity is not merged into the current schedule identity. The due identity remains missing and the drill-down reason is `SCHEDULE_IDENTITY_MISMATCH`.

Coverage percent is `captured / expected * 100`. A zero expected count has a `null` percentage and `NOT_DUE` status; unavailable data uses null counts rather than zero.

## API and drill-down

`GET /api/model-performance` now includes aggregate-only `captureHealth` counts:

```text
captureHealth.officialT2
captureHealth.marketCheckpoints.T24|T6|T2|FINAL
captureHealth.status
captureHealth.reason
captureHealth.observedAt
captureHealth.schedule
```

Internal missing-game collections are deliberately omitted from the aggregate response.

`GET /api/model-performance/games` accepts these additional paginated status filters:

- `missed_official_t2`
- `missing_t24`
- `missing_t6`
- `missing_t2`
- `missing_final`

Each item contains only compact audit fields: game ID, season, scheduled start, home and away team IDs, capture checkpoint, `MISSED` status, and reason. Raw provider payloads, user IDs, predictions, odds, and private inputs are not returned.

## UI behavior

Data Coverage shows Official T2 captured/expected, percentage, and missed count. A compact Market Checkpoint Coverage row shows T24, T6, T2, and FINAL numerator/denominator values. Healthy, not-due, and unavailable states use neutral presentation. Only overdue missing captures receive a restrained warning treatment and become links to the existing paginated Games drill-down.

Desktop uses a four-column compact gap table. Mobile replaces it with readable cards and collapses the checkpoint grid from four to two to one columns.

## Operational impact

The request performs one cached canonical schedule-range service call and two bounded, projected database reads for the schedule game IDs. It does not perform one provider request per game. No Odds API request is made by Model Performance.

There are no new collections, documents, indexes, cron jobs, timers, background polling loops, or storage growth. Query projections exclude prices and raw payloads except the existing FINAL bookmaker fields required to validate the accepted closing consensus.

## Known limitation

There is no persisted model-version activation calendar. Selecting a model version scopes which stored Official T2 captures can satisfy the numerator, while the expected schedule cohort is defined by the selected season/date interval. For a version introduced mid-season, the date range should begin at that version's production activation date; earlier games in the selected interval cannot be distinguished from true misses without inventing historical deployment state.
