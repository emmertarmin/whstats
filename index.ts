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

const VERSION = "1.0.0";

function showHelp(): void {
  console.log(`
  WH Stats v${VERSION}
  
  Compare booked hours (Redmine) vs clocked hours (timelogger) for the last 7 days.

  Usage:
    whstats              Show time statistics
    whstats --setup      Configure credentials (interactive)
    whstats --config     Show config file location
    whstats --reset      Delete saved configuration
    whstats --help       Show this help message
    whstats --version    Show version

  Configuration:
    Credentials are stored in: ~/.config/whstats/config.json
    
    Alternatively, set environment variables:
      REDMINE_API_KEY, REDMINE_URL,
      MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD,
      SLACK_USER_ID
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

function displayResults(entries: TimeEntry[], clockedHours: Map<string, number>): void {
  const grouped = groupByDate(entries);

  // Combine all dates from both sources
  const allDates = new Set([...grouped.keys(), ...clockedHours.keys()]);
  const sortedDates = Array.from(allDates).sort();

  if (sortedDates.length === 0) {
    console.log("No time entries found for the last 7 days.");
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

    for (const entry of dayEntries) {
      const issueRef = entry.issue ? `#${entry.issue.id}` : "#N/A";
      const hours = formatHours(entry.hours);
      const comment = truncateComment(entry.comments || "(no comment)");
      console.log(`  - ${issueRef} ${hours} ${comment}`);
    }
  }
  console.log("");
}

async function runStats(): Promise<void> {
  const config = getConfigOrExit();

  try {
    const user = await fetchCurrentUser(config);
    console.log(`\nFetching time entries for ${user.firstname} ${user.lastname}...`);

    const { from, to } = getDateRange(7);

    const [entries, clockedHours] = await Promise.all([
      fetchTimeEntries(config, user.id, from, to),
      fetchClockedHours(config, from, to),
    ]);

    displayResults(entries, clockedHours);
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
  const args = process.argv.slice(2);
  const command = args[0];

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

    case undefined:
      await runStats();
      break;

    default:
      console.error(`\n  Unknown command: ${command}`);
      console.error("  Run 'whstats --help' for usage.\n");
      process.exit(1);
  }
}

main();
