import sql from "mssql";
import type { Config } from "../config/index.js";
import { presenceHoursByDate, reconstructPresence } from "./reconstruct.js";
import type { DateRange, PresenceGateway, PresenceResult, RawPresenceEvent } from "./types.js";

export interface ClockedHoursResult {
  readonly hoursByDate: Map<string, number>;
  readonly today: string;
  readonly isClockRunningToday: boolean;
  readonly presence: PresenceResult;
}

interface PresenceEventRow {
  readonly event_time: string;
  readonly clock: number;
}

interface ServerNowRow {
  readonly server_now: string;
}

function createSqlConfig(config: Config): sql.config {
  return {
    server: config.presence.server,
    database: config.presence.database,
    user: config.presence.user,
    password: config.presence.password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      useUTC: false,
    },
  };
}

function normalizeClock(value: number): 0 | 1 {
  return Number(value) === 1 ? 1 : 0;
}

function normalizeRows(rows: readonly PresenceEventRow[]): RawPresenceEvent[] {
  return rows.map((row) => ({
    eventTime: row.event_time,
    clock: normalizeClock(row.clock),
  }));
}

export async function listPresence(config: Config, range: DateRange): Promise<PresenceResult> {
  const pool = await sql.connect(createSqlConfig(config));

  try {
    const request = pool
      .request()
      .input("userId", sql.Int, config.presence.userId)
      .input("fromDate", sql.Date, range.from)
      .input("toDate", sql.Date, range.to);

    const result = await request.query(`
      SELECT event_time, clock
      FROM (
        SELECT TOP (1)
          CONVERT(varchar(27), [date], 126) AS event_time,
          [clock]
        FROM event_logs
        WHERE user_id = @userId
          AND [date] < CAST(@fromDate AS datetime)
        ORDER BY [date] DESC, [clock] ASC
      ) AS boundary_event

      UNION ALL

      SELECT
        CONVERT(varchar(27), [date], 126) AS event_time,
        [clock]
      FROM event_logs
      WHERE user_id = @userId
        AND [date] >= CAST(@fromDate AS datetime)
        AND [date] < DATEADD(day, 1, CAST(@toDate AS datetime))
      ORDER BY event_time ASC, clock DESC
    `);

    const statusResult = await pool.request().query(`
      SELECT CONVERT(varchar(27), GETDATE(), 126) AS server_now
    `);

    const statusRow = statusResult.recordset[0] as ServerNowRow | undefined;
    const serverNow = statusRow?.server_now;
    if (!serverNow) {
      throw new Error("Presence query did not return SQL Server time.");
    }

    return reconstructPresence(
      normalizeRows(result.recordset as PresenceEventRow[]),
      range,
      config.presence.timeZone,
      serverNow,
    );
  } finally {
    await pool.close();
  }
}

export function createPresenceGateway(config: Config): PresenceGateway {
  return {
    async listPresence(range: DateRange): Promise<PresenceResult> {
      return listPresence(config, range);
    },
  };
}

export async function fetchClockedHours(
  config: Config,
  from: string,
  to: string,
): Promise<ClockedHoursResult> {
  const presence = await listPresence(config, { from, to });
  return {
    hoursByDate: presenceHoursByDate(presence),
    today: presence.currentDate,
    isClockRunningToday: presence.running,
    presence,
  };
}
