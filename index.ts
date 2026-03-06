#!/usr/bin/env node

import { parseArgs } from "node:util";
import {
  getConfigOrExit,
  promptForConfig,
  loadConfig,
  deleteConfig,
  getConfigPath,
  configExists,
} from "./lib/config.js";
import { fetchCurrentUser, fetchTimeEntries, type TimeEntry } from "./lib/redmine.js";
import { fetchClockedHours } from "./lib/mssql.js";
import {
  getDateRange,
  getYearToDateRange,
  getYearRange,
  formatHours,
  groupByDate,
  calculateNetBookedHours,
  calculateGrossBookedHours,
} from "./lib/utils.js";
import { colors as c } from "./lib/colors.js";
import { VERSION } from "./lib/version.js";
import type { DayStats, SummaryData, StatsData } from "./lib/output/types.js";
import { renderDayHeader, renderEntries, renderSummary } from "./lib/output/human.js";
import { render as renderJson } from "./lib/output/json.js";

function helpLine(flag: string, desc: string): string {
  return `    ${c.highlight(flag)} ${c.dim(desc)}`;
}

function showHelp(): void {
  console.log(
    c.line(`
  ${c.info(`WH Stats`)} ${c.dim(`v${VERSION}`)}

  Compare booked hours (Redmine) vs clocked hours (timelogger).

  ${c.info("Usage:")}
    A) Run ${c.highlight(`"npx whstats"`)} to execute without installing globally.
    B) Alternatively, install with ${c.highlight(`'npm install -g whstats'`)} and run ${c.highlight(`'whstats'`)}.
       Update with ${c.highlight(`'npm update -g whstats --latest'`)}.

${helpLine("whstats                ", "Show time statistics for the last 7 days (default)")}
${helpLine("whstats --week         ", "Show time statistics for the last 7 days (week)")}
${helpLine("whstats --month        ", "Show time statistics for the last 30 days (month)")}
${helpLine("whstats --year         ", "Show time statistics for the past 365 days (-y)")}
${helpLine("whstats --year-to-date ", "Show time statistics from Jan 1 to today (-Y)")}
${helpLine("whstats --brief        ", "Show concise output (daily totals only)")}
${helpLine("whstats --no-summary   ", "Show without aggregate summary (-n)")}
${helpLine("whstats --json         ", "Output results as JSON (-j)")}
${helpLine("whstats --config       ", "Configure credentials (interactive, alias: --setup)")}
${helpLine("whstats --setup        ", "Configure credentials (interactive, alias: --config)")}
${helpLine("whstats --show-config  ", "Show config file location and current settings")}
${helpLine("whstats --reset        ", "Delete saved configuration (-r)")}
${helpLine("whstats --help         ", "Show this help message")}
${helpLine("whstats --version      ", "Show version")}

  ${c.info("Configuration:")}
    Run ${c.highlight("'whstats --setup'")} to configure your credentials interactively.
    Credentials are stored in: ${c.dim("~/.config/whstats/config.json")}
`),
  );
}

function showVersion(): void {
  console.log(c.line(`whstats v${VERSION}`));
}

function maskSecret(_value: string): string {
  return "**********";
}

function showConfig(): void {
  const configPath = getConfigPath();
  const exists = configExists();

  console.log(c.line(`\n  Config file: ${configPath}`));
  console.log(
    c.line(`  Status: ${exists ? c.success("configured") : c.warning("not configured")}\n`),
  );

  if (exists) {
    const config = loadConfig();
    if (config) {
      console.log(c.line("  Current settings:"));
      console.log(c.line(`    Redmine URL:       ${c.highlight(config.redmineUrl)}`));
      console.log(
        c.line(`    Redmine API Key:   ${c.highlight(maskSecret(config.redmineApiKey))}`),
      );
      console.log(c.line(`    MSSQL Server:      ${c.highlight(config.mssqlServer)}`));
      console.log(c.line(`    MSSQL Database:    ${c.highlight(config.mssqlDatabase)}`));
      console.log(c.line(`    MSSQL User:        ${c.highlight(config.mssqlUser)}`));
      console.log(
        c.line(`    MSSQL Password:    ${c.highlight(maskSecret(config.mssqlPassword))}`),
      );
      console.log(c.line(`    Slack User ID:     ${c.highlight(maskSecret(config.slackUserId))}`));
      console.log(
        c.line(`    Target hours/day:  ${c.highlight(`${config.targetHoursPerDay ?? 8}h`)}`),
      );
      const ignored = config.ignoredRedmineTicketIds ?? [];
      const ignoredLabel = ignored.length > 0 ? ignored.join(", ") : "(none)";
      console.log(c.line(`    Ignored tickets:   ${c.highlight(ignoredLabel)}`));
      console.log("");
    }
  }
}

async function handleSetup(): Promise<void> {
  const existing = loadConfig();
  await promptForConfig(existing);
}

function handleReset(): void {
  if (deleteConfig()) {
    console.log(c.line(`\n  ${c.success("Configuration deleted.")}\n`));
  } else {
    console.log(c.line(`\n  ${c.warning("No configuration file found.")}\n`));
  }
}

function prepareStatsData(
  entries: TimeEntry[],
  clockedHours: Map<string, number>,
  currentDate: string,
  isCurrentDayClockRunning: boolean,
  targetHoursPerDay: number,
  ignoredTicketIds: ReadonlySet<number>,
): StatsData {
  const isIgnored = (entry: TimeEntry): boolean => {
    const issueId = entry.issue?.id;
    return issueId !== undefined && ignoredTicketIds.has(issueId);
  };

  const grouped = groupByDate(entries);

  // Combine all dates from both sources
  const allDates = new Set([...grouped.keys(), ...clockedHours.keys()]);
  const sortedDates = Array.from(allDates).sort();

  const dayStats: DayStats[] = sortedDates.map((date) => {
    const dayEntries = grouped.get(date) || [];
    const grossBooked = calculateGrossBookedHours(dayEntries);
    const netBooked = calculateNetBookedHours(dayEntries, ignoredTicketIds);
    const clocked = clockedHours.get(date) || 0;
    const excludedFromNet =
      dayEntries.length > 0 && dayEntries.every((entry) => isIgnored(entry)) && clocked === 0;

    return {
      date,
      dayName: new Date(date).toLocaleDateString("en-US", { weekday: "short" }),
      grossBooked,
      netBooked,
      clocked,
      excludedFromNet,
      entries: dayEntries,
    };
  });

  // Calculate totals
  let totalBooked = 0;
  let totalClocked = 0;
  for (const stats of dayStats) {
    totalBooked += stats.netBooked;
    totalClocked += stats.clocked;
  }

  const eligibleDayStats = dayStats.filter((stats) => !stats.excludedFromNet);
  const workdays = eligibleDayStats.length;
  const currentDayStats = dayStats.find((stats) => stats.date === currentDate);
  const hasCurrentDateInRange = currentDayStats !== undefined;

  let targetTotal = 0;
  let hasPartialCurrentDayTarget = false;
  let partialCurrentDayTarget = 0;

  for (const stats of eligibleDayStats) {
    let dayTarget = targetHoursPerDay;
    if (isCurrentDayClockRunning && stats.date === currentDate) {
      const clockedToday = stats.clocked;
      dayTarget = Math.min(clockedToday, targetHoursPerDay);
      hasPartialCurrentDayTarget = dayTarget !== targetHoursPerDay;
      partialCurrentDayTarget = dayTarget;
    }
    targetTotal += dayTarget;
  }

  const bookedToday = currentDayStats?.netBooked ?? 0;
  const bookedPastDays = totalBooked - bookedToday;
  const clockedToday = hasCurrentDateInRange ? currentDayStats?.clocked || 0 : 0;
  const clockedPastDays = totalClocked - clockedToday;

  const bookedDiscrepancy = totalBooked - targetTotal;
  const clockedDiscrepancy = totalClocked - targetTotal;
  const bookedPct = targetTotal > 0 ? Math.round((totalBooked / targetTotal) * 100) : 0;
  const clockedPct = targetTotal > 0 ? Math.round((totalClocked / targetTotal) * 100) : 0;
  const efficiency = totalClocked > 0 ? Math.round((totalBooked / totalClocked) * 100) : 0;

  const summary: SummaryData = {
    workdays,
    targetHoursPerDay,
    targetTotal,
    hasPartialCurrentDayTarget,
    partialCurrentDayTarget,
    booked: {
      total: totalBooked,
      past: bookedPastDays,
      today: bookedToday,
    },
    clocked: {
      total: totalClocked,
      past: clockedPastDays,
      today: clockedToday,
    },
    discrepancies: {
      booked: bookedDiscrepancy,
      clocked: clockedDiscrepancy,
    },
    percentages: {
      booked: bookedPct,
      clocked: clockedPct,
      efficiency,
    },
    currentDate,
    isClockRunningToday: isCurrentDayClockRunning,
  };

  return { days: dayStats, summary };
}

function displayResults(
  entries: TimeEntry[],
  clockedHours: Map<string, number>,
  currentDate: string,
  isCurrentDayClockRunning: boolean,
  brief = false,
  showAggregates = true,
  targetHoursPerDay = 8,
  ignoredTicketIds: ReadonlySet<number> = new Set<number>(),
  json = false,
  fromDate = "",
  toDate = "",
): void {
  const statsData = prepareStatsData(
    entries,
    clockedHours,
    currentDate,
    isCurrentDayClockRunning,
    targetHoursPerDay,
    ignoredTicketIds,
  );

  if (json) {
    console.log(renderJson(statsData, fromDate, toDate, brief, showAggregates));
    return;
  }

  console.log("");

  for (const day of statsData.days) {
    for (const line of renderDayHeader(day)) {
      console.log(line);
    }

    if (!brief) {
      for (const line of renderEntries(day.entries, ignoredTicketIds)) {
        console.log(line);
      }
      console.log("");
    }
  }

  if (showAggregates) {
    for (const line of renderSummary(statsData.summary)) {
      console.log(line);
    }
    console.log("");
  }
}

async function runStats(
  days: number = 7,
  brief = false,
  showAggregates = true,
  json = false,
): Promise<void> {
  const { from, to } = getDateRange(days);
  await runStatsForRange(from, to, brief, showAggregates, json);
}

async function runStatsForRange(
  from: string,
  to: string,
  brief = false,
  showAggregates = true,
  json = false,
): Promise<void> {
  const config = getConfigOrExit();
  const ignoredTicketIds = new Set(config.ignoredRedmineTicketIds ?? []);

  try {
    const user = await fetchCurrentUser(config);
    if (!brief && !json) {
      console.log(
        c.line(`\n${c.info(`Fetching time entries for ${user.firstname} ${user.lastname}...`)}`),
      );
    }

    const [entries, clockedData] = await Promise.all([
      fetchTimeEntries(config, user.id, from, to),
      fetchClockedHours(config, from, to),
    ]);

    const targetHours = config.targetHoursPerDay ?? 8;
    displayResults(
      entries,
      clockedData.hoursByDate,
      clockedData.today,
      clockedData.isClockRunningToday,
      brief,
      showAggregates,
      targetHours,
      ignoredTicketIds,
      json,
      from,
      to,
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(c.line(`\n  ${c.danger(`Error: ${error.message}`)}\n`));
    } else {
      console.error(c.line(`\n  ${c.danger("An unexpected error occurred.")}\n`));
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        setup: { type: "boolean" },
        config: { type: "boolean" },
        "show-config": { type: "boolean" },
        reset: { type: "boolean", short: "r" },
        week: { type: "boolean", short: "w" },
        month: { type: "boolean", short: "m" },
        "year-to-date": { type: "boolean", short: "Y" },
        year: { type: "boolean", short: "y" },
        brief: { type: "boolean", short: "b" },
        "no-summary": { type: "boolean", short: "n" },
        json: { type: "boolean", short: "j" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unknown option")) {
      const unknownFlag = error.message.match(/'([^']+)'/)?.[1] ?? "unknown";
      console.error(c.line(`\n  ${c.warning(`Unknown flag: ${unknownFlag}`)}`));
      console.error(c.line(`  ${c.dim("Run 'whstats --help' for usage.")}\n`));
      process.exit(1);
    }
    throw error;
  }

  const { values, positionals } = parsed;
  const brief = values.brief ?? false;
  const showAggregates = !(values["no-summary"] ?? false);
  const json = values.json ?? false;

  // Determine which command to run
  // Priority: explicit command flags > non-flag positional > default (7 days)
  const commandFlag =
    values.help ? "help"
    : values.version ? "version"
    : values["show-config"] ? "show-config"
    : values.setup ? "setup"
    : values.config ? "config"
    : values.reset ? "reset"
    : values.week ? "week"
    : values.month ? "month"
    : values.year ? "year"
    : values["year-to-date"] ? "year-to-date"
    : null;

  const nonFlagArg = positionals[0];
  const command = commandFlag ?? nonFlagArg;

  switch (command) {
    case "help":
    case "h":
      showHelp();
      break;

    case "version":
    case "v":
      showVersion();
      break;

    case "setup":
    case "config":
      await handleSetup();
      break;

    case "show-config":
      showConfig();
      break;

    case "reset":
    case "r":
      handleReset();
      break;

    case "week":
    case "w":
      await runStats(7, brief, showAggregates, json);
      break;

    case "month":
    case "m":
      await runStats(30, brief, showAggregates, json);
      break;

    case "year":
    case "y": {
      const { from, to } = getYearRange();
      await runStatsForRange(from, to, brief, showAggregates, json);
      break;
    }

    case "year-to-date":
    case "Y":
    case "ytd": {
      const { from, to } = getYearToDateRange();
      await runStatsForRange(from, to, brief, showAggregates, json);
      break;
    }

    case undefined:
    case null:
      await runStats(7, brief, showAggregates, json);
      break;

    default:
      console.error(c.line(`\n  ${c.warning(`Unknown command: ${command}`)}`));
      console.error(c.line(`  ${c.dim("Run 'whstats --help' for usage.")}\n`));
      process.exit(1);
  }
}

main();
