import type { Config } from "../config/types.js";
import type { DateRange } from "../presence/types.js";
import type {
  Activity,
  IssueSummary,
  RedmineGateway,
  TimeEntriesResponse,
  TimeEntry,
  User,
} from "./types.js";

export type { Activity, IssueSummary, RedmineGateway, TimeEntry, User } from "./types.js";

export interface RedmineApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body?: string;
}

export class RedmineApiErrorImpl extends Error implements RedmineApiError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "RedmineApiError";
  }
}

function buildUrl(base: string, path: string, params?: Record<string, string | number>): string {
  const url = new URL(path.replace(/^\//, ""), base);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function apiRequest<T>(
  config: Config,
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const response = await fetch(buildUrl(config.redmine.url, path, params), {
    method: "GET",
    headers: {
      "X-Redmine-API-Key": config.redmine.apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throw new RedmineApiErrorImpl(
      `Redmine API error: ${response.status} ${response.statusText}`,
      response.status,
      response.statusText,
      body,
    );
  }

  return (await response.json()) as T;
}

export function createRedmineGateway(config: Config): RedmineGateway {
  return {
    async getCurrentUser(): Promise<User> {
      const data = await apiRequest<{ user: User }>(config, "/my/account.json");
      return data.user;
    },

    async listTimeEntries(userId: number, range: DateRange): Promise<readonly TimeEntry[]> {
      const limit = 100;
      const allEntries: TimeEntry[] = [];
      let offset = 0;

      while (true) {
        const data = await apiRequest<TimeEntriesResponse>(config, "/time_entries.json", {
          user_id: userId,
          from: range.from,
          to: range.to,
          limit,
          offset,
        });
        allEntries.push(...data.time_entries);
        if (data.time_entries.length < limit || allEntries.length >= data.total_count) break;
        offset += limit;
      }

      return allEntries;
    },

    async getTimeEntry(id: number): Promise<TimeEntry> {
      const data = await apiRequest<{ time_entry: TimeEntry }>(config, `/time_entries/${id}.json`);
      return data.time_entry;
    },

    async getIssue(id: number): Promise<IssueSummary> {
      const data = await apiRequest<{ issue: IssueSummary }>(config, `/issues/${id}.json`);
      return data.issue;
    },

    async listTimeEntryActivities(): Promise<readonly Activity[]> {
      const data = await apiRequest<{ time_entry_activities: readonly Activity[] }>(
        config,
        "/enumerations/time_entry_activities.json",
      );
      return data.time_entry_activities ?? [];
    },
  };
}
