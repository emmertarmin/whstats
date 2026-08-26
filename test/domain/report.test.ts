import { describe, expect, test } from "bun:test";
import { buildReport } from "../../src/domain/report.js";
import type { BuildReportInput } from "../../src/domain/report.js";
import type { TimeEntry } from "../../src/redmine/gateway.js";
import type { PresenceResult } from "../../src/presence/types.js";

function makeEntry(overrides: Partial<TimeEntry> & { spent_on: string; hours: number }): TimeEntry {
  return {
    id: 1,
    project: { id: 1, name: "Project" },
    user: { id: 1, name: "User" },
    activity: { id: 9, name: "Development" },
    comments: "",
    created_on: "2026-01-01T00:00:00Z",
    updated_on: "2026-01-01T00:00:00Z",
    ...overrides,
  } as TimeEntry;
}

function makePresence(
  days: Array<{
    date: string;
    hours: number;
    inProgress?: boolean;
    sessions?: PresenceResult["days"][number]["sessions"];
    anomalies?: PresenceResult["days"][number]["anomalies"];
  }>,
  options: { running?: boolean; serverNow?: string } = {},
): PresenceResult {
  return {
    days: days.map((day) => ({
      date: day.date,
      hours: day.hours,
      inProgress: day.inProgress ?? false,
      sessions:
        day.sessions ??
        (day.hours > 0
          ? [
              {
                startedAt: `${day.date}T08:00:00.000`,
                endedAt: `${day.date}T${String(8 + Math.floor(day.hours)).padStart(2, "0")}:${String((day.hours % 1) * 60).padStart(2, "0")}:00.000`,
                startInstant: `${day.date}T06:00:00.000Z`,
                endInstant: `${day.date}T14:00:00.000Z`,
                runningAtNow: false,
                inferredEnd: false,
              },
            ]
          : []),
      anomalies: day.anomalies ?? [],
    })),
    serverNow: options.serverNow ?? "2026-08-26T12:00:00.000",
    currentDate: "2026-08-26",
    running: options.running ?? false,
    anomalies: [],
  };
}

function baseInput(overrides: Partial<BuildReportInput> = {}): BuildReportInput {
  return {
    range: { from: "2026-08-24", to: "2026-08-26" },
    targetHoursPerDay: 8,
    excusedIssueIds: new Set([90001]),
    timeEntries: [],
    presence: makePresence([]),
    ...overrides,
  };
}

describe("domain report builder", () => {
  test("returns schema version 1 and generatedAt", () => {
    const report = buildReport(baseInput());
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("presence-only date is active with full target", () => {
    const report = buildReport(
      baseInput({
        presence: makePresence([{ date: "2026-08-24", hours: 8 }]),
      }),
    );

    expect(report.days).toHaveLength(1);
    expect(report.days[0]).toMatchObject({
      date: "2026-08-24",
      active: true,
      excused: false,
      targetHours: 8,
      bookedHours: 0,
      presenceHours: 8,
      bookingGapHours: 8,
      bookingCoverageRatio: 0,
    });
  });

  test("booking-only date is active and gets missing-presence anomaly", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 5, issue: { id: 41001 } })],
      }),
    );

    expect(report.days[0]).toMatchObject({
      active: true,
      bookedHours: 5,
      presenceHours: 0,
      bookingGapHours: 0,
      bookingCoverageRatio: null,
    });
    expect(report.days[0]?.anomalies.map((a) => a.kind)).toContain("missing-presence");
  });

  test("normal matching day has coverage and no anomalies", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 8, issue: { id: 41001 } })],
        presence: makePresence([{ date: "2026-08-24", hours: 8 }]),
      }),
    );

    expect(report.days[0]).toMatchObject({
      active: true,
      bookedHours: 8,
      presenceHours: 8,
      bookingGapHours: 0,
      bookingCoverageRatio: 1,
      anomalies: [],
    });
  });

  test("excused-only day is excused with zero target", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 8, issue: { id: 90001 } })],
      }),
    );

    expect(report.days[0]).toMatchObject({
      active: false,
      excused: true,
      targetHours: 0,
      bookedHours: 0,
      excusedHours: 8,
      anomalies: [],
    });
  });

  test("mixed excused and normal day is active and mixed", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [
          makeEntry({ spent_on: "2026-08-24", hours: 4, issue: { id: 90001 } }),
          makeEntry({ spent_on: "2026-08-24", hours: 3, issue: { id: 41001 } }),
        ],
        presence: makePresence([{ date: "2026-08-24", hours: 8 }]),
      }),
    );

    expect(report.days[0]).toMatchObject({
      active: true,
      mixed: true,
      bookedHours: 3,
      excusedHours: 4,
      presenceHours: 8,
    });
    expect(report.days[0]?.anomalies.map((a) => a.kind)).toContain("mixed-excused");
  });

  test("weekend presence counts as active", () => {
    const report = buildReport(
      baseInput({
        range: { from: "2026-08-22", to: "2026-08-22" },
        presence: makePresence([{ date: "2026-08-22", hours: 6 }]),
      }),
    );

    expect(report.days[0]).toMatchObject({
      active: true,
      targetHours: 8,
      presenceHours: 6,
    });
  });

  test("unobserved dates are omitted", () => {
    const report = buildReport(
      baseInput({
        range: { from: "2026-08-20", to: "2026-08-26" },
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 4, issue: { id: 41001 } })],
        presence: makePresence([{ date: "2026-08-24", hours: 8 }]),
      }),
    );

    expect(report.days.map((d) => d.date)).toEqual(["2026-08-24"]);
  });

  test("anomaly-only observed dates are available", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 5, issue: { id: 41001 } })],
      }),
    );

    expect(report.days).toHaveLength(1);
    expect(report.days[0]?.anomalies).toHaveLength(1);
  });

  test("in-progress day is shown but excluded from completed summary", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-26", hours: 2, issue: { id: 41001 } })],
        presence: makePresence([
          { date: "2026-08-24", hours: 8 },
          { date: "2026-08-25", hours: 8 },
          { date: "2026-08-26", hours: 2, inProgress: true },
        ]),
      }),
    );

    const inProgressDay = report.days.find((d) => d.date === "2026-08-26");
    expect(inProgressDay?.inProgress).toBe(true);
    expect(report.summary.completedActiveDays).toBe(2);
    expect(report.summary.activeDays).toBe(3);
  });

  test("weighted coverage is total booked / total presence", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [
          makeEntry({ spent_on: "2026-08-24", hours: 4, issue: { id: 41001 } }),
          makeEntry({ spent_on: "2026-08-25", hours: 8, issue: { id: 41001 } }),
        ],
        presence: makePresence([
          { date: "2026-08-24", hours: 8 },
          { date: "2026-08-25", hours: 4 },
        ]),
      }),
    );

    expect(report.summary.bookedHours).toBe(12);
    expect(report.summary.presenceHours).toBe(12);
    expect(report.summary.bookingCoverageRatio).toBe(1);
  });

  test("coverage can exceed 100% when overbooked", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 10, issue: { id: 41001 } })],
        presence: makePresence([{ date: "2026-08-24", hours: 8 }]),
      }),
    );

    expect(report.days[0]?.bookingCoverageRatio).toBe(1.25);
    expect(report.summary.bookingCoverageRatio).toBe(1.25);
    expect(report.summary.bookingBalanceHours).toBe(2);
  });

  test("zero-presence coverage is null", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 5, issue: { id: 41001 } })],
      }),
    );

    expect(report.days[0]?.bookingCoverageRatio).toBeNull();
    expect(report.summary.bookingCoverageRatio).toBeNull();
  });

  test("largest booking gap is tracked", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [
          makeEntry({ spent_on: "2026-08-24", hours: 2, issue: { id: 41001 } }),
          makeEntry({ spent_on: "2026-08-25", hours: 6, issue: { id: 41001 } }),
        ],
        presence: makePresence([
          { date: "2026-08-24", hours: 8 },
          { date: "2026-08-25", hours: 8 },
        ]),
      }),
    );

    expect(report.summary.largestBookingGap).toEqual({
      date: "2026-08-24",
      hours: 6,
    });
  });

  test("summary uses completed active days only", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [
          makeEntry({ spent_on: "2026-08-24", hours: 8, issue: { id: 41001 } }),
          makeEntry({ spent_on: "2026-08-25", hours: 4, issue: { id: 41001 } }),
        ],
        presence: makePresence([
          { date: "2026-08-24", hours: 8 },
          { date: "2026-08-25", hours: 8 },
        ]),
      }),
    );

    expect(report.summary.completedActiveDays).toBe(2);
    expect(report.summary.targetHours).toBe(16);
    expect(report.summary.bookedHours).toBe(12);
    expect(report.summary.presenceHours).toBe(16);
    expect(report.summary.bookingGapHours).toBe(4);
  });

  test("entry without issue is not excused", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [makeEntry({ spent_on: "2026-08-24", hours: 4 })],
        presence: makePresence([{ date: "2026-08-24", hours: 8 }]),
      }),
    );

    expect(report.days[0]?.bookedHours).toBe(4);
    expect(report.days[0]?.excusedHours).toBe(0);
  });

  test("preserves time-entry details needed by later output", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [
          makeEntry({
            id: 123456,
            spent_on: "2026-08-24",
            hours: 3,
            issue: { id: 43135 },
            project: { id: 10, name: "Example" },
            activity: { id: 9, name: "Development" },
            comments: "Implementation",
          }),
        ],
      }),
    );

    const entry = report.days[0]?.timeEntries[0];
    expect(entry).toMatchObject({
      id: 123456,
      issueId: 43135,
      projectId: 10,
      projectName: "Example",
      activityId: 9,
      activityName: "Development",
      hours: 3,
      comment: "Implementation",
      excused: false,
    });
  });

  test("presence sessions and anomalies are preserved on days", () => {
    const report = buildReport(
      baseInput({
        presence: {
          days: [
            {
              date: "2026-08-24",
              hours: 8,
              inProgress: false,
              sessions: [
                {
                  startedAt: "2026-08-24T08:00:00.000",
                  endedAt: "2026-08-24T16:00:00.000",
                  startInstant: "2026-08-24T06:00:00.000Z",
                  endInstant: "2026-08-24T14:00:00.000Z",
                  runningAtNow: false,
                  inferredEnd: false,
                },
              ],
              anomalies: [
                { kind: "duplicate-start", at: "2026-08-24T08:00:00.000", message: "Dup" },
              ],
            },
          ],
          serverNow: "2026-08-24T12:00:00.000",
          currentDate: "2026-08-24",
          running: false,
          anomalies: [{ kind: "orphan-stop", at: "2026-08-24T07:00:00.000", message: "Orphan" }],
        },
      }),
    );

    expect(report.days[0]?.presenceSessions).toHaveLength(1);
    expect(report.days[0]?.presenceAnomalies).toHaveLength(1);
    expect(report.days[0]?.presenceAnomalies[0]?.kind).toBe("duplicate-start");
    expect(report.sourceAnomalies[0]?.kind).toBe("orphan-stop");
  });

  test("days are sorted by date", () => {
    const report = buildReport(
      baseInput({
        timeEntries: [
          makeEntry({ spent_on: "2026-08-26", hours: 1, issue: { id: 41001 } }),
          makeEntry({ spent_on: "2026-08-24", hours: 1, issue: { id: 41001 } }),
        ],
        presence: makePresence([
          { date: "2026-08-25", hours: 8 },
          { date: "2026-08-24", hours: 8 },
          { date: "2026-08-26", hours: 8 },
        ]),
      }),
    );

    expect(report.days.map((d) => d.date)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26"]);
  });

  test("empty report has zero summary", () => {
    const report = buildReport(baseInput());

    expect(report.days).toHaveLength(0);
    expect(report.summary).toMatchObject({
      activeDays: 0,
      completedActiveDays: 0,
      excusedDays: 0,
      targetHours: 0,
      bookedHours: 0,
      presenceHours: 0,
      bookingCoverageRatio: null,
      bookingGapHours: 0,
      largestBookingGap: null,
    });
  });
});
