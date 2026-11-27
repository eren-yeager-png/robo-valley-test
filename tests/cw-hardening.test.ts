// Contribution workflow, Phase 5: notifications (who gets which email, never blocking a change, failures swallowed), spam protection
// (the same idea twice within minutes, a daily cap per member) and the rate limit on the public reads. Real (in-process) database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "x", email: "x@example.com", role: who.role } : null),
  firstNameOf: () => "X",
}));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string; html: string }[], fail: false }));
vi.mock("../src/lib/email", async (orig) => ({
  ...((await orig()) as object),
  sendWorkflowEmail: async (to: string, subject: string, text: string, html: string) => { if (mail.fail) throw new Error("resend down"); mail.sent.push({ to, subject, text, html }); return "sent"; },
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import * as configRoute from "../src/app/api/cw/form-config/route";
import { buildNotices, notifyNow } from "../src/lib/cw/notify";
import { MESSAGES } from "../public/cw/js/lists.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `77.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const as = (u: { id: string; role: string }) => { who.id = u.id; who.role = u.role; };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
let member: any, mod: any, mod2: any, admin: any;

async function submit(over: Record<string, unknown> = {}) {
  as(member);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: `Beach robot ${++n}`, description: "A small robot that picks up plastic on the beach.", sector: "not-sure", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], resource: {}, ...over }));
  const r = await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }));
  return { status: r.status, b: (await r.json()) as any };
}
const detail = async (id: number) => ((await (await itemRoute.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), ctx(id))).json()) as any).item;
const step = async (id: number, action: string, extra: Record<string, unknown> = {}) => {
  const it = await detail(id);
  const r = await itemRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action, rowVersion: it.rowVersion, proposed: it.proposed, version: it.versions.length, ...extra }) }), ctx(id));
  return (await r.json()) as any;
};

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mail.sent = []; mail.fail = false;
  await q("DELETE FROM api_rate_limits");
  member = await seedUser({ email: `member${++n}@example.com`, role: "PA", fullName: "Meera Kumar" });
  const m1 = await seedUser({ email: `mod-a${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  const m2 = await seedUser({ email: `mod-b${n}@example.com`, role: "TC", fullName: "Ravi Moderator" });
  await q("UPDATE users SET is_moderator = true WHERE id IN ($1, $2)", [m1.id, m2.id]);
  mod = { id: m1.id, role: "TC", email: m1.email }; mod2 = { email: m2.email };
  const a = await seedUser({ email: `admin${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  admin = { id: a.id, role: "admin", email: a.email };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("notifications", () => {
  it("each event goes to the right people, with a link and the RV number; reviewers' emails hold no title or name", async () => {
    const id = (await submit({ title: "Secret-ish idea title" })).b.id;
    const to = async (e: any) => (await buildNotices(e, id, testDb().pool, "https://app.example")).map((x) => x.to).sort();
    expect(await to("submitted")).toEqual([mod.email, mod2.email].sort());
    expect(await to("sent")).toEqual([admin.email]);
    expect(await to("changes")).toEqual([mod.email, mod2.email].sort()); // nobody picked it up yet: all moderators
    as(mod); await step(id, "open");
    expect(await to("changes")).toEqual([mod.email]); // now: its moderator
    expect(await to("published")).toEqual([member.email]);
    expect(await to("rejected")).toEqual([member.email]);
    const sub = (await buildNotices("submitted", id, testDb().pool, "https://app.example"))[0];
    expect(sub.subject).toBe(`New idea RV-${id} to review`);
    expect(sub.text).toContain("https://app.example/admin/workspace");
    expect(sub.text + sub.html).not.toMatch(/Secret-ish|Meera|Kumar/);
    const pub = (await buildNotices("published", id, testDb().pool, "https://app.example"))[0];
    expect(pub.text).toContain('your idea "Secret-ish idea title"');
    expect(pub.text).toContain("https://app.example/dashboard/contributions");
  });
  it("with no moderator yet, a new idea goes to the administrators", async () => {
    await q("UPDATE users SET is_moderator = false");
    const id = (await submit()).b.id;
    expect((await buildNotices("submitted", id, testDb().pool)).map((x) => x.to)).toEqual([admin.email]);
  });
  it("is sent after the change is saved and never blocks it; a failing mail service changes nothing", async () => {
    const r = await submit();
    expect(r.status).toBe(201);
    await flush();
    expect(mail.sent.map((m) => m.subject)).toEqual([`New idea RV-${r.b.id} to review`, `New idea RV-${r.b.id} to review`]);
    mail.fail = true;
    const again = await submit();
    expect(again.status).toBe(201); // saved even though every email fails
    await flush();
    expect(await notifyNow("submitted", again.b.id, { db: testDb().pool })).toBe(0);
    expect(Number(((await q("SELECT count(*)::int n FROM cw_contributions")).rows[0] as any).n)).toBe(2);
  });
  it("the routes notify on send, changes requested, published and rejected", async () => {
    const id = (await submit()).b.id;
    as(mod); await step(id, "send_request"); await flush();
    expect(mail.sent.at(-1)).toMatchObject({ to: admin.email, subject: `Publishing request for RV-${id}` });
    as(admin); await step(id, "request_changes", { feedback: "More detail please." }); await flush();
    expect(mail.sent.at(-1)).toMatchObject({ to: mod.email, subject: `Changes requested for RV-${id}` });
    as(mod); await step(id, "send_request"); as(admin); await step(id, "preview"); await step(id, "publish"); await flush();
    expect(mail.sent.at(-1)).toMatchObject({ to: member.email, subject: `Your idea RV-${id} is published` });
  });
});

describe("spam protection and rate limits", () => {
  it("the same idea again within minutes is refused (a double click or a resend)", async () => {
    expect((await submit({ title: "Robot gardener" })).status).toBe(201);
    const twice = await submit({ title: "  robot GARDENER " });
    expect([twice.status, twice.b.error, twice.b.message]).toEqual([409, "DUPLICATE", MESSAGES.duplicate]);
  });
  it("at most 10 ideas per member in 24 hours", async () => {
    for (let i = 0; i < 10; i++) {
      await q(`INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed) VALUES ($1, 'Meera Kumar', 'PA', 'New idea', $2::jsonb, $2::jsonb)`, [member.id, JSON.stringify({ title: `Earlier idea ${i}` })]);
    }
    const r = await submit();
    expect([r.status, r.b.error, r.b.message]).toEqual([429, "DAILY_LIMIT", MESSAGES.dailyLimit]);
  });
  it("the public reads are rate limited per visitor (60 a minute)", async () => {
    // The counter is a fixed one-minute window on the clock (lib/apiRateLimit.ts). If the 61 calls happen to straddle the start of a
    // minute the count restarts, so then count again from a new address in the new minute (the calls take about a second).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const minute = Math.floor(Date.now() / 60000);
      const call = () => configRoute.GET(new Request("http://localhost/api/cw/form-config", { headers: { "x-forwarded-for": `88.1.1.${attempt}` } }));
      const codes: number[] = [];
      for (let i = 0; i < 61; i++) codes.push((await call()).status);
      if (Math.floor(Date.now() / 60000) !== minute) continue;
      expect(codes.slice(0, 60).every((c) => c === 200), codes.join(",")).toBe(true);
      expect(codes[60]).toBe(429);
      return;
    }
    throw new Error("the calls straddled a minute twice in a row");
  });
});
