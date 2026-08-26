import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Config } from "../../src/config/types.js";

interface InputCall {
  readonly name: string;
  readonly type: unknown;
  readonly value: unknown;
}

const inputCalls: InputCall[] = [];
const queryCalls: string[] = [];
const connectCalls: unknown[] = [];
let closeCalls = 0;
let queryIndex = 0;

interface FakeRequest {
  input(name: string, type: unknown, value: unknown): FakeRequest;
  query(query: string): Promise<{ recordset: unknown[] }>;
}

const fakeRequest: FakeRequest = {
  input(name: string, type: unknown, value: unknown): FakeRequest {
    inputCalls.push({ name, type, value });
    return fakeRequest;
  },
  async query(query: string): Promise<{ recordset: unknown[] }> {
    queryCalls.push(query);
    queryIndex += 1;
    if (queryIndex === 1) {
      return {
        recordset: [
          { event_time: "2026-08-23T23:30:00.000", clock: 1 },
          { event_time: "2026-08-24T01:00:00.000", clock: 0 },
        ],
      };
    }
    return { recordset: [{ server_now: "2026-08-24T12:00:00.000" }] };
  },
};

const fakePool = {
  request(): typeof fakeRequest {
    return fakeRequest;
  },
  async close(): Promise<void> {
    closeCalls += 1;
  },
};

const intType = Symbol("Int");
const dateType = Symbol("Date");
mock.module("mssql", () => ({
  default: {
    Int: intType,
    Date: dateType,
    async connect(config: unknown): Promise<typeof fakePool> {
      connectCalls.push(config);
      return fakePool;
    },
  },
}));

const { listPresence } = await import("../../src/presence/client.js");

const config: Config = {
  schemaVersion: 1,
  redmine: { url: "https://redmine.invalid", apiKey: "not-used" },
  presence: {
    server: "presence.invalid",
    database: "timelogger",
    user: "reader",
    password: "test-secret",
    userId: 42,
    timeZone: "Europe/Berlin",
  },
  report: { targetHoursPerDay: 8, excusedIssueIds: [] },
};

afterEach(() => {
  inputCalls.length = 0;
  queryCalls.length = 0;
  connectCalls.length = 0;
  closeCalls = 0;
  queryIndex = 0;
});

describe("presence MSSQL adapter", () => {
  test("uses bounded parameters, preserves wall-time strings, and closes the pool", async () => {
    const result = await listPresence(config, { from: "2026-08-24", to: "2026-08-24" });

    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0]).toMatchObject({
      server: "presence.invalid",
      database: "timelogger",
      user: "reader",
      options: { useUTC: false },
    });
    expect(inputCalls).toEqual([
      { name: "userId", type: intType, value: 42 },
      { name: "fromDate", type: dateType, value: "2026-08-24" },
      { name: "toDate", type: dateType, value: "2026-08-24" },
    ]);
    expect(queryCalls[0]).toContain("SELECT TOP (1)");
    expect(queryCalls[0]).toContain("ORDER BY [date] DESC, [clock] ASC");
    expect(queryCalls[0]).toContain("[date] < CAST(@fromDate AS datetime)");
    expect(queryCalls[0]).toContain("[date] >= CAST(@fromDate AS datetime)");
    expect(queryCalls[0]).toContain("[date] < DATEADD(day, 1, CAST(@toDate AS datetime))");
    expect(queryCalls[0]).toContain("CONVERT(varchar(27), [date], 126)");
    expect(queryCalls[0]).toContain("ORDER BY event_time ASC, clock DESC");
    expect(queryCalls[1]).toContain("GETDATE()");
    expect(result.serverNow).toBe("2026-08-24T12:00:00.000");
    expect(result.currentDate).toBe("2026-08-24");
    expect(result.days[0]?.hours).toBe(1);
    expect(result.anomalies.map((item) => item.kind)).toContain("boundary-open");
    expect(closeCalls).toBe(1);
  });
});
