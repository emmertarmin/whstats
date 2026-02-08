import sql from "mssql";
import type { Config } from "./config.js";
import { formatDate } from "./utils.js";

export async function fetchClockedHours(
  config: Config,
  from: string,
  to: string
): Promise<Map<string, number>> {
  const sqlConfig: sql.config = {
    server: config.mssqlServer,
    database: config.mssqlDatabase,
    user: config.mssqlUser,
    password: config.mssqlPassword,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };

  const pool = await sql.connect(sqlConfig);

  try {
    // Query to calculate clocked-in time per day
    // For each day, we pair clock-in (1) with clock-out (0) events and sum the differences
    const result = await pool.request()
      .input("userId", sql.Int, parseInt(config.slackUserId))
      .input("fromDate", sql.Date, from)
      .input("toDate", sql.Date, to)
      .query(`
        WITH OrderedEvents AS (
          SELECT 
            CAST([date] AS DATE) AS day,
            [date] AS event_time,
            [clock],
            ROW_NUMBER() OVER (PARTITION BY CAST([date] AS DATE) ORDER BY [date]) AS rn
          FROM event_logs
          WHERE user_id = @userId
            AND CAST([date] AS DATE) >= @fromDate
            AND CAST([date] AS DATE) <= @toDate
        ),
        ClockPairs AS (
          SELECT 
            e1.day,
            e1.event_time AS clock_in,
            e2.event_time AS clock_out
          FROM OrderedEvents e1
          LEFT JOIN OrderedEvents e2 
            ON e1.day = e2.day 
            AND e1.rn + 1 = e2.rn 
            AND e2.clock = 0
          WHERE e1.clock = 1
        )
        SELECT 
          day,
          SUM(DATEDIFF(MINUTE, clock_in, ISNULL(clock_out, GETDATE()))) / 60.0 AS hours
        FROM ClockPairs
        GROUP BY day
        ORDER BY day
      `);

    const clockedHours = new Map<string, number>();
    for (const row of result.recordset) {
      const dateStr = formatDate(new Date(row.day));
      clockedHours.set(dateStr, parseFloat(row.hours));
    }

    return clockedHours;
  } finally {
    await pool.close();
  }
}
