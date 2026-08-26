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
  const overflowMarker = bar.overTarget ? "+" : "\u00a0";
  return `${Number(value.toFixed(2))} \`${bar.cells}${overflowMarker}\``;
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
  const gap = day.bookingGapHours > 0 ? Number(day.bookingGapHours.toFixed(2)) : "—";
  const excused = day.excusedHours > 0 ? ` · ${Number(day.excusedHours.toFixed(2))} excused` : "";
  return `| ${day.date}${status(day)} | ${booked}${excused} | ${present} | ${gap} |`;
}

function renderEntry(entry: ReportTimeEntry): string {
  const issue = entry.issueId === null ? "no issue" : `#${entry.issueId}`;
  const comment = entry.comment === "" ? "no comment" : entry.comment.replaceAll("\n", " ");
  const excused = entry.excused ? " · excused" : "";
  return `- Entry ${entry.id} · ${issue} · ${entry.projectName} · ${entry.activityName} · ${hours(entry.hours)}${excused} — ${comment}`;
}

function renderVerboseDay(day: ReportDay): string[] {
  const lines = [`### ${day.date}`];
  for (const entry of day.timeEntries) lines.push(renderEntry(entry));
  if (day.timeEntries.length === 0) lines.push("- No Redmine entries.");
  for (const anomaly of day.anomalies) lines.push(`- Domain anomaly: ${anomaly.message}`);
  for (const anomaly of day.presenceAnomalies) {
    lines.push(`- Presence anomaly (${anomaly.kind}, ${anomaly.at}): ${anomaly.message}`);
  }
  lines.push(
    `- Calculation: target ${hours(day.targetHours)}, booked ${hours(day.bookedHours)}, present ${hours(day.presenceHours)}, balance ${signedHours(day.bookedHours - day.presenceHours)}.`,
  );
  return lines;
}

export function renderReportMarkdown(report: Report, verbose = false): string {
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
    for (const day of report.days) lines.push(...renderVerboseDay(day), "");
    for (const anomaly of report.sourceAnomalies) {
      lines.push(`- Source anomaly (${anomaly.kind}, ${anomaly.at}): ${anomaly.message}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
