import type { Report, ReportDay, ReportTimeEntry } from "../domain/types.js";
import { hourBar } from "./bars.js";

function hours(value: number): string {
  return `${Number(value.toFixed(2))}h`;
}

function signedHours(value: number): string {
  if (value === 0) return "0h";
  return `${value > 0 ? "+" : "−"}${hours(Math.abs(value))}`;
}

function rangeLabel(report: Report): string {
  if (report.range.from === report.range.to) return report.range.from;
  return `${report.range.from}–${report.range.to}`;
}

function metric(value: number, target: number): string {
  const bar = hourBar(value, target);
  return `${Number(value.toFixed(2))} \`${bar.cells}\``;
}

function weekdayAbbreviation(date: string): string {
  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
  return weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

function status(day: ReportDay): string {
  const labels: string[] = [];
  if (day.inProgress) labels.push("R");
  if (day.excused) labels.push("E");
  if (day.mixed) labels.push("M");
  return labels.length === 0 ? "" : ` ${labels.join("")}`;
}

function renderDayRow(day: ReportDay, target: number): string {
  const booked = metric(day.bookedHours, target);
  const present = metric(day.presenceHours, target);
  const roundedGap = Math.round(day.bookingGapHours * 4) / 4;
  const gap = day.bookingGapHours > 0 ? String(roundedGap) : "—";
  const displayedGap = day.bookedHours >= 8 && gap !== "—" ? `_${gap}_` : gap;
  return `| ${day.date} ${weekdayAbbreviation(day.date)}${status(day)} | ${booked} | ${present} | ${displayedGap} |`;
}

interface ProjectEntryGroup {
  readonly name: string;
  readonly issues: Map<number | null, ReportTimeEntry[]>;
}

function groupEntriesByProjectThenIssue(
  entries: readonly ReportTimeEntry[],
): Map<number, ProjectEntryGroup> {
  const grouped = new Map<number, ProjectEntryGroup>();
  for (const entry of entries) {
    let project = grouped.get(entry.projectId);
    if (!project) {
      project = { name: entry.projectName, issues: new Map() };
      grouped.set(entry.projectId, project);
    }
    let issueEntries = project.issues.get(entry.issueId);
    if (!issueEntries) {
      issueEntries = [];
      project.issues.set(entry.issueId, issueEntries);
    }
    issueEntries.push(entry);
  }
  return grouped;
}

function sumEntryHours(entries: readonly ReportTimeEntry[]): number {
  return entries.reduce((total, entry) => total + entry.hours, 0);
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/([`*_\[\]<>])/g, "\\$1");
}

function renderVerboseMetric(
  label: string,
  value: number,
  target: number,
  valueWidth: number,
): string {
  const bar = hourBar(value, target);
  const metric = `${label.padEnd(7)} ${hours(value).padStart(valueWidth)}  ${bar.cells}`;
  return `- \`${metric}\``;
}

function renderVerboseDay(
  day: ReportDay,
  barTarget: number,
  valueWidth: number,
  issueSubjects: ReadonlyMap<number, string>,
): string[] {
  const lines = [
    `### ${day.date} ${weekdayAbbreviation(day.date)}${status(day)}`,
    renderVerboseMetric("Booked", day.bookedHours, barTarget, valueWidth),
    renderVerboseMetric("Present", day.presenceHours, barTarget, valueWidth),
    "",
  ];

  const grouped = groupEntriesByProjectThenIssue(day.timeEntries);
  if (grouped.size === 0) {
    lines.push("- No Redmine entries.");
  } else {
    for (const project of grouped.values()) {
      const projectEntries = [...project.issues.values()].flat();
      lines.push(`- **${escapeMarkdown(project.name)}** · ${hours(sumEntryHours(projectEntries))}`);
      for (const [issueId, entries] of project.issues) {
        const issue = issueId === null ? "_(no issue)_" : `**#${issueId}**`;
        const subject = issueId === null ? undefined : issueSubjects.get(issueId);
        const subjectSuffix = subject === undefined ? "" : ` · _${escapeMarkdown(subject)}_`;
        lines.push(`  - ${issue} · ${hours(sumEntryHours(entries))}${subjectSuffix}`);
        for (const entry of entries) {
          const excused = entry.excused ? " · excused" : "";
          const comment =
            entry.comment === ""
              ? ""
              : ` · _${escapeMarkdown(entry.comment.replaceAll("\n", " "))}_`;
          lines.push(
            `    - **${hours(entry.hours)}** · ${escapeMarkdown(entry.activityName)} · [${entry.id}]${excused}${comment}`,
          );
        }
      }
    }
  }

  for (const anomaly of day.anomalies) {
    lines.push(`- Domain anomaly: ${escapeMarkdown(anomaly.message)}`);
  }
  for (const anomaly of day.presenceAnomalies) {
    lines.push(
      `- Presence anomaly (${anomaly.kind}, ${anomaly.at}): ${escapeMarkdown(anomaly.message)}`,
    );
  }

  return lines;
}

export function renderReportMarkdown(
  report: Report,
  verbose = false,
  issueSubjects: ReadonlyMap<number, string> = new Map(),
): string {
  const lines = [
    `# Work hours · ${rangeLabel(report)}`,
    "",
    "| Date | Booked (h) | Present (h) | Booking gap (h) |",
    "| --- | ---: | ---: | ---: |",
    ...report.days.map((day) => renderDayRow(day, report.targetHoursPerDay)),
    "",
    "## Summary",
    "",
    `- **Completed active days:** ${report.summary.completedActiveDays}`,
    `- **Booked:** ${hours(report.summary.bookedHours)} / ${hours(report.summary.targetHours)} target (${signedHours(report.summary.bookedVsTargetHours)})`,
    `- **Present:** ${hours(report.summary.presenceHours)} / ${hours(report.summary.targetHours)} target (${signedHours(report.summary.presenceVsTargetHours)})`,
    `- **Booking coverage:** ${report.summary.bookingCoverageRatio === null ? "—" : `${Math.round(report.summary.bookingCoverageRatio * 100)}%`} (${hours(report.summary.bookingGapHours)} present but not booked)`,
    `- **Largest booking gap:** ${report.summary.largestBookingGap === null ? "—" : `${report.summary.largestBookingGap.date}, ${hours(report.summary.largestBookingGap.hours)}`}`,
  ];

  if (report.days.some((day) => day.inProgress)) {
    lines.push("", "> An in-progress day is not included in the completed-day summary.");
  }

  if (verbose) {
    lines.push("", "## Details", "");
    const valueWidth = Math.max(
      1,
      ...report.days
        .flatMap((day) => [hours(day.bookedHours), hours(day.presenceHours)])
        .map((value) => value.length),
    );
    for (const day of report.days) {
      lines.push(...renderVerboseDay(day, report.targetHoursPerDay, valueWidth, issueSubjects), "");
    }
    for (const anomaly of report.sourceAnomalies) {
      lines.push(`- Source anomaly (${anomaly.kind}, ${anomaly.at}): ${anomaly.message}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
