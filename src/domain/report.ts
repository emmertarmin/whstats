import type { TimeEntry } from "../redmine/gateway.js";
import type { PresenceResult, PresenceDay } from "../presence/types.js";
import type {
  DateRange,
  Report,
  ReportDay,
  ReportDayAnomaly,
  ReportSummary,
  ReportTimeEntry,
} from "./types.js";

export interface BuildReportInput {
  readonly range: DateRange & { readonly preset?: string };
  readonly targetHoursPerDay: number;
  readonly excusedIssueIds: ReadonlySet<number>;
  readonly timeEntries: readonly TimeEntry[];
  readonly presence: PresenceResult;
}

function isExcused(entry: TimeEntry, excusedIds: ReadonlySet<number>): boolean {
  const issueId = entry.issue?.id;
  return issueId !== undefined && excusedIds.has(issueId);
}

function toReportTimeEntry(entry: TimeEntry, excused: boolean): ReportTimeEntry {
  return {
    id: entry.id,
    issueId: entry.issue?.id ?? null,
    projectId: entry.project.id,
    projectName: entry.project.name,
    activityId: entry.activity.id,
    activityName: entry.activity.name,
    hours: entry.hours,
    comment: entry.comments ?? "",
    excused,
  };
}

function groupEntriesByDate(
  entries: readonly TimeEntry[],
  excusedIds: ReadonlySet<number>,
): Map<string, ReportTimeEntry[]> {
  const grouped = new Map<string, ReportTimeEntry[]>();
  for (const entry of entries) {
    const date = entry.spent_on;
    const excused = isExcused(entry, excusedIds);
    const reportEntry = toReportTimeEntry(entry, excused);
    const list = grouped.get(date);
    if (list) {
      list.push(reportEntry);
    } else {
      grouped.set(date, [reportEntry]);
    }
  }
  return grouped;
}

function buildPresenceDayMap(presence: PresenceResult): Map<string, PresenceDay> {
  return new Map(presence.days.map((day) => [day.date, day]));
}

function buildDayAnomalies(
  entries: readonly ReportTimeEntry[],
  presenceDay: PresenceDay | undefined,
): ReportDayAnomaly[] {
  const anomalies: ReportDayAnomaly[] = [];

  const bookedHours = entries.filter((e) => !e.excused).reduce((s, e) => s + e.hours, 0);
  const presenceHours = presenceDay?.hours ?? 0;

  if (bookedHours > 0 && presenceHours === 0) {
    anomalies.push({
      kind: "missing-presence",
      message: `Booked ${bookedHours}h but no presence recorded.`,
    });
  }

  if (entries.some((e) => e.excused) && entries.some((e) => !e.excused)) {
    anomalies.push({
      kind: "mixed-excused",
      message: "Mixed excused and normal bookings on this day.",
    });
  }

  return anomalies;
}

function buildDay(
  date: string,
  entries: readonly ReportTimeEntry[],
  presenceDay: PresenceDay | undefined,
  targetHoursPerDay: number,
): ReportDay {
  const bookedHours = entries.filter((e) => !e.excused).reduce((s, e) => s + e.hours, 0);
  const excusedHours = entries.filter((e) => e.excused).reduce((s, e) => s + e.hours, 0);
  const presenceHours = presenceDay?.hours ?? 0;
  const inProgress = presenceDay?.inProgress ?? false;

  const hasNormal = bookedHours > 0;
  const hasExcused = excusedHours > 0;
  const hasPresence = presenceHours > 0;

  const active = hasPresence || hasNormal;
  const excused = !active && hasExcused;
  const mixed = active && hasExcused;

  const targetHours = active ? targetHoursPerDay : 0;

  let bookingCoverageRatio: number | null = null;
  if (presenceHours > 0) {
    bookingCoverageRatio = bookedHours / presenceHours;
  }

  const bookingGapHours = Math.max(0, presenceHours - bookedHours);

  const anomalies = buildDayAnomalies(entries, presenceDay);

  return {
    date,
    active,
    excused,
    mixed,
    inProgress,
    targetHours,
    bookedHours,
    presenceHours,
    excusedHours,
    bookingCoverageRatio,
    bookingGapHours,
    anomalies,
    timeEntries: entries,
    presenceSessions: presenceDay?.sessions ?? [],
    presenceAnomalies: presenceDay?.anomalies ?? [],
  };
}

function buildDays(input: BuildReportInput): ReportDay[] {
  const entriesByDate = groupEntriesByDate(input.timeEntries, input.excusedIssueIds);
  const presenceByDate = buildPresenceDayMap(input.presence);

  const allDates = new Set([...entriesByDate.keys(), ...presenceByDate.keys()]);
  const sortedDates = Array.from(allDates).sort();

  return sortedDates.map((date) =>
    buildDay(
      date,
      entriesByDate.get(date) ?? [],
      presenceByDate.get(date),
      input.targetHoursPerDay,
    ),
  );
}

function buildSummary(days: readonly ReportDay[]): ReportSummary {
  const completedDays = days.filter((d) => d.active && !d.inProgress);

  const targetHours = completedDays.reduce((s, d) => s + d.targetHours, 0);
  const bookedHours = completedDays.reduce((s, d) => s + d.bookedHours, 0);
  const presenceHours = completedDays.reduce((s, d) => s + d.presenceHours, 0);

  const bookingCoverageRatio = presenceHours > 0 ? bookedHours / presenceHours : null;
  const bookingGapHours = Math.max(0, presenceHours - bookedHours);
  const bookingBalanceHours = bookedHours - presenceHours;
  const bookedVsTargetHours = bookedHours - targetHours;
  const presenceVsTargetHours = presenceHours - targetHours;

  const locationHours = { office: 0, home: 0, remote: 0, na: 0 };
  for (const day of days) {
    for (const session of day.presenceSessions) {
      const hours = (Date.parse(session.endInstant) - Date.parse(session.startInstant)) / 3_600_000;
      const location = session.location;
      if (location === "office" || location === "home" || location === "remote") {
        locationHours[location] += hours;
      } else {
        locationHours.na += hours;
      }
    }
  }

  let largestBookingGap: { readonly date: string; readonly hours: number } | null = null;
  for (const day of completedDays) {
    if (day.bookingGapHours > (largestBookingGap?.hours ?? 0)) {
      largestBookingGap = { date: day.date, hours: day.bookingGapHours };
    }
  }

  return {
    activeDays: days.filter((d) => d.active).length,
    completedActiveDays: completedDays.length,
    excusedDays: days.filter((d) => d.excused).length,
    targetHours,
    bookedHours,
    presenceHours,
    bookingCoverageRatio,
    bookingGapHours,
    bookingBalanceHours,
    bookedVsTargetHours,
    presenceVsTargetHours,
    largestBookingGap,
    ...(locationHours.office + locationHours.home + locationHours.remote > 0
      ? { locationHours }
      : {}),
  };
}

export function buildReport(input: BuildReportInput): Report {
  const days = buildDays(input);
  const summary = buildSummary(days);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    range: input.range,
    targetHoursPerDay: input.targetHoursPerDay,
    days,
    summary,
    sourceAnomalies: input.presence.anomalies,
  };
}
