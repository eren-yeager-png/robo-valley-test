import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "../src/lib/session";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const m = vi.hoisted(() => ({ cookie: undefined as string | undefined, role: "TC", queries: [] as Array<{ sql: string; params: unknown[] }>, updateFails: false, updateEmpty: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }) }));
vi.mock("../src/lib/db", () => ({
  pool: {
    query: async (sql: string, params: unknown[]) => {
      m.queries.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return { rows: [{ id: params[0], full_name: "Asha", email: "a@e.co", role: m.role, email_verification: "email" }] };
      if (m.updateFails) throw new Error("relation users secret-host");
      if (m.updateEmpty) return { rows: [] };
      return { rows: [{ full_name: params[1] ?? "Asha", district: params[2] ?? "Guntur", preferred_language: params[3] ?? "English" }] };
    },
  },
}));

import { PATCH } from "../src/app/api/account/profile/route";

const send = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  PATCH(new Request("http://localhost/api/account/profile", { method: "PATCH", headers, body: raw ?? JSON.stringify(body) }));
const updates = () => m.queries.filter((q) => /^\s*UPDATE/i.test(q.sql));
const signIn = (id = "7") => { m.cookie = createSessionToken({ id, role: "TC" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.cookie = undefined; m.role = "TC"; m.queries = []; m.updateFails = false; m.updateEmpty = false;
  signIn();
});

describe("PATCH /api/account/profile", () => {
  it("401 without a session, and nothing is queried", async () => {
    m.cookie = undefined;
    const res = await send({ fullName: "X" });
    expect(res.status).toBe(401);
    expect(m.queries).toHaveLength(0);
  });

  it("403 for cross-origin browser requests", async () => {
    const res = await send({ fullName: "X" }, { origin: "https://evil.example", host: "localhost" });
    expect(res.status).toBe(403);
    expect(updates()).toHaveLength(0);
  });

  it("updates only the session user's own row, with parameters", async () => {
    const res = await send({ fullName: "  Asha R  ", district: "Krishna", language: "Telugu", profile: { school: "ZP", schoolCode: "9", subjects: ["Maths"] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, user: { fullName: "Asha R", district: "Krishna", language: "Telugu" } });
    const u = updates()[0];
    expect(u.sql).toMatch(/WHERE id = \$1/);
    expect(u.sql).not.toMatch(/Krishna|Asha R/);
    expect(u.params[0]).toBe("7");
    expect(JSON.parse(u.params[4] as string)).toEqual({ school: "ZP", schoolCode: "9", subjects: ["Maths"] });
  });

  it.each([["role"], ["email"], ["id"], ["age_category"], ["ageCategory"], ["consents"], ["password"], ["email_verification"], ["guardian_consent"]])(
    "rejects an attempt to change `%s` and writes nothing",
    async (field) => {
      const res = await send({ fullName: "Asha", [field]: "SA" });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("FIELD_NOT_ALLOWED");
      expect(body.fieldErrors[field]).toBeTruthy();
      expect(updates()).toHaveLength(0);
    }
  );

  it("an id in the body cannot redirect the update to another user", async () => {
    const res = await send({ id: "999", fullName: "Eve" });
    expect(res.status).toBe(400);
    expect(updates()).toHaveLength(0);
  });

  it("validates profile answers against the role stored in the database, not the body", async () => {
    m.role = "ST";
    const res = await send({ profile: { school: "x", schoolCode: "1", subjects: ["Maths"] } }); // TC-shaped answers for an ST
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.fieldErrors["profile.schoolCode"]).toBe("Unknown profile field.");
    expect(body.fieldErrors["profile.class"]).toBeTruthy(); // required ST answer missing
    expect(updates()).toHaveLength(0);
  });

  it("validation: required answers, empty name, bad language, options", async () => {
    for (const [body, field] of [
      [{ fullName: "  " }, "fullName"], [{ district: "" }, "district"], [{ language: "Klingon" }, "language"],
      [{ profile: { school: "x" } }, "profile.schoolCode"], [{ profile: { school: "x", schoolCode: "1", subjects: ["Hacking"] } }, "profile.subjects"],
    ] as Array<[Record<string, unknown>, string]>) {
      const res = await send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).fieldErrors[field]).toBeTruthy();
    }
    expect(updates()).toHaveLength(0);
  });

  it("400 for an empty body, invalid JSON and arrays; 413 when oversized", async () => {
    expect((await send({})).status).toBe(400);
    expect((await send(null, {}, "{no")).status).toBe(400);
    expect((await send(null, {}, "[1]")).status).toBe(400);
    expect((await send({ fullName: "x".repeat(20000) })).status).toBe(413);
  });

  it("completing the profile clears the 'skipped' marker via a parameterised expression", async () => {
    await send({ profile: { school: "ZP", schoolCode: "9", subjects: ["Maths"] } });
    expect(updates()[0].sql).toMatch(/consents - 'profileSkipped'/);
  });

  it("safe 500 on database errors", async () => {
    m.updateFails = true;
    const res = await send({ fullName: "Asha" });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/relation|secret-host/);
  });

  it("401 if the user row disappeared between the session check and the update", async () => {
    m.updateEmpty = true;
    expect((await send({ fullName: "Asha" })).status).toBe(401);
  });
});
