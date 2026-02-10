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
import { getDateRange, formatHours, truncateComment, getDayName } from "./lib/utils.js";
import { VERSION } from "./lib/version.js";

function showHelp(): void {
  console.log(`
  WH Stats v${VERSION}

  Compare booked hours (Redmine) vs clocked hours (timelogger).

  Usage:
    whstats              Show time statistics for the last 7 days (default)
    whstats --week       Show time statistics for the last 7 days (week)
    whstats --month      Show time statistics for the last 30 days (month)
    whstats --brief      Show concise output (daily totals only)
    whstats --setup      Configure credentials (interactive)
    whstats --config     Show config file location
    whstats --reset      Delete saved configuration
    whstats --help       Show this help message
    whstats --version    Show version

  Configuration:
    Run 'whstats --setup' to configure your credentials interactively.
    Credentials are stored in: ~/.config/whstats/config.json
`);
}

function showVersion(): void {
  console.log(`whstats v${VERSION}`);
}

function showConfig(): void {
  const configPath = getConfigPath();
  const exists = configExists();

  console.log(`\n  Config file: ${configPath}`);
  console.log(`  Status: ${exists ? "configured" : "not configured"}\n`);

  if (exists) {
    const config = loadConfig();
    if (config) {
      console.log("  Current settings:");
      console.log(`    Redmine URL:    ${config.redmineUrl}`);
      console.log(`    Redmine API:    ${config.redmineApiKey.slice(0, 8)}...`);
      console.log(`    MSSQL Server:   ${config.mssqlServer}`);
      console.log(`    MSSQL Database: ${config.mssqlDatabase}`);
      console.log(`    MSSQL User:     ${config.mssqlUser}`);
      console.log(`    User ID:        ${config.slackUserId}\n`);
    }
  }
}

async function handleSetup(): Promise<void> {
  const existing = loadConfig();
  await promptForConfig(existing);
}

function handleReset(): void {
  if (deleteConfig()) {
    console.log("\n  Configuration deleted.\n");
  } else {
    console.log("\n  No configuration file found.\n");
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

function displayResults(entries: TimeEntry[], clockedHours: Map<string, number>, brief = false): void {
  const grouped = groupByDate(entries);

  // Combine all dates from both sources
  const allDates = new Set([...grouped.keys(), ...clockedHours.keys()]);
  const sortedDates = Array.from(allDates).sort();

  if (sortedDates.length === 0) {
    console.log("No time entries found for the selected period.");
    return;
  }

  console.log("");
  for (const date of sortedDates) {
    const dayEntries = grouped.get(date) || [];
    const bookedHours = dayEntries.reduce((sum, e) => sum + e.hours, 0);
    const clocked = clockedHours.get(date) || 0;
    const dayName = getDayName(date);

    const clockedStr = clocked > 0 ? formatHours(clocked) : "-";
    console.log(`${date} ${dayName}: ${formatHours(bookedHours)} booked / ${clockedStr} clocked`);

    if (!brief) {
      for (const entry of dayEntries) {
        const issueRef = entry.issue ? `#${entry.issue.id}` : "#N/A";
        const hours = formatHours(entry.hours);
        const comment = truncateComment(entry.comments || "(no comment)");
        console.log(`  - ${issueRef} ${hours} ${comment}`);
      }
      console.log("");
    }
  }
  if (!brief) {
    console.log("");
  }
}

async function runStats(days: number = 7, brief = false): Promise<void> {
  const config = getConfigOrExit();

  try {
    const user = await fetchCurrentUser(config);
    if (!brief) {
      console.log(`\nFetching time entries for ${user.firstname} ${user.lastname}...`);
    }

    const { from, to } = getDateRange(days);

    const [entries, clockedHours] = await Promise.all([
      fetchTimeEntries(config, user.id, from, to),
      fetchClockedHours(config, from, to),
    ]);

    displayResults(entries, clockedHours, brief);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n  Error: ${error.message}\n`);
    } else {
      console.error("\n  An unexpected error occurred.\n");
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Filter out script name (e.g., "index.ts") when running with bun
  const args = process.argv.slice(2).filter((arg) => !arg.endsWith(".ts") && !arg.endsWith(".js"));
  const brief = args.includes("--brief") || args.includes("-b");
  // Get first non-flag argument, or if all are flags, undefined (default to stats)
  const nonFlagArg = args.find((arg) => !arg.startsWith("-"));
  const command = nonFlagArg;

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
      await runStats(7, brief);
      break;

    case "-m":
    case "--month":
      await runStats(30, brief);
      break;

    case undefined:
      await runStats(7, brief);
      break;

    default:
      console.error(`\n  Unknown command: ${command}`);
      console.error("  Run 'whstats --help' for usage.\n");
      process.exit(1);
  }
}

main();
