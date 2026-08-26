import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCliEnvironment,
  runCli,
  type CliEnvironment,
  type CliResult,
} from "../helpers/cli.js";

const environments: CliEnvironment[] = [];

function environment(): CliEnvironment {
  const value = createCliEnvironment();
  environments.push(value);
  return value;
}

async function safeCli(args: string[]): Promise<CliResult> {
  return runCli(args, environment());
}

afterEach(() => {
  for (const value of environments.splice(0)) value.cleanup();
});

describe("spawned help and version output", () => {
  test("prints root help with both global help flags", async () => {
    for (const flag of ["-h", "--help"]) {
      const result = await safeCli([flag]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("whstats\n");
      expect(result.stdout).toContain("Subcommands:");
      expect(result.stdout).toContain("report - Show daily booking and presence statistics");
      expect(result.stdout).toContain("With no arguments, whstats runs `whstats report recent`.");
    }
  });

  test("prints command and group help", async () => {
    const report = await safeCli(["report", "--help"]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("whstats report");
    expect(report.stdout).toContain("[preset]");
    expect(report.stdout).toContain("--output, -o <terminal|markdown|json>");
    expect(report.stdout).not.toContain("--bucket");

    const group = await safeCli(["entries", "--help"]);
    expect(group.exitCode).toBe(0);
    expect(group.stdout).toContain("whstats entries");
    expect(group.stdout).toContain("entries list (aliases: ls)");
    expect(group.stdout).toContain("entries add - Add a Redmine time entry");
  });

  test("prints nested help directly and through help command paths", async () => {
    const direct = await safeCli(["entry", "ls", "-h"]);
    const helpCommand = await safeCli(["help", "entries", "list"]);

    for (const result of [direct, helpCommand]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("whstats entries list");
      expect(result.stdout).toContain("--from <date>");
      expect(result.stdout).not.toContain("--dry-run");
    }
  });

  test("prints root help through the help command", async () => {
    const result = await safeCli(["help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Run `whstats help <command>`");
  });

  test("prints one clean version line for flags and command", async () => {
    for (const args of [["-v"], ["--version"], ["version"]]) {
      const result = await safeCli(args);
      expect(result).toEqual({ stdout: "whstats v2.0.0\n", stderr: "", exitCode: 0 });
    }
  });
});

describe("spawned errors stay on stderr", () => {
  test("reports unknown command, nested command, and option", async () => {
    const cases: Array<[string[], string]> = [
      [["unknown"], "Unknown command: unknown"],
      [["entries", "unknown"], "Unknown subcommand for entries: unknown"],
      [["config", "path", "--output", "json"], "Unknown option: --output"],
    ];
    for (const [args, message] of cases) {
      const result = await safeCli(args);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`Error: ${message}`);
    }
  });

  test("all old flags fail explicitly", async () => {
    const flags = [
      "--week",
      "--month",
      "--year",
      "--year-to-date",
      "--brief",
      "--json",
      "--config",
      "--setup",
      "--show-config",
      "--reset",
    ];
    const results = await Promise.all(flags.map((flag) => safeCli([flag])));
    for (let index = 0; index < flags.length; index += 1) {
      expect(results[index]!.exitCode).toBe(1);
      expect(results[index]!.stdout).toBe("");
      expect(results[index]!.stderr).toContain(`Unknown option: ${flags[index]}`);
    }
  });
});

test("config path is one clean line and does not read or alter config", async () => {
  const env = environment();
  const configDirectory = join(env.home, ".config", "whstats");
  const configPath = join(configDirectory, "config.json");
  const sentinel = "not valid json\nsecret sentinel\n";
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(configPath, sentinel);

  const result = await runCli(["config", "path"], env);

  expect(result).toEqual({ stdout: `${configPath}\n`, stderr: "", exitCode: 0 });
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(readFileSync(configPath, "utf8")).toBe(sentinel);
});

test("placeholder entry writes return not-implemented and make no HTTP request", async () => {
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      requestCount += 1;
      return new Response("blocked", { status: 500 });
    },
  });
  const env = environment();
  env.env.NO_PROXY = "127.0.0.1,localhost";
  const configDirectory = join(env.home, ".config", "whstats");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(
    join(configDirectory, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      redmine: {
        url: `http://127.0.0.1:${server.port}`,
        apiKey: "offline-api-key",
      },
      presence: {
        server: "127.0.0.1",
        database: "offline",
        user: "offline",
        password: "offline-password",
        userId: 70001,
        timeZone: "Europe/Berlin",
      },
      report: {
        targetHoursPerDay: 8,
        excusedIssueIds: [],
      },
    }),
  );

  try {
    const add = await runCli(
      [
        "entries",
        "add",
        "--date",
        "2026-08-26",
        "--issue",
        "43135",
        "--hours",
        "2.5",
        "--comment",
        "Offline test",
      ],
      env,
    );
    const edit = await runCli(["entries", "edit", "123456", "--hours", "1.5"], env);

    expect(add.exitCode).toBe(1);
    expect(add.stdout).toBe("");
    expect(add.stderr).toContain("entries add is not implemented yet.");
    expect(edit.exitCode).toBe(1);
    expect(edit.stdout).toBe("");
    expect(edit.stderr).toContain("entries edit is not implemented yet.");
    expect(requestCount).toBe(0);
  } finally {
    server.stop(true);
  }
});
