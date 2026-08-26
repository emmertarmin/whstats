import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/cli/parse.js";
import { rootCommand } from "../../src/cli/registry.js";
import { entriesCommand } from "../../src/commands/entries.js";
import { reportCommand } from "../../src/commands/report.js";

function parseError(args: string[]): string {
  try {
    parseCli(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected parsing to fail: ${args.join(" ")}`);
}

describe("default and command resolution", () => {
  test("no arguments parse exactly as report recent without service execution", () => {
    expect(parseCli([])).toEqual(parseCli(["report", "recent"]));
  });

  test("root report flags parse like explicit report flags without service execution", () => {
    expect(parseCli(["--verbose"])).toEqual(parseCli(["report", "recent", "--verbose"]));
    expect(parseCli(["-o", "json"])).toEqual(parseCli(["report", "recent", "-o", "json"]));
  });

  test("an explicit root range does not add the recent preset", () => {
    const implicit = parseCli(["--from", "2026-08-01"]);
    const explicit = parseCli(["report", "--from", "2026-08-01"]);

    expect(implicit).toEqual(explicit);
    expect(implicit.positionals).toEqual([]);
  });

  test("root help and version flags stay at the root", () => {
    for (const flag of ["--help", "-h", "--version", "-v"]) {
      const parsed = parseCli([flag]);
      expect(parsed.command).toBe(rootCommand);
      expect(parsed.path).toEqual([]);
    }
  });

  test("resolves root commands, nested commands, and aliases", () => {
    expect(parseCli(["report", "recent"]).command).toBe(reportCommand);

    const nested = parseCli(["entries", "list", "recent"]);
    expect(nested.path.map((command) => command.name)).toEqual(["entries", "list"]);

    const aliased = parseCli(["entry", "ls", "recent"]);
    expect(aliased.path.map((command) => command.name)).toEqual(["entries", "list"]);
  });

  test("selects an executable group default and leaves a help-only group selected", () => {
    const entries = parseCli(["entries"]);
    expect(entries.command).toBe(entriesCommand);
    expect(entries.command.execute).toBeFunction();

    const config = parseCli(["config"]);
    expect(config.command.name).toBe("config");
    expect(config.command.execute).toBeUndefined();
  });
});

describe("typed and scoped flags", () => {
  test("parses boolean, string, integer, and date values", () => {
    const report = parseCli([
      "report",
      "--verbose",
      "--output",
      "json",
      "--from=2026-08-01",
      "--to",
      "2026-08-31",
    ]);
    expect(report.values).toMatchObject({
      verbose: true,
      output: "json",
      from: "2026-08-01",
      to: "2026-08-31",
    });

    const gaps = parseCli(["gaps", "--limit=15"]);
    expect(gaps.values.limit).toBe(15);

    const add = parseCli(["entries", "add", "--issue", "43135", "--date=2026-08-26"]);
    expect(add.values.issue).toBe(43135);
    expect(add.values.date).toBe("2026-08-26");
  });

  test("supports equals syntax, flag aliases, choices, and defaults", () => {
    expect(parseCli(["report", "--output=markdown"]).values.output).toBe("markdown");
    expect(parseCli(["report", "-o", "json"]).values.output).toBe("json");
    expect(parseCli(["report"]).values.output).toBeUndefined();
    expect(parseCli(["trend"]).values.bucket).toBe("week");
    expect(parseCli(["gaps"]).values.limit).toBe(10);
    expect(parseError(["trend", "--bucket", "quarter"])).toContain("Choices: day, week, month");
  });

  test("does not leak command-scoped flags", () => {
    expect(parseError(["config", "path", "--output", "json"])).toBe("Unknown option: --output");
    expect(parseError(["report", "--bucket", "month"])).toBe("Unknown option: --bucket");
    expect(parseError(["entries", "list", "--dry-run"])).toBe("Unknown option: --dry-run");
  });
});

describe("invalid input", () => {
  test("rejects unknown commands, subcommands, and options", () => {
    expect(parseError(["unknown"])).toBe("Unknown command: unknown");
    expect(parseError(["entries", "unknown"])).toBe("Unknown subcommand for entries: unknown");
    expect(parseError(["report", "--unknown"])).toBe("Unknown option: --unknown");
  });

  test("accepts a negative integer as an option value", () => {
    expect(parseCli(["gaps", "--limit", "-1"]).values.limit).toBe(-1);
  });

  test("rejects missing option values before a known next option", () => {
    expect(parseError(["report", "--from"])).toBe("Missing value for option --from");
    expect(parseError(["gaps", "--limit", "--help"])).toBe("Missing value for option --limit");
  });

  test("validates an unknown hyphen token as the value before a later action", () => {
    expect(parseError(["gaps", "--limit", "--not-an-integer", "--help"])).toBe(
      "Invalid integer for --limit: --not-an-integer",
    );
  });

  test("rejects missing required and unexpected positional arguments", () => {
    expect(parseError(["entries", "edit"])).toBe("Missing required argument: entry-id");
    expect(parseError(["report", "recent", "extra"])).toBe("Unexpected argument: extra");
  });

  test("rejects invalid integer, date, and boolean values", () => {
    expect(parseError(["gaps", "--limit", "1.5"])).toContain("Invalid integer");
    expect(parseError(["entries", "add", "--date", "2026-02-30"])).toContain("Invalid date");
    expect(parseError(["report", "--verbose=true"])).toBe("Option --verbose does not take a value");
  });

  test("rejects all old options and positional command aliases", () => {
    for (const flag of [
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
    ]) {
      expect(parseError([flag])).toBe(`Unknown option: ${flag}`);
    }
    expect(parseError(["week"])).toBe("Unknown command: week");
  });
});
