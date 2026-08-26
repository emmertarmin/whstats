import type { DateRange } from "../presence/types.js";

export interface TimeEntry {
  readonly id: number;
  readonly project: { readonly id: number; readonly name: string };
  readonly issue?: { readonly id: number };
  readonly user: { readonly id: number; readonly name: string };
  readonly activity: { readonly id: number; readonly name: string };
  readonly hours: number;
  readonly comments: string;
  readonly spent_on: string;
  readonly created_on: string;
  readonly updated_on: string;
}

export interface TimeEntriesResponse {
  readonly time_entries: readonly TimeEntry[];
  readonly total_count: number;
  readonly offset: number;
  readonly limit: number;
}

export interface User {
  readonly id: number;
  readonly login: string;
  readonly firstname: string;
  readonly lastname: string;
}

export interface IssueSummary {
  readonly id: number;
  readonly subject: string;
  readonly project: { readonly id: number; readonly name: string };
}

export interface Activity {
  readonly id: number;
  readonly name: string;
}

/** Read-only Redmine operations available before the Phase 6 mutation work. */
export interface RedmineGateway {
  getCurrentUser(): Promise<User>;
  listTimeEntries(userId: number, range: DateRange): Promise<readonly TimeEntry[]>;
  getTimeEntry(id: number): Promise<TimeEntry>;
  getIssue(id: number): Promise<IssueSummary>;
  listTimeEntryActivities(): Promise<readonly Activity[]>;
}
