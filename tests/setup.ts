// Runs before every test file. Makes it impossible for a test to reach a REAL PostgreSQL server:
//   1. DATABASE_URL is forced (vitest.config.ts) to an unroutable placeholder, whatever the shell or .env.local say.
//   2. This file refuses to start if that is not the case, and replaces node-postgres' connect/query with
//      functions that throw. Tests use an in-process PGlite database (tests/helpers/db.ts) instead.
import pg from "pg";

export const TEST_DATABASE_URL = "postgresql://tests-only:tests-only@127.0.0.1:1/never_connects";

if (process.env.DATABASE_URL !== TEST_DATABASE_URL) {
  throw new Error("Refusing to run tests: DATABASE_URL is not the test placeholder. Check vitest.config.ts (test.env).");
}

const blocked = () => {
  throw new Error("Real PostgreSQL connections are blocked in tests. Use the in-process database from tests/helpers/db.ts.");
};
pg.Client.prototype.connect = blocked as never;
pg.Pool.prototype.connect = blocked as never;
pg.Pool.prototype.query = blocked as never;
