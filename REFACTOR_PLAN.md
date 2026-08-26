# whstats v3 refactor plan

## 1. Executive summary

`whstats` should become a small, Bun-first work-hours application rather than one large CLI script with several output modes bolted onto it.

The proposed v3 has four clear jobs:

1. **Report:** show one concise line per observed day, followed by a mandatory summary.
2. **Trend:** show whether booking diligence is improving or deteriorating over time.
3. **Gaps:** rank the dates with the largest booking and attendance shortfalls.
4. **Entries:** browse, add, and edit the user's Redmine time entries interactively.

The central metric should no longer be called “efficiency.” The important concept is **booking coverage**: how much of present time has a corresponding Redmine booking. Presence and booked time should also each be compared with the configured daily target, but they are supporting metrics rather than one combined score.

This is intentionally a breaking redesign. The current flag interface, human renderer, JSON schema, internal output types, and generated version file can all be removed rather than deprecated.

---

## 2. Research performed

### Current whstats implementation

I reviewed:

- `index.ts`
- `lib/config.ts`
- `lib/redmine.ts`
- `lib/mssql.ts`
- `lib/utils.ts`
- all files under `lib/output/`
- `README.md`, `CHANGELOG.md`, `package.json`, and recent Git history
- the current CLI's concise and JSON output against the configured read-only data sources

The current implementation is functional, but `index.ts` owns too many responsibilities: command metadata, parsing, configuration commands, fetching, domain calculations, exception handling, and output dispatch. The output layer then maintains types and transformations that partly duplicate the domain calculation.

### sqlcli command registry

I reviewed the full command path from:

- `~/Projects/sqlcli/src/cli/types.ts`
- `~/Projects/sqlcli/src/cli/registry.ts`
- `~/Projects/sqlcli/src/cli/parse.ts`
- `~/Projects/sqlcli/src/cli/help.ts`
- `~/Projects/sqlcli/src/index.ts`
- representative command definitions and CLI tests

The strongest parts worth carrying over are:

- one declarative `CommandDefinition` tree;
- aliases stored beside the canonical command or flag;
- recursive command/subcommand resolution;
- flags scoped to the selected command;
- help generated from the same definitions used for parsing;
- command-local `execute` functions;
- explicit handling of unknown commands/options;
- tests proving command-specific flags do not leak into other commands.

This is a much better base than the current `CommandType` plus union-like `handler` field in `whstats`.

For v3, I would port this system into `whstats`, then add a few capabilities instead of introducing a third-party CLI parser:

- typed values (`boolean`, `string`, `integer`, `date`);
- reusable flag groups without making every flag global;
- declarative conflicts such as a range preset versus `--from`;
- positional validation in the parser rather than in every execute function;
- a root default command (`whstats` behaves like `whstats report`);
- `requiresConfig` and `requiresTty` command metadata;
- a help command that can resolve nested command paths.

I would copy/adapt the registry rather than immediately extract a shared package. A shared package across three personal CLIs can be considered after the APIs have converged; doing it during this refactor would add coordination without improving `whstats` itself.

### redmine-cli

I reviewed the corresponding registry in `~/Projects/redmine-cli`, the Redmine client, issue commands, activity command, Markdown construction, cache approach, and terminal Markdown wrapper.

Useful patterns to reuse conceptually are:

- `requiresConfig` on commands;
- generic URL/query construction;
- detailed API error bodies;
- bounded, explicit response transformation instead of exposing arbitrary API objects;
- Markdown as an output document before terminal rendering;
- cacheable issue enrichment;
- command groups that can both execute and contain subcommands.

The current `redmine-cli` is read-oriented and does not implement time-entry writes, so `whstats` will need its own create/update client operations. It should not shell out to `redmine`; that would create configuration coupling and make error handling and tests worse.

### Bun's built-in Markdown and terminal utilities

The locally installed Bun is 1.4.0. Its installed type documentation confirms:

- `Bun.markdown.ansi(markdown, theme)` renders headings, lists, tables, links, code, and other GFM Markdown to terminal ANSI;
- relevant options include `colors`, `hyperlinks`, `columns`, `light`, and `kittyGraphics`;
- `colors: false` produces plain ASCII chrome without ANSI escapes;
- `Bun.stringWidth()` measures terminal width while accounting for ANSI and wide characters;
- `Bun.stripANSI()` is also available;
- `Bun.markdown.ansi` is currently marked unstable.

A local smoke test confirmed that a Markdown table is rendered as a terminal table. `redmine-cli` already wraps the same API successfully in `src/output/markdown.ts`.

This creates a runtime decision: the current package claims Node 18 compatibility, but `Bun.markdown.ansi` is a Bun API. Because this is a single-user tool and breaking changes are welcome, the clean recommendation is to make v3 **Bun-only**, pin a minimum Bun version that contains the API, and isolate the unstable API behind one wrapper.

---

## 3. Problems in the current design

### 3.1 CLI structure

- Actions such as setup, reset, config display, help, and version are modeled as boolean flags.
- Range selection and actions share one registry even though they are different concepts.
- `CommandDef.handler` can be a function, number, or range factory and is recovered through casts.
- Aliases can be resolved as positionals even though the documented interface is flag-oriented.
- The parser does not naturally support command-specific string options such as dates.
- `--brief` changes both terminal and JSON contents; output shape should not depend on a presentation abbreviation.
- The no-argument behavior is useful, but it is implicit rather than represented as a default command.

### 3.2 Output structure

- Human output is handcrafted ANSI plus a custom `TableBuilder`.
- JSON has a parallel set of interfaces and manually copies most of `SummaryData`.
- The daily terminal line shows gross booked hours while the summary uses net booked hours. A mixed day containing ignored and normal entries can therefore disagree with its summary without explaining why.
- The `past + today` summary layout is hard to scan and produces awkward zero columns.
- The summary header says “past N workdays,” even though the current date can be included.
- Fetch/progress output risks contaminating data output unless every path special-cases JSON.

### 3.3 JSON naming and redundancy

The current schema includes several values that are derived, presentation-specific, or unclear:

- `dayName` is derivable from `date` and locale-dependent.
- `grossBooked`/`netBooked` describe implementation mechanics, not user concepts.
- `excludedFromNet` does not say whether the day or an entry is excluded, or why.
- `booked.past`, `booked.today`, `clocked.past`, and `clocked.today` duplicate values in `days`.
- `hasPartialCurrentDayTarget` and `partialCurrentDayTarget` expose summary-rendering state.
- integer percentages discard precision and duplicate the underlying totals.
- “efficiency” sounds like a productivity judgement, but is only booked/present time.

Some aggregate redundancy is useful for scripts, so the goal should not be a fully normalized JSON database. The goal is to retain a small set of base facts plus a deliberately convenient summary, without leaking renderer state.

### 3.4 Statistical correctness and semantics

#### “Workday” is not actually a calendar workday

The current `workdays` count is the number of dates present in either source, except for a narrow ignored-entry case. This is closer to **observed active days**. It can include weekends, and it intentionally omits weekdays with no data. That behavior matches the stated requirement better than a Monday–Friday calendar, but the name is misleading.

#### Current-day target mutation is confusing

When the clock is running today, today's target becomes `min(presence so far, daily target)`. This mixes two separate questions:

- progress toward being present for eight hours;
- whether time present so far has been booked.

The target should stay eight hours. An in-progress day should instead be clearly marked and excluded from historical trend judgements until complete.

#### Past/today target columns are not semantically aligned

When today is included but the clock is not running, `partialCurrentDayTarget` remains zero. The target's “past” column can therefore include today's full target while the booked and clocked “past” columns explicitly subtract today. The columns do not refer to the same set of dates.

#### Efficiency is the wrong term

`booked / clocked` is useful, but it measures **booking coverage**, not efficiency. A value below 100% indicates presence without matching bookings. A value above 100% indicates bookings exceed recorded presence. Neither directly says whether work was productive.

#### Averaging must be weighted

Period booking coverage should be:

```text
sum(booked hours) / sum(presence hours)
```

It should not be the average of daily percentages, because a short day would otherwise have the same influence as a long day.

#### Ignored tickets need a domain meaning

The configuration currently calls these “ignored ticket IDs.” In practice they appear to represent leave/sick/non-working Redmine bookings. These should be modeled as `excusedHours` or `leaveHours`, not silently removed from “net” totals.

For the first v3 model, the safest rule matching the stated requirements is:

- a date with only excused entries and no presence is an excused day and has no target;
- any date with presence is active and has the full daily target, even on a weekend;
- any date with normal booked time but no presence is active but gets a missing-presence anomaly;
- mixed presence and excused entries are shown explicitly and retain a full target; do not silently infer a partial-day target.

If partial leave is common, a later configurable policy could set expected hours to `dailyTarget - excusedHours`, but v3 should not make that assumption invisibly.

### 3.5 Presence aggregation risks

The current event state machine correctly ignores redundant start/stop events in common cases, but it has boundary and time-zone risks:

- it only fetches events inside the requested date range, so it cannot know whether the user was already clocked in at the range boundary;
- a session crossing midnight is closed on the first day, but the after-midnight portion is not reconstructed;
- `getDayEndUtc()` appends `Z` even though MSSQL is configured with `useUTC: false`, mixing UTC and local wall-clock assumptions;
- an orphaned historical clock-in is closed at end of day without surfacing that this was inferred;
- host time, SQL Server time, and the intended office time zone are not represented explicitly.

These cases should be corrected before trusting year-scale trends.

### 3.6 Date ranges

`getDateRange(7)` subtracts seven days and uses inclusive API endpoints, resulting in eight calendar dates. Every preset needs exact, tested inclusive semantics.

---

## 4. Proposed command interface

## 4.1 Root behavior

```text
whstats
```

No arguments should remain the fastest path and should be exactly equivalent to:

```text
whstats report recent
```

`whstats -h` shows root help rather than running a report.

## 4.2 Command tree

```text
whstats
├── report [preset]
├── trend [preset]
├── gaps [preset]
├── entries
│   ├── list [preset]
│   ├── add
│   ├── edit <entry-id>
│   └── delete <entry-id>        # optional final phase
├── config
│   ├── setup
│   ├── show
│   ├── path
│   └── reset
├── help [command...]
└── version
```

Recommended aliases should be sparse and obvious:

- `entries`: `entry`
- `entries list`: `ls`
- `entries edit`: no shorthand needed
- `config setup`: `init`
- normal `-h` and `-v` globals

Do not preserve `-w`, `-m`, `-y`, `-Y`, `--brief`, `--json`, `--config`, `--setup`, or the old positional aliases. The new interface should fail clearly rather than maintaining an accidental compatibility layer.

## 4.3 Range selection

Report-like commands accept either one preset or an explicit range:

```bash
whstats report recent
whstats report week
whstats report month
whstats report ytd
whstats report rolling-year
whstats report --from 2025-01-01 --to 2025-12-31
whstats report --from 2025-06-01           # through today
whstats report --to 2025-12-31             # require --from; do not guess an unbounded start
```

Recommended exact preset definitions:

- `recent`: today and the preceding 13 dates, inclusive;
- `week`: Monday of the current calendar week through today;
- `month`: first day of the current calendar month through today;
- `ytd`: January 1 through today;
- `rolling-year`: today and the preceding 364 dates, inclusive.

This avoids the ambiguous old `year` name. A historical year is naturally expressed with `--from`/`--to` and can later gain a `--year 2025` convenience only if repeated use justifies it.

Validation rules:

- ISO `YYYY-MM-DD` only;
- inclusive `from` and `to` everywhere;
- `from <= to`;
- a preset conflicts with `--from` and `--to`;
- `--to` without `--from` is rejected;
- future end dates are rejected by default, unless a real use case appears;
- range calculations use local calendar dates, not `24 * 60 * 60 * 1000` arithmetic across DST.

## 4.4 Report flags

```text
--from <date>
--to <date>
--verbose
--output, -o <terminal|markdown|json>
```

There is one detail switch only: `--verbose`.

- Default: one line per day, compact issue teaser, mandatory summary, and one short insight.
- Verbose: show each Redmine time entry, excused time, source anomalies, and exact calculations below each day or in a detail section.

There is no brief mode and no way to suppress the summary.

## 4.5 Trend command

```bash
whstats trend
whstats trend ytd
whstats trend rolling-year --bucket month
whstats trend --from 2025-01-01 --to 2025-12-31 --bucket week
```

Flags:

```text
--bucket <day|week|month>
--from <date>
--to <date>
--output, -o <terminal|markdown|json>
```

Defaults:

- range: preceding 12 complete weeks;
- bucket: week.

The trend command should focus on one question: “Am I getting worse at booking present time?” It should chart weighted booking coverage or average unbooked hours per active day, with booked and presence averages available in the bucket rows. It should not invent a composite productivity score.

## 4.6 Gaps command

```bash
whstats gaps
whstats gaps rolling-year
whstats gaps --from 2025-01-01 --to 2025-12-31 --limit 15
```

It should produce two small ranked sections:

1. largest booking gaps: `max(presence - booked, 0)`;
2. largest attendance shortfalls: `max(target - presence, 0)` on completed active days.

A date with missing presence should be surfaced as an anomaly rather than winning the attendance ranking based on possibly incomplete source data.

## 4.7 Entry commands

```bash
whstats entries                         # interactive browser
whstats entries list recent
whstats entries list --from 2026-08-01 --to 2026-08-31
whstats entries add                     # interactive form
whstats entries add --date 2026-08-26 --issue 43135 --hours 2.5 --comment "Implementation"
whstats entries edit 123456             # interactive form prefilled from Redmine
```

Direct non-interactive flags are useful for scripting, but missing required values should trigger prompts only when stdin and stderr are TTYs. In non-TTY use, missing values are errors.

---

## 5. Proposed default output

The report document should first be generated as Markdown. Raw Markdown and terminal output then share the same content.

A conceptual default document:

```markdown
# Work hours · 13–26 Aug 2026

| Date                 |           Booked |            Present | Booking gap | Issues                  |
| -------------------- | ---------------: | -----------------: | ----------: | ----------------------- |
| Tue 25 Aug           | `████▌░░░` 4.50h | `████████+` 10.92h |       6.42h | #43135 3h · #43001 1.5h |
| Wed 26 Aug · running |    `░░░░░░░░` 0h |   `▉░░░░░░░` 0.89h |       0.89h | —                       |

## Summary

- **Completed active days:** 1
- **Booked:** 4.50h / 8h target (−3.50h)
- **Present:** 10.92h / 8h target (+2.92h)
- **Booking coverage:** 41% (6.42h present but not booked)
- **Largest booking gap:** Tue 25 Aug, 6.42h

> Today is still in progress and is not included in trend comparisons.
```

The exact spacing can change during implementation, but the information hierarchy should not:

1. title and exact date range;
2. one row per observed date;
3. mandatory, minimal summary;
4. at most one actionable trend/quality note.

### Eight-cell bars

- Exactly eight cells, scaled to `targetHoursPerDay`, not hard-coded to one hour per cell.
- Partial block characters provide fractional progress.
- A full bar plus `+` communicates over-target time.
- Values are always printed numerically; bars are an aid, never the only representation.
- Missing data uses a textual marker, not a zero-looking bar.
- Status must not depend on color because Markdown output, `NO_COLOR`, pipes, and accessibility all matter.

### Issue teaser

Default rows aggregate entries by issue for that date and show at most the two largest issue totals. `+N` indicates omitted issues. This is enough to answer “what did I recently book?” without printing comments for every entry.

Issue subjects are not included in the Redmine time-entry response. Subject enrichment should therefore be bounded and cached rather than becoming an unbounded N+1 request for year reports. Initial v3 can use issue IDs plus hours in report rows; the interactive entry browser can fetch the selected issue's subject on demand.

### Verbose output

Verbose output adds:

- time-entry ID;
- issue ID, project, activity, hours, and comment;
- excused entries and why they were excluded from active booked hours;
- source anomalies such as an unmatched clock event;
- exact per-day target and deltas.

It must not switch to a completely different summary or JSON schema.

---

## 6. Output pipeline and Bun Markdown

## 6.1 One document, multiple encodings

The pipeline should be:

```text
source records
  → normalized domain report
  → report view model
  ├── Markdown document
  │    ├── raw Markdown stdout
  │    └── Bun.markdown.ansi() for a TTY
  └── JSON serialization
```

The terminal renderer should not calculate statistics. The Markdown renderer should not fetch data. JSON should serialize the same report object rather than reconstructing a second summary type.

## 6.2 Output selection

Recommended behavior:

- no `--output` and stdout is a TTY: ANSI-rendered Markdown;
- no `--output` and stdout is not a TTY: raw Markdown;
- `--output terminal`: force terminal rendering, respecting `NO_COLOR`;
- `--output markdown`: always raw Markdown;
- `--output json`: always JSON and nothing else on stdout.

Progress, warnings, and diagnostics go to stderr. Normal report generation should be quiet, so “Fetching…” should normally disappear rather than move to another stream.

## 6.3 Bun wrapper

Isolate the unstable API in one module:

```ts
renderTerminalMarkdown(markdown, {
  colors: process.env.NO_COLOR === undefined,
  columns: process.stdout.columns ?? 100,
  hyperlinks: process.stdout.isTTY,
});
```

The wrapper is the only file that should reference `Bun.markdown.ansi`. Tests should cover colorless output and terminal width. Pin the minimum Bun engine version and upgrade `@types/bun` with it.

The existing `colors.ts` and `TableBuilder` should be deleted once the Markdown renderer is in use. If domain-specific colors are later desired, use symbols and wording first; Bun's built-in ANSI theme does not provide direct semantic coloring for arbitrary hour values.

## 6.4 Runtime/package changes

- Change the executable shebang to `#!/usr/bin/env bun`.
- Set `engines.bun` and remove the Node engine claim.
- Build with `bun build --target bun`, following `sqlcli` and `redmine-cli`.
- Remove the generated `lib/version.ts` workflow. Import package metadata at build time or inject a build define so local `bun run` never fails because prebuild has not run.
- Document Bun as the sole runtime.

---

## 7. Domain model and statistics

## 7.1 Names

Use the user's vocabulary consistently:

- `bookedHours`: normal Redmine time booked for the date;
- `presenceHours`: reconstructed clocked-in duration;
- `excusedHours`: configured leave/sick/non-working Redmine time;
- `targetHours`: expected hours for an active date;
- `bookingCoverage`: booked divided by presence;
- `bookingGapHours`: `max(presence - booked, 0)`;
- `bookingBalanceHours`: `booked - presence` when a signed value is needed;
- `activeDay`, `excusedDay`, `inProgress`, and `anomalies` instead of `excludedFromNet`.

Use “present,” not “clocked,” in user-facing metrics. Keep “clock event” for the raw MSSQL events.

## 7.2 Day classification

For each date in the union of Redmine entries and presence sessions:

```text
normal booked = sum(non-excused Redmine entries)
excused       = sum(excused Redmine entries)
presence      = sum(valid reconstructed presence sessions)
```

Classification:

- **active:** presence > 0 or normal booked > 0;
- **excused:** not active and excused > 0;
- **mixed:** active and excused > 0;
- **unobserved:** no values in either source; omitted from normal daily rows;
- **anomalous:** source facts conflict or cannot be reconstructed confidently.

Any presence, including weekend presence, creates an active day and an eight-hour target. A normal Redmine booking with no presence is kept and flagged; it is not silently treated as vacation.

## 7.3 Current day

- The configured target remains eight hours.
- A currently running day is marked `inProgress`.
- It is displayed in the daily table.
- It is omitted from “completed active days,” trend baselines, and slack alerts.
- Its live booking gap is still displayed because that is immediately actionable.
- Once clocked out, it can be counted as complete even if short; that shortfall is meaningful.

This removes `partialCurrentDayTarget` entirely.

## 7.4 Period summary

For completed active days only:

```text
total target       = active completed days × target per day
total booked       = sum(booked)
total presence     = sum(presence)
booking coverage   = total booked / total presence
booking balance    = total booked - total presence
booked vs target   = total booked - total target
presence vs target = total presence - total target
```

Ratios are nullable when their denominator is zero. Internally retain full numeric precision. Round only while rendering.

Default summary should display only:

- completed active-day count;
- booked versus target;
- present versus target;
- booking coverage and absolute unbooked balance;
- largest booking gap.

Do not show mean, median, streaks, standard deviation, “efficiency,” separate past/today totals, or a composite score by default.

## 7.5 Slack detection

Use a transparent rolling comparison rather than a score:

- recent window: last five completed active days;
- baseline: ten completed active days immediately before that;
- require at least three valid presence days in each window;
- compute weighted booking coverage and average positive booking gap per active day;
- report only when the recent value is materially worse, for example coverage lower by at least five percentage points or gap worse by at least 0.5h/day.

Example:

```text
Booking coverage over the last 5 active days is 88%, down 7 percentage points from the preceding 10 days.
```

The threshold should be a named domain constant with tests. It does not need to become user configuration until there is evidence that tuning it is useful.

## 7.6 Trend buckets

For each day/week/month bucket:

- active completed days;
- target total;
- booked total and per-day average;
- presence total and per-day average;
- weighted booking coverage;
- average positive booking gap.

The terminal trend view should chart one primary series. Recommended primary series: booking coverage. A secondary compact table can show average booked and presence hours. This keeps the command focused.

---

## 8. Proposed JSON schema

A report JSON document should resemble:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-26T08:00:00.000Z",
  "range": {
    "from": "2026-08-13",
    "to": "2026-08-26",
    "preset": "recent"
  },
  "targetHoursPerDay": 8,
  "days": [
    {
      "date": "2026-08-25",
      "active": true,
      "excused": false,
      "inProgress": false,
      "targetHours": 8,
      "bookedHours": 4.5,
      "presenceHours": 10.92,
      "excusedHours": 0,
      "bookingCoverageRatio": 0.4121,
      "bookingGapHours": 6.42,
      "anomalies": [],
      "timeEntries": [
        {
          "id": 123456,
          "issueId": 43135,
          "projectId": 10,
          "projectName": "Example",
          "activityId": 9,
          "activityName": "Development",
          "hours": 3,
          "comment": "Implementation",
          "excused": false
        }
      ]
    }
  ],
  "summary": {
    "activeDays": 2,
    "completedActiveDays": 1,
    "excusedDays": 0,
    "targetHours": 8,
    "bookedHours": 4.5,
    "presenceHours": 10.92,
    "bookingCoverageRatio": 0.4121,
    "bookingGapHours": 6.42
  },
  "insight": {
    "kind": "booking-coverage-decline",
    "message": "...",
    "recentCoverageRatio": 0.88,
    "baselineCoverageRatio": 0.95
  }
}
```

Final schema decisions:

- Ratios are `0.0–1.0` style values, not rounded integer percentages. They may exceed 1 when bookings exceed presence.
- Use `null`, not zero, when coverage is undefined because presence is zero.
- `insight` is `null` when there is not enough data or no material finding.
- Omit `dayName`.
- Omit app version unless a concrete script needs it; `schemaVersion` is the relevant contract marker.
- Omit `past`/`today` subdivisions.
- Omit renderer state and partial-target flags.
- Use flat `issueId`/`projectId` fields in compact time entries rather than one-property nested objects.
- Include one convenient aggregate summary even though it is derivable from days. This redundancy is intentional for scripting.
- Report JSON always includes entries; `--verbose` is a terminal/Markdown detail choice and does not alter machine data.

`trend --output json` and `gaps --output json` should have command-specific top-level documents rather than overloading one giant optional schema.

---

## 9. Data-source refactor

## 9.1 Redmine gateway

Define an interface owned by the application/domain boundary:

```ts
interface RedmineGateway {
  getCurrentUser(): Promise<User>;
  listTimeEntries(range: DateRange): Promise<TimeEntry[]>;
  getTimeEntry(id: number): Promise<TimeEntry>;
  getIssue(id: number): Promise<IssueSummary>;
  listTimeEntryActivities(): Promise<Activity[]>;
  createTimeEntry(input: NewTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: number, input: TimeEntryPatch): Promise<void>;
  deleteTimeEntry(id: number): Promise<void>;
}
```

Implementation requirements:

- shared request method for headers, JSON parsing, and detailed errors;
- `URL`/`URLSearchParams`, not hand-built query strings;
- pagination tested independently;
- abort/timeouts;
- bounded concurrency for issue enrichment;
- optional issue cache under XDG cache, inspired by `redmine-cli`;
- strict response decoders or type guards at the API boundary;
- no secrets in diagnostics.

Standard Redmine write payloads should be verified against the configured server before implementation. Expected shapes are:

```json
{
  "time_entry": {
    "issue_id": 43135,
    "spent_on": "2026-08-26",
    "hours": 2.5,
    "activity_id": 9,
    "comments": "Implementation"
  }
}
```

with `POST /time_entries.json` for create and `PUT /time_entries/:id.json` for update. Delete can use `DELETE /time_entries/:id.json` if enabled in the final phase.

## 9.2 Presence gateway

Return normalized events or sessions, not only a map of totals:

```ts
interface PresenceGateway {
  listPresence(range: DateRange): Promise<PresenceResult>;
}

type PresenceResult = {
  days: PresenceDay[];
  serverNow: string;
  currentDate: string;
  running: boolean;
  anomalies: PresenceAnomaly[];
};
```

Reconstruction changes:

1. Fetch the last event before the range start to establish boundary state.
2. Fetch all events through the inclusive end boundary.
3. Pair start/stop transitions in a pure TypeScript state machine.
4. Split sessions crossing midnight into both local dates.
5. Handle duplicate starts/stops without double counting.
6. Preserve orphan and inferred-close anomalies.
7. Use SQL Server's current date/time for live-session closure so status and duration agree.
8. Represent the office time zone explicitly in config, recommended default `Europe/Berlin`.
9. Avoid constructing a UTC `Z` timestamp from a local SQL date.

If the MSSQL column is a naive local `datetime`, query it in a representation that preserves SQL local date and wall-clock time rather than relying on driver conversion. Add an opt-in diagnostic command or verbose section to display reconstructed sessions when an anomaly is detected.

## 9.3 Fetch orchestration

`report` should:

1. resolve/validate the date range;
2. load and validate configuration;
3. fetch Redmine user if no cached configured user ID exists;
4. fetch time entries and presence concurrently;
5. normalize each source;
6. build a domain report;
7. render exactly once.

No `process.exit()` below the top-level CLI boundary. Gateways and domain functions throw typed errors; the CLI maps them to one stderr message and an exit code.

---

## 10. Interactive Redmine entry workflow

## 10.1 Recommended first implementation

Do not start with a full-screen TUI framework. Bun provides terminal primitives and Markdown rendering, but not a complete interactive form/navigation framework. A full-screen framework such as OpenTUI is powerful but adds substantial native/runtime surface for a workflow that can initially be handled by a menu loop.

Recommended progression:

1. Build `entries list`, `entries add`, and `entries edit` as non-interactive commands with injectable prompts.
2. Add a TTY-only interactive browser using a lightweight prompt library such as `@clack/prompts`, or a small adapter around `node:readline/promises` if dependency-free prompts are sufficient.
3. Reassess OpenTUI only if arrow-key calendar navigation and persistent split panes still feel meaningfully better after using the menu browser.

A loop of date selection → entry selection → action already meets the practical requirement without owning cursor painting, resize behavior, and raw-mode cleanup.

## 10.2 Browser flow

```text
Selected date: Wed 26 Aug 2026
Present 6.25h · Booked 4.00h · Gap 2.25h

1. #43135 · 2.50h · Implementation
2. #43001 · 1.50h · Review

[a] Add  [e] Edit selected  [p/n] Previous/next day  [g] Go to date  [q] Quit
```

Desired actions:

- start on today or an optional positional date;
- previous/next observed day and previous/next calendar day;
- jump to ISO date;
- show presence and booking gap for context;
- select an entry and fetch issue subject/details on demand;
- refresh after a successful write;
- return to the same date and selection after editing.

## 10.3 Add form

Fields:

- date, default selected date/today;
- issue ID, typed manually initially;
- issue preview fetched after ID entry;
- hours, positive decimal with sensible precision validation;
- activity, selected from Redmine activities;
- comment;
- final Markdown preview and confirmation.

Future enhancement: issue search or integration with `redmine-cli` logic. Manual issue ID plus validation should come first because it is deterministic and directly requested.

## 10.4 Edit form

- fetch the entry by ID;
- verify it belongs to the configured current user;
- prefill every editable field;
- let blank input retain old values;
- show an old/new diff;
- require confirmation in interactive mode;
- refetch after update and show the resulting entry.

## 10.5 Write safety

Although this is a personal tool, writes should still be hard to perform accidentally:

- interactive add/edit ends with a preview and confirmation;
- direct `entries add`/`edit` is considered explicit, but supports `--dry-run`;
- delete is a separate subcommand and requires confirmation unless `--yes` is supplied;
- never expose a write action from `report`, `trend`, or `gaps`;
- Ctrl+C and prompt cancellation restore terminal state and perform no write;
- unit tests mock all HTTP requests; test runs never contact Redmine with write methods.

---

## 11. Proposed source layout

```text
src/
├── index.ts
├── version.ts
├── cli/
│   ├── types.ts
│   ├── registry.ts
│   ├── parse.ts
│   ├── help.ts
│   ├── errors.ts
│   └── shared-flags.ts
├── commands/
│   ├── report.ts
│   ├── trend.ts
│   ├── gaps.ts
│   ├── entries.ts
│   ├── config.ts
│   ├── help.ts
│   └── version.ts
├── config/
│   ├── types.ts
│   ├── load.ts
│   ├── validate.ts
│   └── xdg.ts
├── domain/
│   ├── types.ts
│   ├── dates.ts
│   ├── classify-days.ts
│   ├── report.ts
│   ├── summary.ts
│   ├── trend.ts
│   └── gaps.ts
├── redmine/
│   ├── client.ts
│   ├── types.ts
│   ├── decode.ts
│   └── cache.ts
├── presence/
│   ├── client.ts
│   ├── events.ts
│   ├── reconstruct.ts
│   └── types.ts
├── output/
│   ├── markdown-terminal.ts
│   ├── report-markdown.ts
│   ├── report-json.ts
│   ├── trend-markdown.ts
│   ├── trend-json.ts
│   ├── gaps-markdown.ts
│   ├── gaps-json.ts
│   └── bars.ts
└── interactive/
    ├── prompts.ts
    ├── entries-browser.ts
    └── entry-form.ts

test/
├── cli/
├── domain/
├── presence/
├── output/
├── redmine/
└── fixtures/
```

The important boundaries are more significant than the exact filenames:

- CLI definitions dispatch only.
- Commands orchestrate use cases.
- Gateways fetch and normalize source data.
- Domain functions are pure and know nothing about terminal/JSON.
- Renderers receive finalized view models.
- Interactive UI calls the same entry use cases as non-interactive commands.

---

## 12. Configuration redesign

Suggested configuration shape:

```json
{
  "schemaVersion": 1,
  "redmine": {
    "url": "https://redmine.example.test",
    "apiKey": "..."
  },
  "presence": {
    "server": "...",
    "database": "...",
    "user": "...",
    "password": "...",
    "userId": 123,
    "timeZone": "Europe/Berlin"
  },
  "report": {
    "targetHoursPerDay": 8,
    "excusedIssueIds": [39193]
  }
}
```

Changes:

- `ignoredRedmineTicketIds` → `excusedIssueIds`;
- numeric timelogger user ID stored as a number;
- explicit time zone;
- grouped source configuration;
- config schema version;
- existing secure directory/file modes retained;
- `config show` masks secrets and uses Markdown output;
- `config path` prints only the path for shell use.

Because compatibility is not required, the simplest release can require `whstats config setup` once. A one-time migration can still be implemented as a convenience if desired, but it should rewrite to the new schema immediately rather than maintaining two loaders indefinitely.

---

## 13. Testing strategy

Use Bun's built-in test runner and make domain behavior fixture-driven.

### CLI registry tests

Adapt the strongest `sqlcli` tests:

- root help and command-specific help;
- nested subcommand help;
- aliases;
- unknown command and unknown option;
- command-scoped flag rejection;
- flag choices/defaults/conflicts;
- required positional arguments;
- no-argument default report;
- old flags explicitly fail;
- machine output never includes progress text.

### Date-range tests

- `recent` contains exactly 14 inclusive dates;
- week starts Monday;
- leap years;
- month/year boundaries;
- DST transitions do not shift date strings;
- custom range validation;
- no eight-day “last seven days” regression.

### Presence reconstruction tests

Fixtures for:

- ordinary start/stop;
- duplicate start;
- duplicate stop;
- orphan stop;
- open current session;
- historical unmatched start;
- session crossing midnight;
- state carried in from before range;
- range ending while session active;
- multiple sessions in a day;
- exact midnight;
- daylight-saving transition behavior;
- SQL server date differing from host UTC date.

### Domain/statistics tests

- presence-only date;
- booking-only date;
- normal matching date;
- leave-only/excused date;
- mixed excused and active date;
- weekend presence counts as active;
- unobserved weekdays are omitted;
- current running day shown but excluded from historical summary;
- weighted coverage rather than mean percentages;
- zero-presence coverage is null;
- overbooking can exceed 100%;
- largest-gap ranking;
- slack insight with sufficient/insufficient baseline data.

### Output tests

- Markdown golden files for report/trend/gaps;
- bars are exactly eight display cells using `Bun.stringWidth`;
- over-target and missing-data markers;
- raw Markdown contains no ANSI;
- colorless terminal render contains no ANSI;
- JSON schema snapshots and numeric precision;
- `--verbose` does not alter JSON shape.

### Redmine client tests

Mock `fetch` and verify:

- pagination;
- URL encoding;
- API error details;
- create/update payload shape;
- cancellation/timeouts;
- no write without command execution;
- issue/activity lookup caching.

### Interactive tests

Keep forms and navigation as a state machine behind a prompt adapter. Test:

- cancellation;
- defaults;
- validation retries;
- add/edit previews;
- no write before confirmation;
- browser refresh and selected-date retention.

An opt-in integration smoke test may read configured sources, but the normal test suite must be offline and must never write.

---

## 14. Implementation phases

## Phase 0 — lock semantics and capture fixtures

1. Confirm the small set of product decisions listed in section 15.
2. Capture anonymized examples of normal, duplicate, open, and cross-midnight clock-event sequences if available.
3. Capture anonymized Redmine time-entry responses including excused entries.
4. Write domain and presence tests against those fixtures before moving output code.

Deliverable: executable specification of the data semantics.

## Phase 1 — Bun runtime and CLI skeleton

1. Move entry point to `src/`.
2. Switch package/build/shebang to Bun-only.
3. Port and extend the sqlcli registry.
4. Define the entire v3 command tree and generated help.
5. Implement `config` and `version` commands.
6. Add CLI tests.
7. Delete the generated version-file requirement.

Deliverable: stable v3 command ergonomics, with report commands allowed to call temporary adapters.

## Phase 2 — source gateways and domain report

1. Split Redmine and presence clients behind interfaces.
2. Correct range boundaries, cross-midnight sessions, and local-time handling.
3. Introduce explicit anomalies.
4. Replace gross/net/ignored types with booked/presence/excused domain facts.
5. Implement completed-day summary and current-day handling.
6. Add exhaustive domain tests.

Deliverable: trustworthy report object independent of output.

## Phase 3 — Markdown, terminal, and JSON output

1. Implement eight-cell bars.
2. Generate concise report Markdown.
3. Wrap `Bun.markdown.ansi`.
4. Implement the new report JSON schema.
5. Add `--verbose` details.
6. Remove `colors.ts`, `TableBuilder`, old human/JSON renderers, and `--brief`.
7. Verify TTY, pipe, `NO_COLOR`, Markdown, and JSON behavior.

Deliverable: the primary daily experience.

## Phase 4 — trend and gap analysis

1. Implement weekly/monthly bucketing.
2. Add rolling booking-diligence comparison.
3. Add trend chart and concise bucket table.
4. Add ranked booking/attendance gaps.
5. Add command-specific JSON schemas.

Deliverable: quick detection of recent slack and historical problem dates.

## Phase 5 — read-only entry browser

1. Implement entry list/get and issue/activity lookups.
2. Add selected-day report context.
3. Build prompt adapter and browser loop.
4. Add issue preview and cache.
5. Test cancellation/navigation thoroughly.

Deliverable: interactive navigation without writes.

## Phase 6 — add and edit entries

1. Add Redmine create/update methods.
2. Implement validated forms and dry-run previews.
3. Add confirmation and post-write refetch.
4. Add direct scripting flags and JSON result output.
5. Optionally add delete last, with stronger confirmation.

Deliverable: safe interactive Redmine time-entry maintenance.

## Phase 7 — documentation and cleanup

1. Rewrite README around tasks, not flags.
2. Include terminal, Markdown, and JSON examples.
3. Document exact metric formulas and day classification.
4. Document write behavior and recovery from API errors.
5. Replace the old changelog narrative with a v3 breaking-change summary.
6. Run formatter, typecheck, tests, build, and installed-binary smoke tests.

---

## 15. Decisions to approve before implementation

The recommendations below are deliberate defaults, not unresolved implementation details:

1. **Runtime:** make v3 Bun-only, minimum Bun 1.4.x, so built-in terminal Markdown is a first-class dependency.
2. **No-argument behavior:** `whstats` runs `report recent`; it does not print root help.
3. **Recent range:** 14 inclusive calendar dates, giving roughly ten normal attendance days.
4. **Calendar presets:** `week` and `month` mean current calendar periods; rolling periods are named explicitly.
5. **Primary metric:** rename booked/present “efficiency” to weighted booking coverage.
6. **Current running day:** show it live, keep its eight-hour target visible, but omit it from historical trend comparisons.
7. **Excused entries:** leave-only dates have no target; mixed dates remain full-target and are called out rather than partially adjusted.
8. **Default detail:** one row per day with up to two issue/hour teasers; `--verbose` shows all entries.
9. **Default output:** terminal-rendered Markdown on a TTY, raw Markdown in a pipe, explicit JSON with `-o json`.
10. **Interactive scope:** start with a prompt-driven browser and forms; defer a full-screen OpenTUI dependency.
11. **Compatibility:** old commands and JSON fail rather than warn or alias.
12. **Config:** either rerun setup once or perform a one-time rewrite; do not keep a permanent legacy schema loader.

---

## 16. Definition of done

The refactor is complete when:

- `whstats` gives a useful recent report with no arguments;
- every observed date occupies one concise default row;
- every report has a summary;
- only `--verbose` expands human detail;
- arbitrary inclusive historical ranges work;
- `trend` visibly answers whether booking coverage is deteriorating;
- `gaps` identifies the worst historical dates;
- current-day and excused-day semantics are explicit;
- presence reconstruction is tested across boundaries and midnight;
- terminal output is rendered from Markdown by Bun;
- raw Markdown and JSON are clean, deterministic, and scriptable;
- JSON no longer contains renderer-specific past/today/partial-target fields;
- commands and help come from the sqlcli-style registry;
- interactive browsing works without writes;
- add/edit require explicit validated actions and can be cancelled safely;
- the normal test suite is offline and includes no real write operation;
- the old parser, output abstractions, color helpers, and compatibility flags are deleted.
