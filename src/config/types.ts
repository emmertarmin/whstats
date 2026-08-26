export interface Config {
  schemaVersion: 1;
  redmine: RedmineConfig;
  presence: PresenceConfig;
  report: ReportConfig;
}

export interface RedmineConfig {
  url: string;
  apiKey: string;
}

export interface PresenceConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  userId: number;
  timeZone: string;
}

export interface ReportConfig {
  targetHoursPerDay: number;
  excusedIssueIds: number[];
}
