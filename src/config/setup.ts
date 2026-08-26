import * as readline from "node:readline";
import type { Config } from "./types.js";
import { saveConfig } from "./load.js";

function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const displayQuestion = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;

  return new Promise((resolve, reject) => {
    const onSigint = (): void => {
      reject(new Error("Configuration setup cancelled."));
    };
    rl.once("SIGINT", onSigint);
    rl.question(displayQuestion, (answer) => {
      rl.off("SIGINT", onSigint);
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function promptSecret(question: string, existingValue?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const suffix = existingValue ? " (leave blank to keep current)" : "";

    stdout.write(`${question}${suffix}: `);

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let value = "";

    const cleanup = (): void => {
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.removeListener("data", onData);
    };

    const onData = (char: Buffer): void => {
      const c = char.toString();

      switch (c) {
        case "\n":
        case "\r":
        case "\u0004":
          cleanup();
          stdout.write("\n");
          resolve(value || existingValue || "");
          break;
        case "\u0003":
          cleanup();
          stdout.write("\n");
          reject(new Error("Configuration setup cancelled."));
          break;
        case "\u007F":
          value = value.slice(0, -1);
          break;
        default:
          value += c;
      }
    };

    stdin.resume();
    stdin.on("data", onData);
  });
}

function parsePositiveNumber(input: string, fieldName: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return value;
}

function parsePositiveInteger(input: string, fieldName: string): number {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function parseExcusedIssueIds(input: string): number[] {
  if (!input.trim()) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const id = Number(trimmed);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Excused issue ID must be a positive integer: ${trimmed}`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export async function promptForConfig(existingConfig?: Config | null): Promise<Config> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n  WH Stats Configuration\n");
  console.log("  Press Enter to keep an existing value. Secret values are not displayed.\n");

  try {
    const redmineUrl = await prompt(
      rl,
      "  Redmine URL",
      existingConfig?.redmine.url ?? "https://redmine.wirth-horn.de",
    );
    const redmineApiKey = await promptSecret("  Redmine API Key", existingConfig?.redmine.apiKey);
    const server = await prompt(
      rl,
      "  MSSQL Server",
      existingConfig?.presence.server ?? "10.10.10.15",
    );
    const database = await prompt(
      rl,
      "  MSSQL Database",
      existingConfig?.presence.database ?? "wh_timelogger",
    );
    const user = await prompt(rl, "  MSSQL User", existingConfig?.presence.user);
    const password = await promptSecret("  MSSQL Password", existingConfig?.presence.password);
    const userId = parsePositiveInteger(
      await prompt(
        rl,
        "  User ID (in timelogger). Use /wh debug in Slack to find it.",
        existingConfig?.presence.userId.toString(),
      ),
      "Presence user ID",
    );
    const timeZone = await prompt(
      rl,
      "  Presence time zone",
      existingConfig?.presence.timeZone ?? "Europe/Berlin",
    );
    const targetHoursPerDay = parsePositiveNumber(
      await prompt(
        rl,
        "  Target hours per day",
        existingConfig?.report.targetHoursPerDay.toString() ?? "8",
      ),
      "Target hours per day",
    );
    const excusedIssueIds = parseExcusedIssueIds(
      await prompt(
        rl,
        "  Excused Redmine issue IDs (comma-separated)",
        existingConfig?.report.excusedIssueIds.join(",") ?? "",
      ),
    );

    const config: Config = {
      schemaVersion: 1,
      redmine: { url: redmineUrl, apiKey: redmineApiKey },
      presence: { server, database, user, password, userId, timeZone },
      report: { targetHoursPerDay, excusedIssueIds },
    };

    saveConfig(config);
    console.log("\n  Config saved.\n");
    return config;
  } finally {
    rl.close();
  }
}
