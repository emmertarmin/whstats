import type { Report, ReportDay, ReportTimeEntry } from "../domain/types.js";
import { hourBar } from "./bars.js";

function hours(value: number): string {
  return `${Number(value.toFixed(2))}h`;
}

function signedHours(value: number): string {
  if (value === 0) return "0h";
  return `${value > 0 ? "+" : "−"}${hours(Math.abs(value))}`;
}

function dateLabel(value: string, includeYear = false): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", "");
}

function rangeLabel(report: Report): string {
  if (report.range.from === report.range.to) return dateLabel(report.range.from, true);
  return `${dateLabel(report.range.from)}–${dateLabel(report.range.to, true)}`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function metric(value: number, target: number): string {
  const bar = hourBar(value, target);
  return `\`${bar.cells}\`${bar.overTarget ? "+" : ""} ${hours(value)}`;
}

function issueTeaser(entries: readonly ReportTimeEntry[]): string {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.excused) continue;
    const key = entry.issueId === null ? entry.projectName : `#${entry.issueId}`;
    totals.set(key, (totals.get(key) ?? 0) + entry.hours);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return "—";
  const shown = ranked.slice(0, 2).map(([key, total]) => `${key} ${hours(total)}`);
  if (ranked.length > 2) shown.push(`+${ranked.length - 2}`);
  return escapeTable(shown.join(" · "));
}

function status(day: ReportDay): string {
  const labels: string[] = [];
  if (day.inProgress) labels.push("running");
  if (day.excused) labels.push("excused");
  if (day.mixed) labels.push("mixed");
  return labels.length === 0 ? "" : ` · ${labels.join(", ")}`;
}

function renderDayRow(day: ReportDay, target: number): string {
  const booked = metric(day.bookedHours, target);
  const present = metric(day.presenceHours, target);
  const gap = day.bookingGapHours > 0 ? hours(day.bookingGapHours) : "—";
  const excused = day.excusedHours > 0 ? ` · ${hours(day.excusedHours)} excused` : "";
  return `| ${dateLabel(day.date)}${status(day)} | ${booked}${excused} | ${present} | ${gap} | ${issueTeaser(day.timeEntries)} |`;
}

function renderEntry(entry: ReportTimeEntry): string {
  const issue = entry.issueId === null ? "no issue" : `#${entry.issueId}`;
  const comment = entry.comment === "" ? "no comment" : entry.comment.replaceAll("\n", " ");
  const excused = entry.excused ? " · excused" : "";
  return `- Entry ${entry.id} · ${issue} · ${entry.projectName} · ${entry.activityName} · ${hours(entry.hours)}${excused} — ${comment}`;
}

function renderVerboseDay(day: ReportDay): string[] {
  const lines = [`### ${dateLabel(day.date, true)}`];
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
    "| Date | Booked | Present | Booking gap | Issues |",
    "| --- | ---: | ---: | ---: | --- |",
    ...report.days.map((day) => renderDayRow(day, report.targetHoursPerDay)),
    "",
    "## Summary",
    "",
    `- **Completed active days:** ${report.summary.completedActiveDays}`,
    `- **Booked:** ${hours(report.summary.bookedHours)} / ${hours(report.summary.targetHours)} target (${signedHours(report.summary.bookedVsTargetHours)})`,
    `- **Present:** ${hours(report.summary.presenceHours)} / ${hours(report.summary.targetHours)} target (${signedHours(report.summary.presenceVsTargetHours)})`,
    `- **Booking coverage:** ${report.summary.bookingCoverageRatio === null ? "—" : `${Math.round(report.summary.bookingCoverageRatio * 100)}%`} (${hours(report.summary.bookingGapHours)} present but not booked)`,
    `- **Largest booking gap:** ${report.summary.largestBookingGap === null ? "—" : `${dateLabel(report.summary.largestBookingGap.date)}, ${hours(report.summary.largestBookingGap.hours)}`}`,
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
