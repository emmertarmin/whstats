import { describe, expect, test } from "bun:test";
import { loadFixture } from "./helpers/fixtures.js";

interface PresenceEvent {
  event_time: string;
  clock: number;
}

interface BasicPresenceFixture {
  range: { from: string; to: string };
  events: PresenceEvent[];
}

interface BoundaryPresenceFixture {
  cases: Array<{
    name: string;
    range: { from: string; to: string };
    serverNow: string;
    events: PresenceEvent[];
  }>;
}

describe("offline fixture baseline", () => {
  test("loads basic presence events", async () => {
    const fixture = await loadFixture<BasicPresenceFixture>("presence/events-basic.json");

    expect(fixture.range).toEqual({ from: "2026-08-24", to: "2026-08-25" });
    expect(fixture.events).toHaveLength(9);
    expect(fixture.events.every((event) => event.clock === 0 || event.clock === 1)).toBe(true);
  });

  test("loads named boundary event cases", async () => {
    const fixture = await loadFixture<BoundaryPresenceFixture>("presence/events-boundaries.json");

    expect(fixture.cases.map((fixtureCase) => fixtureCase.name)).toEqual([
      "state carried from before range",
      "session crosses midnight with exact midnight stop",
      "historical unmatched start",
      "range ends while active",
    ]);
  });

  test("rejects paths outside the fixture directory", async () => {
    await expect(loadFixture("../package.json")).rejects.toThrow("outside the fixture directory");
  });
});
