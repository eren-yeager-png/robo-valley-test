// Login throttle against an in-process PostgreSQL (real SQL; see tests/helpers.ts).
import { describe, expect, it, vi } from "vitest";
import { testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import {
  LOCKOUT_MS, MAX_FAILURES, maybeCleanupLoginAttempts, recordFailure, recordSuccess, reserveAttempt, retryAfterSeconds, WINDOW_MS,
} from "../src/lib/loginThrottle";

const K = "asha@example.com";
const T0 = Date.UTC(2030, 0, 1, 12, 0, 0);
const row = async (k = K) => ((await testDb().raw.query("select failures, locked_until, window_started_at from login_attempts where email = $1", [k])).rows[0] ?? null) as any;

describe("reserveAttempt (counts the attempt before the password is checked)", () => {
  it("allows 5 attempts, refuses the 6th, and reports the remaining lock time", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await reserveAttempt(K, T0 + i * 1000)).allowed).toBe(true);
    const sixth = await reserveAttempt(K, T0 + 5000);
    expect(sixth.allowed).toBe(false);
    // the lock was set by the 5th attempt (at T0+4 s) and lasts 15 minutes
    expect(sixth.retryAfterSeconds).toBe(LOCKOUT_MS / 1000 - 1);
    expect((await row()).failures).toBe(6);
  });

  it("the first attempts are not locked, the lock starts exactly at the 5th", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await reserveAttempt(K, T0 + i);
    expect((await row()).locked_until).toBeNull();
    await reserveAttempt(K, T0 + 10);
    expect((await row()).locked_until).not.toBeNull();
  });

  it("stays locked for the whole 15 minutes and unlocks right after (counter starts again at 1)", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await reserveAttempt(K, T0);
    expect((await reserveAttempt(K, T0 + LOCKOUT_MS - 1000)).allowed).toBe(false);
    const after = await reserveAttempt(K, T0 + LOCKOUT_MS + 1000);
    expect(after.allowed).toBe(true);
    expect((await row()).failures).toBe(1);
    expect((await row()).locked_until).toBeNull();
  });

  it("failures spread over the window accumulate; a quiet window restarts the count", async () => {
    await reserveAttempt(K, T0);
    await reserveAttempt(K, T0 + 5 * 60_000);
    await reserveAttempt(K, T0 + 10 * 60_000);
    expect((await row()).failures).toBe(3);
    await reserveAttempt(K, T0 + WINDOW_MS + 60_000); // 16 minutes after the first: new window
    expect((await row()).failures).toBe(1);
  });

  it("keeps different emails independent", async () => {
    for (let i = 0; i < MAX_FAILURES + 2; i++) await reserveAttempt(K, T0);
    expect((await reserveAttempt("other@example.com", T0)).allowed).toBe(true);
  });

  it("cannot overflow the smallint counter while someone hammers a locked email", async () => {
    await reserveAttempt(K, T0);
    await testDb().raw.query("update login_attempts set failures = 32760, locked_until = $2::timestamptz where email = $1", [K, new Date(T0 + LOCKOUT_MS).toISOString()]);
    const r = await reserveAttempt(K, T0 + 1000);
    expect(r.allowed).toBe(false);
    expect((await row()).failures).toBe(1000);
  });

  it("uses the database clock when no time is given", async () => {
    const r = await reserveAttempt("clock@example.com");
    expect(r.allowed).toBe(true);
    const [w] = (await testDb().raw.query("select abs(extract(epoch from (now() - window_started_at))) d from login_attempts where email = 'clock@example.com'")).rows as any[];
    expect(Number(w.d)).toBeLessThan(5);
  });
});

describe("recordSuccess / retryAfterSeconds / recordFailure", () => {
  it("recordSuccess clears the counter", async () => {
    for (let i = 0; i < 3; i++) await reserveAttempt(K, T0);
    await recordSuccess(K);
    expect(await row()).toBeNull();
    expect((await reserveAttempt(K, T0)).allowed).toBe(true);
    expect((await row()).failures).toBe(1);
  });

  it("retryAfterSeconds only reads: it is 0 when not locked and never counts an attempt", async () => {
    expect(await retryAfterSeconds(K, T0)).toBe(0);
    expect(await row()).toBeNull();
    for (let i = 0; i < MAX_FAILURES; i++) await reserveAttempt(K, T0);
    expect(await retryAfterSeconds(K, T0 + 60_000)).toBe(LOCKOUT_MS / 1000 - 60);
    expect(await retryAfterSeconds(K, T0 + LOCKOUT_MS + 1)).toBe(0);
    expect((await row()).failures).toBe(5);
  });

  it("recordFailure counts like reserveAttempt (kept for callers that count after the fact)", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await recordFailure(K, T0);
    expect(await retryAfterSeconds(K, T0)).toBe(LOCKOUT_MS / 1000);
  });
});

describe("shared by every instance, and tidied", () => {
  it("a fresh module instance sees the lock", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await reserveAttempt(K, T0);
    vi.resetModules();
    const fresh = await import("../src/lib/loginThrottle");
    expect((await fresh.reserveAttempt(K, T0 + 1000)).allowed).toBe(false);
  });

  it("old rows are removed opportunistically (never fresh or still-locked ones)", async () => {
    await testDb().raw.exec(`
      insert into login_attempts (email, failures, window_started_at, locked_until) values
        ('old@e.co', 2, now() - interval '3 days', null),
        ('fresh@e.co', 1, now(), null),
        ('locked@e.co', 6, now() - interval '3 days', now() + interval '10 minutes');`);
    await maybeCleanupLoginAttempts(testDb().pool, () => 0.9); // not selected this time: nothing happens
    expect((await testDb().raw.query("select count(*)::int n from login_attempts")).rows[0]).toMatchObject({ n: 3 });
    await maybeCleanupLoginAttempts(testDb().pool, () => 0.01); // selected
    expect(((await testDb().raw.query("select email from login_attempts order by email")).rows as any[]).map((r) => r.email)).toEqual(["fresh@e.co", "locked@e.co"]);
  });

  it("cleanup never throws, even if the table is unavailable", async () => {
    const broken = { query: async () => { throw new Error("db down"); } };
    await expect(maybeCleanupLoginAttempts(broken, () => 0)).resolves.toBeUndefined();
  });
});
