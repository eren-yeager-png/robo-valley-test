
import { Pool } from "pg";
import { logError } from "./logger";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Check your .env.local file.");
}

const globalForPostgres = globalThis as typeof globalThis & {
  postgresPool?: Pool;
};

export const pool =
  globalForPostgres.postgresPool ??
  new Pool({
    connectionString,
    max: 10,
  });

// An IDLE connection can be dropped by the server (a restart, a failover, a provider timeout). The pool reports that as an
// "error" event, and an event with no listener is an uncaught exception that stops the whole server. Handling it here
// logs it and lets the pool open a fresh connection on the next query.
if (pool.listenerCount("error") === 0) {
  pool.on("error", (err) => logError({ category: "DATABASE", where: "lib/db", what: "An idle database connection was lost (the pool opens a new one on the next query)", err }));
}

if (process.env.NODE_ENV !== "production") {
  globalForPostgres.postgresPool = pool;
}
