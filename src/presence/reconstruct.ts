import type {
  DateRange,
  PresenceAnomaly,
  PresenceDay,
  PresenceResult,
  PresenceSession,
  RawPresenceEvent,
} from "./types.js";

interface ZonedInstant {
  readonly wallTime: string;
  readonly instantMs: number;
  readonly instantIso: string;
  readonly clock: 0 | 1;
}

interface SessionInternal {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly runningAtNow: boolean;
  readonly inferredEnd: boolean;
}

const MS_PER_HOUR = 1000 * 60 * 60;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SQL_WALL_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?$/;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function assertDateString(value: string, name: string): void {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${name} must be an ISO date string.`);
  }
}

function parseWallTime(value: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
} {
  const match = SQL_WALL_TIME_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid presence timestamp: ${value}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] === undefined ? 0 : Number(match[4]),
    minute: match[5] === undefined ? 0 : Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
    millisecond: match[7] === undefined ? 0 : Number(match[7].padEnd(3, "0").slice(0, 3)),
  };
}

function toWallTimeString(parts: ReturnType<typeof parseWallTime>): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(parts.millisecond, 3)}`;
}

function getZonedParts(timeZone: string, instantMs: number): ReturnType<typeof parseWallTime> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: new Date(instantMs).getUTCMilliseconds(),
  };
}

function getOffsetMs(timeZone: string, instantMs: number): number {
  const parts = getZonedParts(timeZone, instantMs);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

function wallTimeToInstantMs(value: string, timeZone: string): number {
  const parts = parseWallTime(value);
  const wallUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let instant = wallUtc - getOffsetMs(timeZone, wallUtc);
  for (let index = 0; index < 3; index += 1) {
    const next = wallUtc - getOffsetMs(timeZone, instant);
    if (next === instant) break;
    instant = next;
  }
  return instant;
}

function instantToWallTime(instantMs: number, timeZone: string): string {
  const parts = getZonedParts(timeZone, instantMs);
  return toWallTimeString(parts);
}

function instantToLocalDate(instantMs: number, timeZone: string): string {
  const parts = getZonedParts(timeZone, instantMs);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

function addDays(date: string, days: number): string {
  assertDateString(date, "date");
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function dayStartMs(date: string, timeZone: string): number {
  return wallTimeToInstantMs(`${date}T00:00:00.000`, timeZone);
}

function compareEvent(left: ZonedInstant, right: ZonedInstant): number {
  if (left.instantMs !== right.instantMs) return left.instantMs - right.instantMs;
  const wallTimeOrder = left.wallTime.localeCompare(right.wallTime);
  if (wallTimeOrder !== 0) return wallTimeOrder;
  // SQL event rows have no stable secondary key. Process starts before stops so
  // equal-timestamp input produces the same state regardless of row order.
  return right.clock - left.clock;
}

function anomaly(kind: PresenceAnomaly["kind"], at: string, message: string): PresenceAnomaly {
  return { kind, at, message };
}

function splitSession(
  session: SessionInternal,
  range: DateRange,
  timeZone: string,
): PresenceSession[] {
  const result: PresenceSession[] = [];
  let startMs = session.startMs;
  while (startMs < session.endMs) {
    const day = instantToLocalDate(startMs, timeZone);
    const nextMidnightMs = dayStartMs(addDays(day, 1), timeZone);
    const endMs = Math.min(session.endMs, nextMidnightMs);
    if (day >= range.from && day <= range.to && endMs > startMs) {
      result.push({
        startedAt: instantToWallTime(startMs, timeZone),
        endedAt: instantToWallTime(endMs, timeZone),
        startInstant: new Date(startMs).toISOString(),
        endInstant: new Date(endMs).toISOString(),
        runningAtNow: session.runningAtNow && endMs === session.endMs,
        inferredEnd: session.inferredEnd && endMs === session.endMs,
      });
    }
    startMs = endMs;
  }
  return result;
}

export function reconstructPresence(
  events: readonly RawPresenceEvent[],
  range: DateRange,
  timeZone: string,
  serverNow: string,
): PresenceResult {
  assertDateString(range.from, "range.from");
  assertDateString(range.to, "range.to");
  if (range.from > range.to) throw new Error("range.from must be before or equal to range.to.");

  const rangeStartMs = dayStartMs(range.from, timeZone);
  const rangeEndMs = dayStartMs(addDays(range.to, 1), timeZone);
  const nowMs = wallTimeToInstantMs(serverNow, timeZone);
  const closeLimitMs = Math.min(rangeEndMs, nowMs);
  const currentDate = instantToLocalDate(nowMs, timeZone);

  const normalized = events
    .map((event) => ({
      ...event,
      wallTime: toWallTimeString(parseWallTime(event.eventTime)),
      instantMs: wallTimeToInstantMs(event.eventTime, timeZone),
      instantIso: new Date(wallTimeToInstantMs(event.eventTime, timeZone)).toISOString(),
    }))
    .filter((event) => event.instantMs <= closeLimitMs)
    .sort(compareEvent);

  let activeStart: ZonedInstant | null = null;
  let lastClock: 0 | 1 | null = null;
  let lastStopDate: string | null = null;
  const sessions: SessionInternal[] = [];
  const anomalies: PresenceAnomaly[] = [];

  for (const event of normalized) {
    const isStart = event.clock === 1;
    if (isStart) {
      if (activeStart) {
        anomalies.push(
          anomaly("duplicate-start", event.wallTime, "Duplicate start event ignored."),
        );
      } else {
        activeStart = event;
        if (event.instantMs < rangeStartMs) {
          anomalies.push(
            anomaly("boundary-open", event.wallTime, "Session was already open at range start."),
          );
        }
      }
      lastClock = 1;
      continue;
    }

    if (!activeStart) {
      const eventDate = instantToLocalDate(event.instantMs, timeZone);
      const kind = lastClock === 0 && lastStopDate === eventDate ? "duplicate-stop" : "orphan-stop";
      const message =
        kind === "duplicate-stop"
          ? "Duplicate stop event ignored."
          : "Stop event without an active start ignored.";
      anomalies.push(anomaly(kind, event.wallTime, message));
      lastClock = 0;
      lastStopDate = eventDate;
      continue;
    }

    if (event.instantMs < rangeStartMs) {
      activeStart = null;
      continue;
    }

    const startMs = Math.max(activeStart.instantMs, rangeStartMs);
    const endMs = Math.min(event.instantMs, closeLimitMs);
    if (endMs > startMs) {
      sessions.push({
        startedAt: instantToWallTime(startMs, timeZone),
        endedAt: instantToWallTime(endMs, timeZone),
        startMs,
        endMs,
        runningAtNow: false,
        inferredEnd: false,
      });
    }
    activeStart = null;
    lastClock = 0;
    lastStopDate = instantToLocalDate(event.instantMs, timeZone);
  }

  const running = activeStart !== null && nowMs < rangeEndMs && nowMs <= closeLimitMs;
  if (activeStart && closeLimitMs > Math.max(activeStart.instantMs, rangeStartMs)) {
    const startMs = Math.max(activeStart.instantMs, rangeStartMs);
    sessions.push({
      startedAt: instantToWallTime(startMs, timeZone),
      endedAt: instantToWallTime(closeLimitMs, timeZone),
      startMs,
      endMs: closeLimitMs,
      runningAtNow: running,
      inferredEnd: !running,
    });
    if (!running) {
      anomalies.push(
        anomaly(
          "inferred-close",
          instantToWallTime(closeLimitMs, timeZone),
          "Open session was closed at the range boundary.",
        ),
      );
    }
  }

  const sessionsByDay = new Map<string, PresenceSession[]>();
  for (const session of sessions.flatMap((item) => splitSession(item, range, timeZone))) {
    const day = session.startedAt.slice(0, 10);
    const daySessions = sessionsByDay.get(day) ?? [];
    daySessions.push(session);
    sessionsByDay.set(day, daySessions);
  }

  const anomaliesByDay = new Map<string, PresenceAnomaly[]>();
  for (const item of anomalies) {
    const date =
      item.kind === "boundary-open"
        ? range.from
        : item.kind === "inferred-close"
          ? range.to
          : item.at.slice(0, 10);
    if (date < range.from || date > range.to) continue;
    const dayAnomalies = anomaliesByDay.get(date) ?? [];
    dayAnomalies.push(item);
    anomaliesByDay.set(date, dayAnomalies);
  }

  const allDays = new Set([...sessionsByDay.keys(), ...anomaliesByDay.keys()]);
  const days: PresenceDay[] = Array.from(allDays)
    .sort()
    .map((date) => {
      const daySessions = sessionsByDay.get(date) ?? [];
      const hours = daySessions.reduce((sum, session) => {
        return (
          sum + (Date.parse(session.endInstant) - Date.parse(session.startInstant)) / MS_PER_HOUR
        );
      }, 0);
      return {
        date,
        hours,
        inProgress: daySessions.some((session) => session.runningAtNow),
        sessions: daySessions,
        anomalies: anomaliesByDay.get(date) ?? [],
      };
    });

  return {
    days,
    serverNow: toWallTimeString(parseWallTime(serverNow)),
    currentDate,
    running,
    anomalies,
  };
}

export function presenceHoursByDate(result: PresenceResult): Map<string, number> {
  return new Map(result.days.filter((day) => day.hours > 0).map((day) => [day.date, day.hours]));
}
