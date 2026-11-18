// The real connection pool module (src/lib/db.ts): a dropped idle connection must be logged, never an uncaught exception.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLogDedupe } from "../src/lib/logger";

let out: string[];
beforeEach(() => {
  resetLogDedupe();
  out = [];
  vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("pool", () => {
  it("has an error listener, so a lost idle connection is logged with advice instead of crashing the server", async () => {
    const { pool } = await import("../src/lib/db");
    expect(pool.listenerCount("error")).toBe(1);
    expect(() => pool.emit("error", Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }))).not.toThrow();
    const j = JSON.parse(out[0]!);
    expect(j).toMatchObject({ level: "ERROR", category: "DATABASE", where: "lib/db", error: { code: "57P01" } });
    expect(j.hint).toMatch(/shutting down or starting up/);
    expect(out.join(" ")).not.toContain("administrator command"); // the message itself is not logged outside development
    await pool.end();
  });
});
