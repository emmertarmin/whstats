import type { CommandDefinition, ParsedValues } from "../cli/types.js";
import { outputFlag, rangeFlags, verboseFlag } from "../cli/shared-flags.js";
import { CliError } from "../cli/errors.js";
import { loadConfig } from "../config/index.js";
import { createPresenceGateway } from "../presence/client.js";
import { createRedmineGateway } from "../redmine/gateway.js";
import type { RedmineGateway, TimeEntry } from "../redmine/gateway.js";
import { buildReport } from "../domain/report.js";
import { renderTerminalMarkdown } from "../output/markdown-terminal.js";
import { loadOmarchyTerminalTheme } from "../output/omarchy-theme.js";
import { renderReportJson } from "../output/report-json.js";
import { renderReportMarkdown } from "../output/report-markdown.js";

export type RangePreset = "recent" | "week" | "month" | "ytd" | "rolling-year";

export interface ResolvedRange {
  from: string;
  to: string;
  preset?: RangePreset;
}

export const rangePresets: RangePreset[] = ["recent", "week", "month", "ytd", "rolling-year"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDate(value: string): Date {
  const date = new Date(`${value}T00:00:00`);
  if (formatLocalDate(date) !== value) throw new CliError(`Invalid date: ${value}`);
  return date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function compareIso(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function presetRange(preset: RangePreset, today = todayLocal()): ResolvedRange {
  const to = formatLocalDate(today);
  switch (preset) {
    case "recent":
      return { from: formatLocalDate(addDays(today, -13)), to, preset };
    case "week": {
      const mondayOffset = (today.getDay() + 6) % 7;
      return { from: formatLocalDate(addDays(today, -mondayOffset)), to, preset };
    }
    case "month":
      return {
        from: formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)),
        to,
        preset,
      };
    case "ytd":
      return { from: formatLocalDate(new Date(today.getFullYear(), 0, 1)), to, preset };
    case "rolling-year":
      return { from: formatLocalDate(addDays(today, -364)), to, preset };
  }
}

export function resolveRange(values: ParsedValues, positionals: string[]): ResolvedRange {
  const preset = positionals[0] as RangePreset | undefined;
  const from = values.from as string | undefined;
  const toValue = values.to as string | undefined;
  if (preset && (from || toValue))
    throw new CliError("Range preset conflicts with --from and --to");
  if (preset) return presetRange(preset);
  if (toValue && !from) throw new CliError("--to requires --from");
  if (from) {
    const to = toValue ?? formatLocalDate(todayLocal());
    localDate(from);
    localDate(to);
    if (compareIso(from, to) > 0) throw new CliError("--from must be before or equal to --to");
    const today = formatLocalDate(todayLocal());
    if (compareIso(to, today) > 0) throw new CliError("Range end date must not be in the future");
    return { from, to };
  }
  return presetRange("recent");
}

async function loadIssueSubjects(
  redmine: RedmineGateway,
  timeEntries: readonly TimeEntry[],
): Promise<ReadonlyMap<number, string>> {
  const issueIds = [
    ...new Set(timeEntries.flatMap((entry) => (entry.issue === undefined ? [] : [entry.issue.id]))),
  ];
  const results = await Promise.allSettled(issueIds.map((id) => redmine.getIssue(id)));
  const subjects = new Map<number, string>();
  for (const result of results) {
    if (result.status === "fulfilled") subjects.set(result.value.id, result.value.subject);
  }
  return subjects;
}

async function runReport(range: ResolvedRange, values: ParsedValues): Promise<void> {
  const config = loadConfig();
  if (!config)
    throw new CliError(
      "No configuration found. Run `whstats config setup` to configure credentials.",
    );

  const redmine = createRedmineGateway(config);
  const presenceGateway = createPresenceGateway(config);
  const dateRange = { from: range.from, to: range.to };
  const [timeEntries, presence] = await Promise.all([
    redmine.getCurrentUser().then((user) => redmine.listTimeEntries(user.id, dateRange)),
    presenceGateway.listPresence(dateRange),
  ]);

  const report = buildReport({
    range: { from: range.from, to: range.to, preset: range.preset },
    targetHoursPerDay: config.report.targetHoursPerDay,
    excusedIssueIds: new Set(config.report.excusedIssueIds),
    timeEntries,
    presence,
  });

  const requestedOutput = values.output as string | undefined;
  const output = requestedOutput ?? (process.stdout.isTTY ? "terminal" : "markdown");
  if (output === "json") {
    process.stdout.write(`${renderReportJson(report)}\n`);
    return;
  }

  const verbose = values.verbose === true;
  const issueSubjects = verbose ? await loadIssueSubjects(redmine, timeEntries) : undefined;
  const markdown = renderReportMarkdown(report, verbose, issueSubjects);
  process.stdout.write(
    output === "terminal"
      ? renderTerminalMarkdown(markdown, { theme: loadOmarchyTerminalTheme() })
      : markdown,
  );
}

export const reportCommand: CommandDefinition = {
  name: "report",
  summary: "Show daily booking and presence statistics",
  description: "Show a report for a preset or inclusive date range.",
  requiresConfig: true,
  flags: [...rangeFlags, verboseFlag, outputFlag],
  positionals: [
    { name: "preset", description: "Range preset", required: false, choices: rangePresets },
  ],
  examples: [
    "whstats report recent",
    "whstats report --from 2026-08-01 --to 2026-08-31",
    "whstats report rolling-year -o json",
  ],
  execute: async ({ values, positionals }) => {
    await runReport(resolveRange(values, positionals), values);
  },
};
