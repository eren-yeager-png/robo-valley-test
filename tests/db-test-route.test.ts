// GET /api/db-test is public (it is only a connectivity check), so it must never tell a stranger which database it is connected to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { GET } from "../src/app/api/db-test/route";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("GET /api/db-test", () => {
  it("answers that the database is reachable and says nothing about which one", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await r.json();
    expect(b).toEqual({ success: true, message: "Database connected successfully" });
    expect("database" in b).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(/current_database|postgres/i);
  });

  it("when the database does not answer: 500, a fixed message, no error text, not cached", async () => {
    let asked = 0;
    testDb().failOn((sql) => { asked += 1; return new Error("secret detail: password=hunter2 host=db.internal for " + sql); });
    const r = await GET();
    expect(asked).toBeGreaterThan(0); // the failure really was injected into the route's own query
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await r.json();
    expect(b).toEqual({ success: false, message: "Database connection failed" });
    expect(JSON.stringify(b)).not.toMatch(/hunter2|db\.internal/);
  });
});
