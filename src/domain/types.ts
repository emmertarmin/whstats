export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface ReportTimeEntry {
  readonly id: number;
  readonly issueId: number | null;
  readonly projectId: number;
  readonly projectName: string;
  readonly activityId: number;
  readonly activityName: string;
  readonly hours: number;
  readonly comment: string;
  readonly excused: boolean;
}

export interface ReportDayAnomaly {
  readonly kind: "missing-presence" | "mixed-excused";
  readonly message: string;
}

export interface ReportDay {
  readonly date: string;
  readonly active: boolean;
  readonly excused: boolean;
  readonly mixed: boolean;
  readonly inProgress: boolean;
  readonly targetHours: number;
  readonly bookedHours: number;
  readonly presenceHours: number;
  readonly excusedHours: number;
  readonly bookingCoverageRatio: number | null;
  readonly bookingGapHours: number;
  readonly anomalies: readonly ReportDayAnomaly[];
  readonly timeEntries: readonly ReportTimeEntry[];
  readonly presenceSessions: readonly import("../presence/types.js").PresenceSession[];
  readonly presenceAnomalies: readonly import("../presence/types.js").PresenceAnomaly[];
}

export interface ReportSummary {
  readonly activeDays: number;
  readonly completedActiveDays: number;
  readonly excusedDays: number;
  readonly targetHours: number;
  readonly bookedHours: number;
  readonly presenceHours: number;
  readonly bookingCoverageRatio: number | null;
  readonly bookingGapHours: number;
  readonly bookingBalanceHours: number;
  readonly bookedVsTargetHours: number;
  readonly presenceVsTargetHours: number;
  readonly largestBookingGap: { readonly date: string; readonly hours: number } | null;
  readonly locationHours?: {
    readonly office: number;
    readonly home: number;
    readonly remote: number;
    readonly na: number;
  };
}

export interface Report {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly range: DateRange & { readonly preset?: string };
  readonly targetHoursPerDay: number;
  readonly days: readonly ReportDay[];
  readonly summary: ReportSummary;
  readonly sourceAnomalies: readonly import("../presence/types.js").PresenceAnomaly[];
}
