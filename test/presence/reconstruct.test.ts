import { describe, expect, test } from "bun:test";
import { presenceHoursByDate, reconstructPresence } from "../../src/presence/reconstruct.js";
import type { RawPresenceEvent } from "../../src/presence/types.js";
import { loadFixture } from "../helpers/fixtures.js";

interface FixturePresenceEvent {
  readonly event_time: string;
  readonly clock: 0 | 1;
}

interface BasicPresenceFixture {
  readonly range: { readonly from: string; readonly to: string };
  readonly events: FixturePresenceEvent[];
}

interface BoundaryPresenceFixture {
  readonly cases: Array<{
    readonly name: string;
    readonly range: { readonly from: string; readonly to: string };
    readonly serverNow: string;
    readonly events: FixturePresenceEvent[];
  }>;
}

interface DstPresenceFixture {
  readonly cases: Array<{
    readonly name: string;
    readonly timeZone: string;
    readonly range: { readonly from: string; readonly to: string };
    readonly serverNow: string;
    readonly events: FixturePresenceEvent[];
    readonly expectedHours: Record<string, number>;
  }>;
}

function normalizeEvents(events: readonly FixturePresenceEvent[]): RawPresenceEvent[] {
  return events.map((event) => ({ eventTime: event.event_time, clock: event.clock }));
}

function hoursByDate(result: ReturnType<typeof reconstructPresence>): Record<string, number> {
  return Object.fromEntries(result.days.map((day) => [day.date, day.hours]));
}

describe("presence reconstruction", () => {
  test("ignores redundant starts and stops deterministically", async () => {
    const fixture = await loadFixture<BasicPresenceFixture>("presence/events-basic.json");
    const result = reconstructPresence(
      normalizeEvents(fixture.events),
      fixture.range,
      "Europe/Berlin",
      "2026-08-25T18:00:00",
    );

    expect(hoursByDate(result)).toEqual({
      "2026-08-24": 8.5,
      "2026-08-25": 8,
    });
    expect(result.anomalies.map((item) => item.kind)).toEqual([
      "duplicate-start",
      "duplicate-stop",
      "orphan-stop",
    ]);
    expect(result.running).toBe(false);
  });

  test("uses pre-range state to carry an open session across the boundary", async () => {
    const fixture = await loadFixture<BoundaryPresenceFixture>("presence/events-boundaries.json");
    const fixtureCase = fixture.cases.find(
      (item) => item.name === "state carried from before range",
    )!;
    const result = reconstructPresence(
      normalizeEvents(fixtureCase.events),
      fixtureCase.range,
      "Europe/Berlin",
      fixtureCase.serverNow,
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-24": 1 });
    expect(result.anomalies.map((item) => item.kind)).toContain("boundary-open");
    expect(result.days[0]?.anomalies.map((item) => item.kind)).toContain("boundary-open");
  });

  test("splits at local midnight without adding a zero-length next day", async () => {
    const fixture = await loadFixture<BoundaryPresenceFixture>("presence/events-boundaries.json");
    const fixtureCase = fixture.cases.find(
      (item) => item.name === "session crosses midnight with exact midnight stop",
    )!;
    const result = reconstructPresence(
      normalizeEvents(fixtureCase.events),
      fixtureCase.range,
      "Europe/Berlin",
      fixtureCase.serverNow,
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-24": 2 });
    expect(result.days.map((day) => day.date)).toEqual(["2026-08-24"]);
  });

  test("closes historical unmatched starts at the inclusive range end", async () => {
    const fixture = await loadFixture<BoundaryPresenceFixture>("presence/events-boundaries.json");
    const fixtureCase = fixture.cases.find((item) => item.name === "historical unmatched start")!;
    const result = reconstructPresence(
      normalizeEvents(fixtureCase.events),
      fixtureCase.range,
      "Europe/Berlin",
      fixtureCase.serverNow,
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-22": 15 });
    expect(result.running).toBe(false);
    expect(result.anomalies.map((item) => item.kind)).toContain("inferred-close");
    expect(result.days[0]?.anomalies.map((item) => item.kind)).toContain("inferred-close");
  });

  test("makes running-at-now explicit and closes at SQL Server now", async () => {
    const fixture = await loadFixture<BoundaryPresenceFixture>("presence/events-boundaries.json");
    const fixtureCase = fixture.cases.find((item) => item.name === "range ends while active")!;
    const result = reconstructPresence(
      normalizeEvents(fixtureCase.events),
      fixtureCase.range,
      "Europe/Berlin",
      fixtureCase.serverNow,
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-25": 2.5 });
    expect(result.running).toBe(true);
    expect(result.days[0]?.inProgress).toBe(true);
    expect(result.days[0]?.sessions[0]?.runningAtNow).toBe(true);
  });

  test("splits at local midnight across spring-forward and autumn fall-back", async () => {
    const fixture = await loadFixture<DstPresenceFixture>("presence/events-dst.json");

    for (const fixtureCase of fixture.cases) {
      const result = reconstructPresence(
        normalizeEvents(fixtureCase.events),
        fixtureCase.range,
        fixtureCase.timeZone,
        fixtureCase.serverNow,
      );
      expect(hoursByDate(result)).toEqual(fixtureCase.expectedHours);
    }
  });

  test("interprets naive database timestamps in the configured time zone", () => {
    const events: RawPresenceEvent[] = [
      { eventTime: "2026-03-29T00:00:00", clock: 1 },
      { eventTime: "2026-03-29T04:00:00", clock: 0 },
    ];
    const range = { from: "2026-03-29", to: "2026-03-29" } as const;

    const berlin = reconstructPresence(events, range, "Europe/Berlin", "2026-03-29T12:00:00");
    const utc = reconstructPresence(events, range, "UTC", "2026-03-29T12:00:00");

    expect(hoursByDate(berlin)).toEqual({ "2026-03-29": 3 });
    expect(hoursByDate(utc)).toEqual({ "2026-03-29": 4 });
    expect(berlin.days[0]?.sessions[0]?.startInstant).toBe("2026-03-28T23:00:00.000Z");
    expect(utc.days[0]?.sessions[0]?.startInstant).toBe("2026-03-29T00:00:00.000Z");
  });

  test("caps at the exclusive range end even when a later stop is supplied", () => {
    const result = reconstructPresence(
      [
        { eventTime: "2026-08-23T23:30:00", clock: 1 },
        { eventTime: "2026-08-25T02:00:00", clock: 0 },
      ],
      { from: "2026-08-24", to: "2026-08-24" },
      "Europe/Berlin",
      "2026-08-26T12:00:00",
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-24": 24 });
    expect(result.days[0]?.sessions[0]?.endedAt).toBe("2026-08-25T00:00:00.000");
    expect(result.days[0]?.sessions[0]?.inferredEnd).toBe(true);
    expect(result.anomalies.map((item) => item.kind)).toEqual(["boundary-open", "inferred-close"]);
  });

  test("caps at fixed server now and ignores a stop from the future", () => {
    const result = reconstructPresence(
      [
        { eventTime: "2026-08-25T08:00:00", clock: 1 },
        { eventTime: "2026-08-25T12:00:00", clock: 0 },
      ],
      { from: "2026-08-25", to: "2026-08-25" },
      "Europe/Berlin",
      "2026-08-25T10:00:00",
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-25": 2 });
    expect(result.running).toBe(true);
    expect(result.days[0]?.inProgress).toBe(true);
    expect(result.days[0]?.sessions[0]).toMatchObject({
      endedAt: "2026-08-25T10:00:00.000",
      runningAtNow: true,
      inferredEnd: false,
    });
  });

  test("handles starts and stops exactly at range boundaries", () => {
    const fullDay = reconstructPresence(
      [
        { eventTime: "2026-08-24T00:00:00", clock: 1 },
        { eventTime: "2026-08-25T00:00:00", clock: 0 },
      ],
      { from: "2026-08-24", to: "2026-08-24" },
      "Europe/Berlin",
      "2026-08-26T12:00:00",
    );
    const stopAtStart = reconstructPresence(
      [
        { eventTime: "2026-08-23T22:00:00", clock: 1 },
        { eventTime: "2026-08-24T00:00:00", clock: 0 },
      ],
      { from: "2026-08-24", to: "2026-08-24" },
      "Europe/Berlin",
      "2026-08-26T12:00:00",
    );

    expect(hoursByDate(fullDay)).toEqual({ "2026-08-24": 24 });
    expect(fullDay.days[0]?.sessions[0]?.inferredEnd).toBe(false);
    expect(hoursByDate(stopAtStart)).toEqual({ "2026-08-24": 0 });
    expect(Object.fromEntries(presenceHoursByDate(stopAtStart))).toEqual({});
    expect(stopAtStart.running).toBe(false);
  });

  test("sorts malformed event ordering before reconstruction", () => {
    const result = reconstructPresence(
      [
        { eventTime: "2026-08-24T17:00:00", clock: 0 },
        { eventTime: "2026-08-24T13:00:00", clock: 1 },
        { eventTime: "2026-08-24T12:00:00", clock: 0 },
        { eventTime: "2026-08-24T08:00:00", clock: 1 },
      ],
      { from: "2026-08-24", to: "2026-08-24" },
      "Europe/Berlin",
      "2026-08-25T12:00:00",
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-24": 8 });
    expect(result.days[0]?.sessions).toHaveLength(2);
    expect(result.anomalies).toEqual([]);
  });

  test("uses a deterministic start-before-stop rule for timestamp ties", () => {
    const start: RawPresenceEvent = { eventTime: "2026-08-24T08:00:00", clock: 1 };
    const stop: RawPresenceEvent = { eventTime: "2026-08-24T08:00:00", clock: 0 };
    const reconstruct = (events: readonly RawPresenceEvent[]) =>
      reconstructPresence(
        events,
        { from: "2026-08-24", to: "2026-08-24" },
        "Europe/Berlin",
        "2026-08-24T10:00:00",
      );

    const startFirst = reconstruct([start, stop]);
    const stopFirst = reconstruct([stop, start]);

    expect(stopFirst).toEqual(startFirst);
    expect(startFirst.running).toBe(false);
    expect(hoursByDate(startFirst)).toEqual({});
  });

  test("classifies repeated equal-time transitions deterministically", () => {
    const events: RawPresenceEvent[] = [
      { eventTime: "2026-08-24T08:00:00", clock: 0 },
      { eventTime: "2026-08-24T08:00:00", clock: 1 },
      { eventTime: "2026-08-24T08:00:00", clock: 0 },
      { eventTime: "2026-08-24T08:00:00", clock: 1 },
    ];
    const result = reconstructPresence(
      events,
      { from: "2026-08-24", to: "2026-08-24" },
      "Europe/Berlin",
      "2026-08-24T10:00:00",
    );

    expect(hoursByDate(result)).toEqual({ "2026-08-24": 0 });
    expect(result.running).toBe(false);
    expect(result.days[0]?.sessions).toEqual([]);
    expect(result.anomalies.map((item) => item.kind)).toEqual([
      "duplicate-start",
      "duplicate-stop",
    ]);
    expect(Object.fromEntries(presenceHoursByDate(result))).toEqual({});
  });

  test("does not mutate frozen inputs and returns a detached hours map", () => {
    const events = Object.freeze([
      Object.freeze({ eventTime: "2026-08-24T08:00:00", clock: 1 as const }),
      Object.freeze({ eventTime: "2026-08-24T09:30:00", clock: 0 as const }),
    ]);
    const range = Object.freeze({ from: "2026-08-24", to: "2026-08-24" });

    const result = reconstructPresence(events, range, "Europe/Berlin", "2026-08-25T12:00:00");
    const map = presenceHoursByDate(result);
    map.set("2026-08-24", 99);

    expect(events[0]?.eventTime).toBe("2026-08-24T08:00:00");
    expect(range).toEqual({ from: "2026-08-24", to: "2026-08-24" });
    expect(result.days[0]?.hours).toBe(1.5);
  });

  test("rejects malformed ranges and timestamps", () => {
    expect(() =>
      reconstructPresence([], { from: "2026/08/24", to: "2026-08-24" }, "UTC", "2026-08-24"),
    ).toThrow("range.from must be an ISO date string");
    expect(() =>
      reconstructPresence([], { from: "2026-08-25", to: "2026-08-24" }, "UTC", "2026-08-24"),
    ).toThrow("range.from must be before or equal to range.to");
    expect(() =>
      reconstructPresence(
        [{ eventTime: "not-a-time", clock: 1 }],
        { from: "2026-08-24", to: "2026-08-24" },
        "UTC",
        "2026-08-24T12:00:00",
      ),
    ).toThrow("Invalid presence timestamp");
  });
});
