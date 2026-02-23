#!/usr/bin/env node

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
import { getDateRange, formatHours, truncateComment, getDayName, truncateProject } from "./lib/utils.js";
import { colors as c, stripAnsi } from "./lib/colors.js";
import { VERSION } from "./lib/version.js";

function helpLine(flag: string, desc: string): string {
  return `    ${c.highlight(flag)} ${c.dim(desc)}`;
}

function showHelp(): void {
  console.log(c.line(`
  ${c.info(`WH Stats`)} ${c.dim(`v${VERSION}`)}

  Compare booked hours (Redmine) vs clocked hours (timelogger).

  ${c.info("Usage:")}
    A) Run ${c.highlight(`"npx whstats"`)} to execute without installing globally.
    B) Alternatively, install with ${c.highlight(`'npm install -g whstats'`)} and run ${c.highlight(`'whstats'`)}.
       Update with ${c.highlight(`'npm update -g whstats --latest'`)}.

${helpLine("whstats                ", "Show time statistics for the last 7 days (default)")}
${helpLine("whstats --week         ", "Show time statistics for the last 7 days (week)")}
${helpLine("whstats --month        ", "Show time statistics for the last 30 days (month)")}
${helpLine("whstats --brief        ", "Show concise output (daily totals only)")}
${helpLine("whstats --no-summary   ", "Show without aggregate summary (-n)")}
${helpLine("whstats --setup        ", "Configure credentials (interactive)")}
${helpLine("whstats --config       ", "Show config file location")}
${helpLine("whstats --reset        ", "Delete saved configuration")}
${helpLine("whstats --help         ", "Show this help message")}
${helpLine("whstats --version      ", "Show version")}

  ${c.info("Configuration:")}
    Run ${c.highlight("'whstats --setup'")} to configure your credentials interactively.
    Credentials are stored in: ${c.dim("~/.config/whstats/config.json")}
`));
}

function showVersion(): void {
  console.log(c.line(`whstats v${VERSION}`));
}

function showConfig(): void {
  const configPath = getConfigPath();
  const exists = configExists();

  console.log(c.line(`\n  Config file: ${configPath}`));
  console.log(c.line(`  Status: ${exists ? c.success("configured") : c.warning("not configured")}\n`));

  if (exists) {
    const config = loadConfig();
    if (config) {
      console.log(c.line("  Current settings:"));
      console.log(c.line(`    Redmine URL:       ${c.highlight(config.redmineUrl)}`));
      console.log(c.line(`    Redmine API:       ${c.highlight(config.redmineApiKey.slice(0, 8))}...`));
      console.log(c.line(`    MSSQL Server:      ${c.highlight(config.mssqlServer)}`));
      console.log(c.line(`    MSSQL Database:    ${c.highlight(config.mssqlDatabase)}`));
      console.log(c.line(`    MSSQL User:        ${c.highlight(config.mssqlUser)}`));
      console.log(c.line(`    User ID:           ${c.highlight(config.slackUserId)}`));
      console.log(c.line(`    Target hours/day:  ${c.highlight(`${config.targetHoursPerDay ?? 8}h`)}\n`));
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

function groupByDate(entries: TimeEntry[]): Map<string, TimeEntry[]> {
  const grouped = new Map<string, TimeEntry[]>();

  for (const entry of entries) {
    const date = entry.spent_on;
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(entry);
  }

  return grouped;
}

function colorizePercentage(value: number, label?: string): string {
  const text = label ?? `${value}%`;
  if (value > 95) {
    return c.success(text);
  }
  if (value >= 90) {
    return c.warning(text);
  }
  return c.danger(text);
}

function displayResults(
  entries: TimeEntry[],
  clockedHours: Map<string, number>,
  currentDate: string,
  isCurrentDayClockRunning: boolean,
  brief = false,
  showAggregates = true,
  targetHoursPerDay = 8
): void {
  const grouped = groupByDate(entries);

  // Combine all dates from both sources
  const allDates = new Set([...grouped.keys(), ...clockedHours.keys()]);
  const sortedDates = Array.from(allDates).sort();

  if (sortedDates.length === 0) {
    console.log(c.line(c.warning("No time entries found for the selected period.")));
    return;
  }

  // Calculate totals for aggregates
  let totalBooked = 0;
  let totalClocked = 0;

  console.log("");
  for (const date of sortedDates) {
    const dayEntries = grouped.get(date) || [];
    const bookedHours = dayEntries.reduce((sum, e) => sum + e.hours, 0);
    const clocked = clockedHours.get(date) || 0;
    const dayName = getDayName(date);

    totalBooked += bookedHours;
    totalClocked += clocked;

    const clockedStr = clocked > 0 ? formatHours(clocked) : "-";
    console.log(
      c.line(
        `${c.info(date)} ${c.dim(`[${dayName}]`)}: ${c.highlight(formatHours(bookedHours))} booked / ${clocked > 0 ? c.highlight(clockedStr) : clockedStr} clocked`
      )
    );

    if (!brief) {
      for (const entry of dayEntries) {
        const issueRef = entry.issue ? `#${entry.issue.id}` : "#N/A";
        const project = truncateProject(entry.project?.name || "N/A");
        const hours = formatHours(entry.hours).padStart(5, " ");
        const comment = truncateComment(entry.comments || "(no comment)");
        console.log(c.line(`    ${c.highlight(hours)} ${c.warning(project)} ${c.danger(issueRef)} ${c.dim(comment)}`));
      }
      console.log("");
    }
  }

  // Display aggregates if enabled
  if (showAggregates) {
    const workdays = sortedDates.length;
    let targetTotal = 0;
    let hasAdjustedCurrentDayTarget = false;
    let adjustedCurrentDayTarget = 0;
    const hasCurrentDateInRange = sortedDates.includes(currentDate);
    const bookedToday = hasCurrentDateInRange ? grouped.get(currentDate)?.reduce((sum, e) => sum + e.hours, 0) ?? 0 : 0;
    const bookedPastDays = totalBooked - bookedToday;

    for (const date of sortedDates) {
      let dayTarget = targetHoursPerDay;
      if (isCurrentDayClockRunning && date === currentDate) {
        const clockedToday = clockedHours.get(date) || 0;
        dayTarget = Math.min(clockedToday, targetHoursPerDay);
        hasAdjustedCurrentDayTarget = dayTarget !== targetHoursPerDay;
        adjustedCurrentDayTarget = dayTarget;
      }
      targetTotal += dayTarget;
    }

    const bookedDiscrepancy = totalBooked - targetTotal;
    const clockedDiscrepancy = totalClocked - targetTotal;
    const bookedPct = targetTotal > 0 ? Math.round((totalBooked / targetTotal) * 100) : 0;
    const clockedPct = targetTotal > 0 ? Math.round((totalClocked / targetTotal) * 100) : 0;
    const efficiency = totalClocked > 0 ? Math.round((totalBooked / totalClocked) * 100) : 0;
    const efficiencyLine = `    Efficiency: ${colorizePercentage(efficiency)} ${c.dim("(booked/clocked ratio)")}`;

    const pastDaysTarget = targetTotal - adjustedCurrentDayTarget;
    const summary = `Summary (${workdays} days)`;

    const bookedSign = bookedDiscrepancy > 0 ? "+" : "";
    const clockedSign = clockedDiscrepancy > 0 ? "+" : "";

    if (hasAdjustedCurrentDayTarget) {
      const clockedToday = hasCurrentDateInRange ? clockedHours.get(currentDate) || 0 : 0;
      const clockedPastDays = totalClocked - clockedToday;

      const splitRows = [
        {
          prefix: "    Target:",
          past: formatHours(pastDaysTarget),
          today: formatHours(adjustedCurrentDayTarget),
          pctValue: undefined as number | undefined,
          discrepancy: "",
          tail: "target",
        },
        {
          prefix: "    Booked:",
          past: formatHours(bookedPastDays),
          today: formatHours(bookedToday),
          pctValue: bookedPct,
          discrepancy: `(${bookedSign}${formatHours(bookedDiscrepancy)})`,
          tail: "",
        },
        {
          prefix: "    Clocked:",
          past: formatHours(clockedPastDays),
          today: formatHours(clockedToday),
          pctValue: clockedPct,
          discrepancy: `(${clockedSign}${formatHours(clockedDiscrepancy)})`,
          tail: "",
        },
      ];

      const pctLabels = splitRows.map((row) => (row.pctValue === undefined ? "" : `${row.pctValue}%`));

      const prefixWidth = Math.max(...splitRows.map((row) => row.prefix.length));
      const pastWidth = Math.max(...splitRows.map((row) => row.past.length));
      const todayWidth = Math.max(...splitRows.map((row) => row.today.length));
      const pctWidth = Math.max(...pctLabels.map((label) => label.length));
      const discrepancyWidth = Math.max(...splitRows.map((row) => row.discrepancy.length));

      const rowLines = splitRows.map((row, index) => {
        const pctLabel = pctLabels[index]!;
        const paddedPct = pctLabel.padStart(pctWidth, " ");
        const coloredPct = row.pctValue === undefined ? "" : colorizePercentage(row.pctValue, paddedPct);
        if (pctLabel.length === 0 && row.discrepancy.length === 0) {
          return `${row.prefix.padEnd(prefixWidth, " ")} ${c.highlight(row.past.padStart(pastWidth, " "))} + ${c.highlight(row.today.padStart(todayWidth, " "))} ${row.tail}`;
        }
        return `${row.prefix.padEnd(prefixWidth, " ")} ${c.highlight(row.past.padStart(pastWidth, " "))} + ${c.highlight(row.today.padStart(todayWidth, " "))} = ${coloredPct} ${c.dim(row.discrepancy.padStart(discrepancyWidth, " "))}`;
      });

      const separatorWidth = Math.max(
        summary.length,
        stripAnsi(efficiencyLine).length,
        ...rowLines.map((line) => stripAnsi(line).length),
      );
      console.log(c.line("─".repeat(separatorWidth)));
      console.log(c.line(`Summary ${c.dim(`(${workdays} days)`)}`));

      for (const line of rowLines) {
        console.log(c.line(line));
      }
    } else {
      const targetLine = `    Target:  ${c.highlight(formatHours(targetHoursPerDay))}/day = ${c.highlight(formatHours(targetTotal))} target`;
      const bookedLine = `    Booked:  ${c.highlight(formatHours(totalBooked))} = ${colorizePercentage(bookedPct)} ${c.dim(`(${bookedSign}${formatHours(bookedDiscrepancy)})`)}`;
      const clockedLine = `    Clocked: ${c.highlight(formatHours(totalClocked))} = ${colorizePercentage(clockedPct)} ${c.dim(`(${clockedSign}${formatHours(clockedDiscrepancy)})`)}`;
      const separatorWidth = Math.max(
        summary.length,
        stripAnsi(targetLine).length,
        stripAnsi(bookedLine).length,
        stripAnsi(clockedLine).length,
        stripAnsi(efficiencyLine).length,
      );
      console.log(c.line("─".repeat(separatorWidth)));
      console.log(c.line(`Summary ${c.dim(`(${workdays} days)`)}`));
      console.log(c.line(targetLine));
      console.log(c.line(bookedLine));
      console.log(c.line(clockedLine));
    }
    console.log(c.line(efficiencyLine));
    console.log("");
  }
}

async function runStats(days: number = 7, brief = false, showAggregates = true): Promise<void> {
  const config = getConfigOrExit();

  try {
    const user = await fetchCurrentUser(config);
    if (!brief) {
      console.log(c.line(`\n${c.info(`Fetching time entries for ${user.firstname} ${user.lastname}...`)}`));
    }

    const { from, to } = getDateRange(days);

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

const COMMAND_FLAGS = new Set([
  "--help", "-h",
  "--version", "-v",
  "--setup", "-s",
  "--config", "-c",
  "--reset", "-r",
  "--week", "-w",
  "--month", "-m",
]);

const MODIFIER_FLAGS = new Set(["--brief", "-b", "--no-summary", "-n"]);

async function main(): Promise<void> {
  // Filter out script name (e.g., "index.ts") when running with bun
  const args = process.argv.slice(2).filter((arg) => !arg.endsWith(".ts") && !arg.endsWith(".js"));
  const brief = args.includes("--brief") || args.includes("-b");
  const showAggregates = !args.includes("--no-summary") && !args.includes("-n");

  // Check for unknown flags
  const unknownFlag = args.find((arg) =>
    arg.startsWith("-") &&
    !COMMAND_FLAGS.has(arg) &&
    !MODIFIER_FLAGS.has(arg)
  );
  if (unknownFlag) {
    console.error(c.line(`\n  ${c.warning(`Unknown flag: ${unknownFlag}`)}`));
    console.error(c.line(`  ${c.dim("Run 'whstats --help' for usage.")}\n`));
    process.exit(1);
  }

  // Command is either a known command flag or a non-flag argument
  const flagCommand = args.find((arg) => COMMAND_FLAGS.has(arg));
  const nonFlagArg = args.find((arg) => !arg.startsWith("-"));
  const command = flagCommand ?? nonFlagArg;

  switch (command) {
    case "--help":
    case "-h":
      showHelp();
      break;

    case "--version":
    case "-v":
      showVersion();
      break;

    case "--setup":
    case "-s":
      await handleSetup();
      break;

    case "--config":
    case "-c":
      showConfig();
      break;

    case "--reset":
    case "-r":
      handleReset();
      break;

    case "-w":
    case "--week":
      await runStats(7, brief, showAggregates);
      break;

    case "-m":
    case "--month":
      await runStats(30, brief, showAggregates);
      break;

    case undefined:
      await runStats(7, brief, showAggregates);
      break;

    default:
      console.error(c.line(`\n  ${c.warning(`Unknown command: ${command}`)}`));
      console.error(c.line(`  ${c.dim("Run 'whstats --help' for usage.")}\n`));
      process.exit(1);
  }
}

main();
