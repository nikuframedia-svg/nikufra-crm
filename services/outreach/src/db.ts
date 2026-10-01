import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
  application_name: "nikufra-outreach",
  // Provider POSTs hold the shared outbound permit for at most 10s. Critical
  // writers therefore retain enough budget to wait and still commit their
  // opt-out, kill-switch or disconnect mutation.
  statement_timeout: 30_000,
  query_timeout: 35_000,
  idle_in_transaction_session_timeout: 30_000,
  allowExitOnIdle: false,
});

export async function checkDatabase() {
  const result = await pool.query<{ now: Date }>("select now() as now");
  return result.rows[0]?.now ?? null;
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>, isolation: "read committed" | "repeatable read" | "serializable" = "read committed") {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set transaction isolation level ${isolation}`);
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  await pool.end();
}
