import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createRedmineGateway, RedmineApiErrorImpl } from "../../src/redmine/gateway.js";
import type { Config } from "../../src/config/types.js";

const config: Config = {
  schemaVersion: 1,
  redmine: { url: "https://redmine.example.test", apiKey: "test-api-key" },
  presence: {
    server: "sql.example.test",
    database: "timelogger",
    user: "test_user",
    password: "test-password",
    userId: 70001,
    timeZone: "Europe/Berlin",
  },
  report: { targetHoursPerDay: 8, excusedIssueIds: [] },
};

interface MockRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

let requests: MockRequest[] = [];
let responseQueue: Array<() => Response> = [];

function queueResponse(response: Response): void {
  responseQueue.push(() => response);
}

function queueJson(body: unknown, status = 200): void {
  responseQueue.push(
    () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  responseQueue = [];
  globalThis.fetch = Object.assign(
    mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      requests.push({
        url: urlStr,
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as string | undefined,
      });
      const handler = responseQueue.shift();
      if (!handler) throw new Error("No mock response queued");
      return handler();
    }),
    { preconnect: originalFetch.preconnect },
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Redmine gateway", () => {
  test("getCurrentUser sends correct headers and parses response", async () => {
    queueJson({
      user: { id: 70001, login: "testuser", firstname: "Test", lastname: "User" },
    });

    const gateway = createRedmineGateway(config);
    const user = await gateway.getCurrentUser();

    expect(user).toEqual({ id: 70001, login: "testuser", firstname: "Test", lastname: "User" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://redmine.example.test/my/account.json");
    expect(requests[0]?.headers["X-Redmine-API-Key"]).toBe("test-api-key");
    expect(requests[0]?.headers["Content-Type"]).toBe("application/json");
  });

  test("listTimeEntries paginates and aggregates results", async () => {
    queueJson({
      time_entries: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        hours: 1,
        spent_on: "2026-08-24",
      })),
      total_count: 250,
      offset: 0,
      limit: 100,
    });
    queueJson({
      time_entries: Array.from({ length: 100 }, (_, i) => ({
        id: i + 101,
        hours: 1,
        spent_on: "2026-08-25",
      })),
      total_count: 250,
      offset: 100,
      limit: 100,
    });
    queueJson({
      time_entries: Array.from({ length: 50 }, (_, i) => ({
        id: i + 201,
        hours: 1,
        spent_on: "2026-08-26",
      })),
      total_count: 250,
      offset: 200,
      limit: 100,
    });

    const gateway = createRedmineGateway(config);
    const entries = await gateway.listTimeEntries(70001, { from: "2026-08-24", to: "2026-08-26" });

    expect(entries).toHaveLength(250);
    expect(entries[0]?.id).toBe(1);
    expect(entries[249]?.id).toBe(250);
    expect(requests).toHaveLength(3);
    expect(requests[0]?.url).toContain("user_id=70001");
    expect(requests[0]?.url).toContain("from=2026-08-24");
    expect(requests[0]?.url).toContain("to=2026-08-26");
    expect(requests[0]?.url).toContain("limit=100");
    expect(requests[0]?.url).toContain("offset=0");
    expect(requests[1]?.url).toContain("offset=100");
    expect(requests[2]?.url).toContain("offset=200");
  });

  test("listTimeEntries stops when fewer entries than limit returned", async () => {
    queueJson({
      time_entries: [{ id: 1, hours: 2, spent_on: "2026-08-24" }],
      total_count: 1,
      offset: 0,
      limit: 100,
    });

    const gateway = createRedmineGateway(config);
    const entries = await gateway.listTimeEntries(70001, { from: "2026-08-24", to: "2026-08-24" });

    expect(entries).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  test("listTimeEntries URL-encodes parameters", async () => {
    queueJson({
      time_entries: [],
      total_count: 0,
      offset: 0,
      limit: 100,
    });

    const gateway = createRedmineGateway(config);
    await gateway.listTimeEntries(70001, { from: "2026-08-24", to: "2026-08-24" });

    const url = requests[0]?.url ?? "";
    expect(url).toContain("from=2026-08-24");
    expect(url).toContain("to=2026-08-24");
    expect(url).not.toContain(" ");
  });

  test("getTimeEntry fetches by ID", async () => {
    queueJson({
      time_entry: {
        id: 123,
        project: { id: 1, name: "Test" },
        user: { id: 1, name: "User" },
        activity: { id: 9, name: "Dev" },
        hours: 2,
        comments: "Work",
        spent_on: "2026-08-24",
        created_on: "2026-08-24T00:00:00Z",
        updated_on: "2026-08-24T00:00:00Z",
      },
    });

    const gateway = createRedmineGateway(config);
    const entry = await gateway.getTimeEntry(123);

    expect(entry.id).toBe(123);
    expect(requests[0]?.url).toBe("https://redmine.example.test/time_entries/123.json");
  });

  test("getIssue fetches by ID", async () => {
    queueJson({
      issue: { id: 43135, subject: "Bug fix", project: { id: 1, name: "Test" } },
    });

    const gateway = createRedmineGateway(config);
    const issue = await gateway.getIssue(43135);

    expect(issue).toEqual({
      id: 43135,
      subject: "Bug fix",
      project: { id: 1, name: "Test" },
    });
  });

  test("listTimeEntryActivities returns activities", async () => {
    queueJson({
      time_entry_activities: [
        { id: 9, name: "Development" },
        { id: 10, name: "Administration" },
      ],
    });

    const gateway = createRedmineGateway(config);
    const activities = await gateway.listTimeEntryActivities();

    expect(activities).toHaveLength(2);
    expect(activities[0]?.name).toBe("Development");
  });

  test("throws RedmineApiErrorImpl on HTTP error with body", async () => {
    queueResponse(
      new Response('{"errors":["Invalid issue_id"]}', {
        status: 422,
        statusText: "Unprocessable Entity",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const gateway = createRedmineGateway(config);
    try {
      await gateway.getCurrentUser();
      throw new Error("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RedmineApiErrorImpl);
      expect(error).toMatchObject({
        status: 422,
        statusText: "Unprocessable Entity",
        body: '{"errors":["Invalid issue_id"]}',
      });
    }
  });

  test("throws RedmineApiErrorImpl on 404", async () => {
    queueResponse(new Response("Not found", { status: 404, statusText: "Not Found" }));

    const gateway = createRedmineGateway(config);
    await expect(gateway.getIssue(99999)).rejects.toMatchObject({
      status: 404,
      statusText: "Not Found",
    });
  });

  test("trailing slashes in base URL are handled", async () => {
    const trailingConfig: Config = {
      ...config,
      redmine: { ...config.redmine, url: "https://redmine.example.test/" },
    };

    queueJson({
      user: { id: 1, login: "test", firstname: "T", lastname: "U" },
    });

    const gateway = createRedmineGateway(trailingConfig);
    await gateway.getCurrentUser();

    expect(requests[0]?.url).toBe("https://redmine.example.test/my/account.json");
  });

  test("read-only requests never send POST/PUT/DELETE in listTimeEntries", async () => {
    queueJson({
      time_entries: [],
      total_count: 0,
      offset: 0,
      limit: 100,
    });

    const gateway = createRedmineGateway(config);
    await gateway.listTimeEntries(70001, { from: "2026-08-24", to: "2026-08-24" });

    expect(requests[0]?.method).toBe("GET");
  });
});
