import sql from "mssql";
import type { Config } from "./config.js";
import { formatDate } from "./utils.js";

export interface ClockedHoursResult {
  hoursByDate: Map<string, number>;
  today: string;
  isClockRunningToday: boolean;
}

function getDayEndUtc(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

function addHoursForInterval(
  hoursByDate: Map<string, number>,
  day: string,
  start: Date,
  end: Date
): void {
  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0) {
    return;
  }

  const durationHours = durationMs / (1000 * 60 * 60);
  const existing = hoursByDate.get(day) ?? 0;
  hoursByDate.set(day, existing + durationHours);
}

export async function fetchClockedHours(
  config: Config,
  from: string,
  to: string
): Promise<ClockedHoursResult> {
  const sqlConfig: sql.config = {
    server: config.mssqlServer,
    database: config.mssqlDatabase,
    user: config.mssqlUser,
    password: config.mssqlPassword,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      useUTC: false,
    },
  };

  const pool = await sql.connect(sqlConfig);

  try {
    // Query raw events and aggregate in TypeScript using explicit state transitions.
    // This avoids overcounting when redundant start/stop events are emitted.
    const result = await pool.request()
      .input("userId", sql.Int, parseInt(config.slackUserId))
      .input("fromDate", sql.Date, from)
      .input("toDate", sql.Date, to)
      .query(`
        SELECT
          [date] AS event_time,
          [clock]
        FROM event_logs
        WHERE user_id = @userId
          AND CAST([date] AS DATE) >= @fromDate
          AND CAST([date] AS DATE) <= @toDate
        ORDER BY [date] ASC
      `);

    const clockedHours = new Map<string, number>();
    const now = new Date();
    const today = formatDate(now);

    let activeStart: Date | null = null;
    let activeDay: string | null = null;

    const rows = result.recordset as Array<{ event_time: Date; clock: number }>;
    for (const row of rows) {
      const eventTime = new Date(row.event_time);
      const eventDay = formatDate(eventTime);
      const isClockIn = Number(row.clock) === 1;

      if (activeStart && activeDay && activeDay !== eventDay) {
        addHoursForInterval(clockedHours, activeDay, activeStart, getDayEndUtc(activeDay));
        activeStart = null;
        activeDay = null;
      }

      if (isClockIn) {
        if (!activeStart) {
          activeStart = eventTime;
          activeDay = eventDay;
        }
        continue;
      }

      if (activeStart && activeDay) {
        addHoursForInterval(clockedHours, activeDay, activeStart, eventTime);
        activeStart = null;
        activeDay = null;
      }
    }

    const isClockRunningToday = activeStart !== null && activeDay === today;

    if (activeStart && activeDay) {
      const closingTime = isClockRunningToday ? now : getDayEndUtc(activeDay);
      addHoursForInterval(clockedHours, activeDay, activeStart, closingTime);
    }

    const statusResult = await pool.request()
      .input("userId", sql.Int, parseInt(config.slackUserId))
      .query(`
        SELECT
          CAST(GETDATE() AS DATE) AS today,
          CAST(
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM (
                  SELECT TOP 1 [clock]
                  FROM event_logs
                  WHERE user_id = @userId
                    AND CAST([date] AS DATE) = CAST(GETDATE() AS DATE)
                  ORDER BY [date] DESC
                ) AS last_event
                WHERE last_event.clock = 1
              ) THEN 1
              ELSE 0
            END AS BIT
          ) AS is_running
      `);

    const statusRow = statusResult.recordset[0] as
      | { today: Date; is_running: boolean | number }
      | undefined;

    return {
      hoursByDate: clockedHours,
      today: statusRow ? formatDate(new Date(statusRow.today)) : formatDate(new Date()),
      isClockRunningToday: isClockRunningToday || Boolean(statusRow?.is_running),
    };
  } finally {
    await pool.close();
  }
}
