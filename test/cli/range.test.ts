import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { parseCli } from "../../src/cli/parse.js";
import { resolveRange, type ResolvedRange } from "../../src/commands/report.js";

function range(args: string[]): ResolvedRange {
  const parsed = parseCli(["report", ...args]);
  return resolveRange(parsed.values, parsed.positionals);
}

function rangeError(args: string[]): string {
  try {
    range(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected range to fail: ${args.join(" ")}`);
}

async function rangeInTimeZone(now: string, preset: string): Promise<ResolvedRange> {
  const script = `
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length === 0 ? [${JSON.stringify(now)}] : args));
      }
      static now() { return new RealDate(${JSON.stringify(now)}).getTime(); }
    };
    const { resolveRange } = await import("./src/commands/report.ts");
    console.log(JSON.stringify(resolveRange({}, [${JSON.stringify(preset)}])));
  `;
  const processHandle = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    cwd: process.cwd(),
    env: { ...process.env, TZ: "Europe/Berlin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout) as ResolvedRange;
}

function inclusiveCalendarDates(value: ResolvedRange): string[] {
  const result: string[] = [];
  const cursor = new Date(`${value.from}T12:00:00`);
  const end = new Date(`${value.to}T12:00:00`);
  while (cursor <= end) {
    result.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

afterEach(() => {
  setSystemTime();
});

describe("range presets", () => {
  test("recent has exactly 14 inclusive local calendar dates", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    const result = range(["recent"]);
    expect(result).toEqual({ from: "2026-08-13", to: "2026-08-26", preset: "recent" });
    expect(inclusiveCalendarDates(result)).toHaveLength(14);
  });

  test("week starts on Monday", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    expect(range(["week"])).toEqual({
      from: "2026-08-24",
      to: "2026-08-26",
      preset: "week",
    });
  });

  test("month and ytd use calendar boundaries", () => {
    setSystemTime(new Date(2026, 0, 2, 12));
    expect(range(["month"])).toEqual({
      from: "2026-01-01",
      to: "2026-01-02",
      preset: "month",
    });
    expect(range(["ytd"])).toEqual({
      from: "2026-01-01",
      to: "2026-01-02",
      preset: "ytd",
    });
  });

  test("rolling-year has exactly 365 inclusive dates", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    const result = range(["rolling-year"]);
    expect(result).toEqual({
      from: "2025-08-27",
      to: "2026-08-26",
      preset: "rolling-year",
    });
    expect(inclusiveCalendarDates(result)).toHaveLength(365);
  });

  test("handles leap-day and month boundaries", () => {
    setSystemTime(new Date(2024, 2, 1, 12));
    expect(range(["recent"])).toEqual({
      from: "2024-02-17",
      to: "2024-03-01",
      preset: "recent",
    });

    setSystemTime(new Date(2024, 1, 29, 12));
    expect(range(["month"])).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
      preset: "month",
    });
  });

  test("uses DST-safe local calendar arithmetic", async () => {
    const spring = await rangeInTimeZone("2024-03-31T10:00:00.000Z", "recent");
    expect(spring.from).toBe("2024-03-18");
    expect(spring.to).toBe("2024-03-31");
    expect(inclusiveCalendarDates(spring)).toHaveLength(14);

    const autumn = await rangeInTimeZone("2024-10-27T11:00:00.000Z", "recent");
    expect(autumn.from).toBe("2024-10-14");
    expect(autumn.to).toBe("2024-10-27");
    expect(inclusiveCalendarDates(autumn)).toHaveLength(14);
  });
});

describe("explicit ranges", () => {
  test("keeps explicit ends inclusive", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    const result = range(["--from", "2026-08-01", "--to=2026-08-03"]);
    expect(result).toEqual({ from: "2026-08-01", to: "2026-08-03" });
    expect(inclusiveCalendarDates(result)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  test("uses today for a from-only range", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    expect(range(["--from", "2026-08-01"])).toEqual({
      from: "2026-08-01",
      to: "2026-08-26",
    });
  });

  test("rejects to-only and preset conflicts", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    expect(rangeError(["--to", "2026-08-20"])).toBe("--to requires --from");
    expect(rangeError(["recent", "--from", "2026-08-01"])).toContain("conflicts with preset");
    expect(rangeError(["month", "--to", "2026-08-20"])).toContain("conflicts with preset");
  });

  test("rejects invalid ISO and calendar dates", () => {
    expect(rangeError(["--from", "2026/08/01"])).toContain("Invalid date");
    expect(rangeError(["--from", "2026-02-29"])).toContain("Invalid date");
    expect(rangeError(["--from", "2024-13-01"])).toContain("Invalid date");
  });

  test("rejects reversed ranges and future end dates", () => {
    setSystemTime(new Date(2026, 7, 26, 12));
    expect(rangeError(["--from", "2026-08-20", "--to", "2026-08-19"])).toBe(
      "--from must be before or equal to --to",
    );
    expect(rangeError(["--from", "2026-08-20", "--to", "2026-08-27"])).toBe(
      "Range end date must not be in the future",
    );
  });
});
