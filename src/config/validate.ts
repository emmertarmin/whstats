import type { Config } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(object: Record<string, unknown>, key: string, path: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid config: ${path} must be a non-empty string.`);
  }
  return value.trim();
}

function requirePositiveNumber(object: Record<string, unknown>, key: string, path: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid config: ${path} must be a positive number.`);
  }
  return value;
}

function requirePositiveInteger(
  object: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = object[key];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Invalid config: ${path} must be a positive integer.`);
  }
  return value as number;
}

function requireObject(
  object: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  const value = object[key];
  if (!isRecord(value)) {
    throw new Error(`Invalid config: ${path} must be an object.`);
  }
  return value;
}

function optionalPositiveNumber(
  object: Record<string, unknown>,
  key: string,
  path: string,
  defaultValue: number,
): number {
  return object[key] === undefined ? defaultValue : requirePositiveNumber(object, key, path);
}

function optionalPositiveIntegerArray(
  object: Record<string, unknown>,
  key: string,
  defaultValue: number[],
): number[] {
  return object[key] === undefined ? defaultValue : validateExcusedIssueIds(object[key]);
}

function migrateLegacyConfig(input: Record<string, unknown>): Config {
  const userId = Number(requireString(input, "slackUserId", "slackUserId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid config: slackUserId must be a positive integer string.");
  }

  return validateConfig({
    schemaVersion: 1,
    redmine: {
      url: requireString(input, "redmineUrl", "redmineUrl"),
      apiKey: requireString(input, "redmineApiKey", "redmineApiKey"),
    },
    presence: {
      server: requireString(input, "mssqlServer", "mssqlServer"),
      database: requireString(input, "mssqlDatabase", "mssqlDatabase"),
      user: requireString(input, "mssqlUser", "mssqlUser"),
      password: requireString(input, "mssqlPassword", "mssqlPassword"),
      userId,
      timeZone: "Europe/Berlin",
    },
    report: {
      targetHoursPerDay: optionalPositiveNumber(input, "targetHoursPerDay", "targetHoursPerDay", 8),
      excusedIssueIds: optionalPositiveIntegerArray(input, "ignoredRedmineTicketIds", []),
    },
  });
}

export function normalizeRedmineUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid config: redmine.url must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid config: redmine.url must use http or https.");
  }

  return value.trim().replace(/\/+$/, "");
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validateExcusedIssueIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid config: report.excusedIssueIds must be an array.");
  }

  const seen = new Set<number>();
  const ids: number[] = [];
  for (const item of value) {
    if (!Number.isInteger(item) || item <= 0) {
      throw new Error(
        "Invalid config: report.excusedIssueIds must contain only positive integers.",
      );
    }
    if (seen.has(item)) {
      throw new Error("Invalid config: report.excusedIssueIds must contain unique IDs.");
    }
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

export function validateConfig(input: unknown): Config {
  if (!isRecord(input)) {
    throw new Error("Invalid config: root must be an object.");
  }

  if (input.schemaVersion === undefined) {
    return migrateLegacyConfig(input);
  }

  if (input.schemaVersion !== 1) {
    throw new Error("Invalid config: schemaVersion must be 1.");
  }

  const redmine = requireObject(input, "redmine", "redmine");
  const presence = requireObject(input, "presence", "presence");
  const report = requireObject(input, "report", "report");

  const timeZone = requireString(presence, "timeZone", "presence.timeZone");
  if (!isValidTimeZone(timeZone)) {
    throw new Error("Invalid config: presence.timeZone must be a valid IANA time zone.");
  }

  return {
    schemaVersion: 1,
    redmine: {
      url: normalizeRedmineUrl(requireString(redmine, "url", "redmine.url")),
      apiKey: requireString(redmine, "apiKey", "redmine.apiKey"),
    },
    presence: {
      server: requireString(presence, "server", "presence.server"),
      database: requireString(presence, "database", "presence.database"),
      user: requireString(presence, "user", "presence.user"),
      password: requireString(presence, "password", "presence.password"),
      userId: requirePositiveInteger(presence, "userId", "presence.userId"),
      timeZone,
    },
    report: {
      targetHoursPerDay: requirePositiveNumber(
        report,
        "targetHoursPerDay",
        "report.targetHoursPerDay",
      ),
      excusedIssueIds: validateExcusedIssueIds(report.excusedIssueIds),
    },
  };
}
