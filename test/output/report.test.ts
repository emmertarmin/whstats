import { describe, expect, test } from "bun:test";
import type { Report } from "../../src/domain/types.js";
import { renderTerminalMarkdown } from "../../src/output/markdown-terminal.js";
import { renderReportJson } from "../../src/output/report-json.js";
import { renderReportMarkdown } from "../../src/output/report-markdown.js";
import { loadFixtureText } from "../helpers/fixtures.js";

const report: Report = {
  schemaVersion: 1,
  generatedAt: "2026-08-26T12:00:00.000Z",
  range: { from: "2026-08-25", to: "2026-08-26", preset: "recent" },
  targetHoursPerDay: 8,
  days: [
    {
      date: "2026-08-25",
      active: true,
      excused: false,
      mixed: false,
      inProgress: false,
      targetHours: 8,
      bookedHours: 4.5,
      presenceHours: 10,
      excusedHours: 0,
      bookingCoverageRatio: 0.45,
      bookingGapHours: 5.5,
      anomalies: [],
      timeEntries: [
        {
          id: 123,
          issueId: 43135,
          projectId: 10,
          projectName: "Example",
          activityId: 9,
          activityName: "Development",
          hours: 4.5,
          comment: "Implementation",
          excused: false,
        },
      ],
      presenceSessions: [],
      presenceAnomalies: [],
    },
    {
      date: "2026-08-26",
      active: true,
      excused: false,
      mixed: true,
      inProgress: true,
      targetHours: 8,
      bookedHours: 1,
      presenceHours: 2,
      excusedHours: 1,
      bookingCoverageRatio: 0.5,
      bookingGapHours: 1,
      anomalies: [{ kind: "mixed-excused", message: "Mixed excused and normal bookings." }],
      timeEntries: [],
      presenceSessions: [],
      presenceAnomalies: [
        { kind: "duplicate-start", at: "2026-08-26T09:00:00.000", message: "Duplicate." },
      ],
    },
  ],
  summary: {
    activeDays: 2,
    completedActiveDays: 1,
    excusedDays: 0,
    targetHours: 8,
    bookedHours: 4.5,
    presenceHours: 10,
    bookingCoverageRatio: 0.45,
    bookingGapHours: 5.5,
    bookingBalanceHours: -5.5,
    bookedVsTargetHours: -3.5,
    presenceVsTargetHours: 2,
    largestBookingGap: { date: "2026-08-25", hours: 5.5 },
  },
  sourceAnomalies: [],
};

describe("report output", () => {
  test("Markdown matches the concise golden document and contains no ANSI", async () => {
    const expected = await loadFixtureText("output/report.md.txt");
    const markdown = renderReportMarkdown(report);
    expect(markdown).toBe(expected);
    expect(Bun.stripANSI(markdown)).toBe(markdown);
    const renderedBars = [...markdown.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
    expect(renderedBars.every((bar) => Bun.stringWidth(bar) === 8)).toBe(true);
  });

  test("uses unambiguous two-letter weekday abbreviations", () => {
    const thursdayReport: Report = {
      ...report,
      days: [{ ...report.days[0]!, date: "2026-08-27" }],
    };
    expect(renderReportMarkdown(thursdayReport)).toContain("| 2026-08-27 Th |");
  });

  test("rounds booking gaps to quarter hours and subdues them after eight booked hours", () => {
    const gapReport: Report = {
      ...report,
      days: [
        { ...report.days[0]!, bookedHours: 7.5, bookingGapHours: 1.13 },
        { ...report.days[1]!, bookedHours: 8, bookingGapHours: 1.12 },
      ],
    };
    const markdown = renderReportMarkdown(gapReport);
    expect(markdown).toContain("| 1.25 |");
    expect(markdown).toContain("| _1_ |");

    const terminal = renderTerminalMarkdown(markdown, {
      colors: true,
      columns: 100,
      hyperlinks: false,
    });
    expect(terminal).toContain("\x1b[3;38;5;245m1\x1b[23;39m");
  });

  test("verbose Markdown adds details without changing the summary", () => {
    const concise = renderReportMarkdown(report);
    const verbose = renderReportMarkdown(report, true);
    expect(verbose).toContain("## Details");
    expect(verbose).toContain("[123]");
    expect(verbose).toContain("#43135");
    expect(verbose).toContain("Presence anomaly (duplicate-start");
    expect(verbose).toContain("## Summary");
    expect(verbose.startsWith(concise.trimEnd())).toBe(true);
    expect(concise).not.toContain("## Details");
  });

  test("verbose groups entries by project then issue", () => {
    const multiProjectReport: Report = {
      ...report,
      days: [
        {
          ...report.days[0]!,
          timeEntries: [
            {
              id: 100,
              issueId: 41001,
              projectId: 101,
              projectName: "Alpha",
              activityId: 9,
              activityName: "Development",
              hours: 2,
              comment: "Task A",
              excused: false,
            },
            {
              id: 101,
              issueId: 41001,
              projectId: 101,
              projectName: "Alpha",
              activityId: 9,
              activityName: "Development",
              hours: 1,
              comment: "Task B",
              excused: false,
            },
            {
              id: 102,
              issueId: 41002,
              projectId: 102,
              projectName: "Beta",
              activityId: 10,
              activityName: "Administration",
              hours: 3,
              comment: "",
              excused: false,
            },
            {
              id: 103,
              issueId: null,
              projectId: 103,
              projectName: "Internal",
              activityId: 10,
              activityName: "Administration",
              hours: 1.5,
              comment: "Stand-up",
              excused: false,
            },
          ],
        },
      ],
    };
    const verbose = renderReportMarkdown(
      multiProjectReport,
      true,
      new Map([
        [41001, "Team meeting"],
        [41002, "Office administration"],
      ]),
    );
    // Project headings appear as bold list items
    expect(verbose).toContain("- **Alpha**");
    expect(verbose).toContain("- **Beta**");
    expect(verbose).toContain("- **Internal**");
    // Issue headings appear under projects
    expect(verbose).toContain("  - **#41001** · 3h · _Team meeting_");
    expect(verbose).toContain("  - **#41002** · 3h · _Office administration_");
    expect(verbose).toContain("  - _(no issue)_");
    // Duration leads each compact entry; comments use subdued emphasis.
    expect(verbose).toContain("    - **2h** · Development · [100] · _Task A_");
    expect(verbose).toContain("    - **1h** · Development · [101] · _Task B_");
    expect(verbose).toContain("    - **3h** · Administration · [102]");
    expect(verbose).toContain("    - **1.5h** · Administration · [103] · _Stand-up_");
    // An empty comment does not add a trailing separator.
    expect(verbose).not.toContain("[102] ·");
  });

  test("verbose day charts align and omit the extra calculation line", () => {
    const verbose = renderReportMarkdown(report, true);
    expect(verbose).toContain(
      ["### 2026-08-25 Tu", "- `Booked  4.5h  ████▌   `", "- `Present  10h  ████████`"].join("\n"),
    );
    expect(verbose).not.toContain("**Target:**");
    expect(verbose).not.toContain("**Coverage:**");
    expect(verbose).not.toContain("**Gap:**");
    expect(verbose).not.toContain("**Balance:**");

    const metrics = [...verbose.matchAll(/^- `((?:Booked|Present) +[^`]+)`$/gm)].map(
      (match) => match[1]!,
    );
    expect(metrics).toHaveLength(4);
    const chartStarts = metrics.map((metric) => metric.search(/[█▏▎▍▌▋▊▉]/u));
    expect(new Set(chartStarts).size).toBe(1);
    expect(
      metrics.every((metric, index) => Bun.stringWidth(metric.slice(chartStarts[index]!)) === 8),
    ).toBe(true);
  });

  test("verbose empty day shows no Redmine entries", () => {
    const emptyDayReport: Report = {
      ...report,
      days: [
        {
          ...report.days[0]!,
          timeEntries: [],
        },
      ],
    };
    const verbose = renderReportMarkdown(emptyDayReport, true);
    expect(verbose).toContain("- No Redmine entries.");
  });

  test("verbose Markdown renders its visual hierarchy at a narrow terminal width", () => {
    const markdown = renderReportMarkdown(report, true);
    const terminal = renderTerminalMarkdown(markdown, {
      colors: false,
      columns: 60,
      hyperlinks: false,
    });
    expect(Bun.stripANSI(terminal)).toBe(terminal);
    expect(terminal).toContain("4.5h · Development · [123] · Implementation");
    expect(terminal).toContain("Presence anomaly");

    const colored = renderTerminalMarkdown(markdown, {
      colors: true,
      columns: 60,
      hyperlinks: false,
    });
    expect(Bun.stripANSI(colored)).not.toBe(colored);
    expect(colored).toContain("\x1b[1m4.5h\x1b[22m");
    expect(colored).toContain("\x1b[3;38;5;245mImplementation\x1b[23;39m");
  });

  test("JSON serializes the same report and verbose is not an input", () => {
    const parsed = JSON.parse(renderReportJson(report)) as Report;
    expect(parsed).toEqual(report);
    expect(parsed.days[0]?.timeEntries[0]?.comment).toBe("Implementation");
    expect(parsed.summary.bookingCoverageRatio).toBe(0.45);
    expect(parsed).not.toHaveProperty("meta");
  });

  test("uses optional semantic theme colors for terminal-only styles", () => {
    const terminal = renderTerminalMarkdown(renderReportMarkdown(report), {
      colors: true,
      columns: 100,
      hyperlinks: false,
      theme: {
        accent: "#faa968",
        surface: "#0a2540",
        muted: "#2a6b78",
      },
    });
    expect(terminal).toContain("\x1b[38;2;250;169;104m");
    expect(terminal).toContain("\x1b[48;2;10;37;64m");
    expect(terminal).toContain("\x1b[38;2;42;107;120m");
    expect(terminal).not.toContain("\x1b[38;5;215m");
    expect(terminal).not.toContain("\x1b[48;5;236m");
    expect(terminal).not.toContain("\x1b[38;5;242m");
  });

  test("colorless terminal Markdown has no ANSI and respects a narrow width", () => {
    const terminal = renderTerminalMarkdown(renderReportMarkdown(report), {
      colors: false,
      columns: 60,
      hyperlinks: false,
    });
    expect(Bun.stripANSI(terminal)).toBe(terminal);
    expect(terminal).toContain("Work hours");
  });
});
