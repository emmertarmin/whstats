import type { Config } from "./config.js";

export interface TimeEntry {
  id: number;
  project: { id: number; name: string };
  issue?: { id: number };
  user: { id: number; name: string };
  activity: { id: number; name: string };
  hours: number;
  comments: string;
  spent_on: string;
  created_on: string;
  updated_on: string;
}

export interface TimeEntriesResponse {
  time_entries: TimeEntry[];
  total_count: number;
  offset: number;
  limit: number;
}

export interface User {
  id: number;
  login: string;
  firstname: string;
  lastname: string;
}

export async function fetchCurrentUser(config: Config): Promise<User> {
  const url = `${config.redmineUrl}/my/account.json`;

  const response = await fetch(url, {
    headers: {
      "X-Redmine-API-Key": config.redmineApiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { user: User };
  return data.user;
}

export async function fetchTimeEntries(
  config: Config,
  userId: number,
  from: string,
  to: string
): Promise<TimeEntry[]> {
  const url = `${config.redmineUrl}/time_entries.json?user_id=${userId}&from=${from}&to=${to}&limit=100`;

  const response = await fetch(url, {
    headers: {
      "X-Redmine-API-Key": config.redmineApiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TimeEntriesResponse;
  return data.time_entries;
}
