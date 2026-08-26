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
  });

  test("verbose Markdown adds details without changing the summary", () => {
    const concise = renderReportMarkdown(report);
    const verbose = renderReportMarkdown(report, true);
    expect(verbose).toContain("## Details");
    expect(verbose).toContain("Entry 123 · #43135");
    expect(verbose).toContain("Presence anomaly (duplicate-start");
    expect(verbose).toContain("## Summary");
    expect(concise).not.toContain("## Details");
  });

  test("JSON serializes the same report and verbose is not an input", () => {
    const parsed = JSON.parse(renderReportJson(report)) as Report;
    expect(parsed).toEqual(report);
    expect(parsed.days[0]?.timeEntries[0]?.comment).toBe("Implementation");
    expect(parsed.summary.bookingCoverageRatio).toBe(0.45);
    expect(parsed).not.toHaveProperty("meta");
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
