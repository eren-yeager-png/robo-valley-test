// The Admin Portal's CSV export (portal PR2): reviewers only; the same view as the screen; contact details only where the author shared
// them with moderators AND the viewer is a flagged moderator (the same query as the screen); spreadsheet formulas neutralised.
// In-process database with the real migrations and the real route; no real database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null),
  firstNameOf: () => "Someone",
}));

import { GET } from "../src/app/api/review/export/route";
import { csvCell } from "../src/lib/contributionReview";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `34.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user(role: string, fullName: string, moderator = false) { const u = await seedUser({ email: `e${++seq}@example.com`, role, fullName }); if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]); return Number(u.id); }
async function make(userId: number, status: string, title: string, sectors = ["agriculture-dairy"]) {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'resource',$2,'A body that is long enough.') RETURNING id", [userId, title])).rows[0] as any).id);
  for (const s of sectors) await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug=$2", [id, s]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now() - (interval '1 minute' * $3), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status, 1000 - (++seq)]);
  return id;
}
const as = (id: number | null) => { who.id = id === null ? null : String(id); };
const get = async (query: string) => { const r = await GET(new Request(`http://localhost/api/review/export?${query}`, { headers: { "x-forwarded-for": ip() } })); return { r, text: await r.text() }; };
/** parse our own CSV (every cell quoted) */
const parse = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n").map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]!.replace(/""/g, '"')));

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20) ON CONFLICT (slug) DO NOTHING");
});
afterEach(() => { vi.restoreAllMocks(); });

describe("CSV export", () => {
  it("a flagged moderator gets shared contact details and NOT the ones the author kept private", async () => {
    const mod = await user("TC", "Ravi Mod", true), author = await user("TC", "Asha Kumari Rao");
    const shared = await make(author, "pending_review", "Shared contact item");
    const priv = await make(author, "pending_review", "Private contact item", ["agriculture-dairy", "education"]);
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, phone, share_with_moderators) VALUES ($1,'Asha Shared','asha@example.com','9876543210',true),($2,'Bela Private','bela@example.com','9999999999',false)", [shared, priv]);
    await q("INSERT INTO contribution_categories (contribution_id, category, position) VALUES ($1,'Projects',1),($1,'Events',2)", [shared]);
    as(mod);
    const { r, text } = await get("sector=agriculture-dairy&tab=all");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="contributions-agriculture-dairy-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const rows = parse(text);
    expect(rows[0]).toEqual(["ID", "Title", "Also in", "Contributor", "Stakeholder category", "Directory categories", "Submitted", "Status", "Contact name", "Contact email", "Contact mobile"]);
    const byTitle = new Map(rows.slice(1).map((x) => [x[1], x]));
    expect(byTitle.get("Shared contact item")!.slice(3, 6)).toEqual(["Asha R.", "Teacher / lab in-charge", "Projects; Events"]);
    expect(byTitle.get("Shared contact item")!.slice(8)).toEqual(["Asha Shared", "asha@example.com", "9876543210"]);
    expect(byTitle.get("Private contact item")![2]).toBe("Education");
    expect(byTitle.get("Private contact item")!.slice(8)).toEqual(["", "", ""]);
    expect(text).not.toMatch(/Bela|bela@|9999999999/);
    expect(text).not.toContain("Kumari"); // contributor shown as first name + initial only
  });
  it("an administrator without the moderator flag gets no contact details at all (the same rule as the screen)", async () => {
    const admin = await user("admin", "Ola Admin"), author = await user("ST", "Asha Rao");
    const shared = await make(author, "pending_review", "Shared contact item");
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Asha Shared','asha@example.com',true)", [shared]);
    as(admin);
    const { r, text } = await get("sector=agriculture-dairy&tab=all");
    expect(r.status).toBe(200);
    expect(text).not.toMatch(/Asha Shared|asha@example\.com/);
  });
  it("exports the same view as the screen: tab, search and category filter", async () => {
    const mod = await user("TC", "Ravi Mod", true), author = await user("ST", "Asha Rao");
    await make(author, "pending_review", "Pending one");
    const pub = await make(author, "published", "Published one");
    await q("INSERT INTO contribution_categories (contribution_id, category, position) VALUES ($1,'Services',1)", [pub]);
    as(mod);
    const titles = async (qs: string) => parse((await get(qs)).text).slice(1).map((x) => x[1]);
    expect(await titles("sector=agriculture-dairy&tab=new")).toEqual(["Pending one"]);
    expect(await titles("sector=agriculture-dairy&tab=published")).toEqual(["Published one"]);
    expect(await titles("sector=agriculture-dairy&tab=all&cat=Services")).toEqual(["Published one"]);
    expect(await titles("sector=agriculture-dairy&tab=all&q=pending")).toEqual(["Pending one"]);
    expect(await titles("sector=education&tab=all")).toEqual([]);
    const [pending] = (await q("SELECT id FROM contributions WHERE title = 'Pending one'")).rows as { id: number }[];
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES ($1,$2,'verify')", [pending.id, mod]);
    expect(await titles("sector=agriculture-dairy&tab=all&verified=1")).toEqual(["Pending one"]); // the admin Sector Counts filter too
    expect(await titles("sector=agriculture-dairy&tab=all&verified=0")).toEqual([]);
  });
  it("neutralises spreadsheet formulas and keeps quotes and commas inside one cell", async () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    for (const s of ["+1+1", "-2", "@SUM(A1)", "\tTab", "\rCR"]) expect(csvCell(s).startsWith("\"'")).toBe(true);
    expect(csvCell("Plain, with \"quotes\"")).toBe('"Plain, with ""quotes"""');
    expect(csvCell(null)).toBe('""');
    const mod = await user("TC", "Ravi Mod", true), author = await user("ST", "Asha Rao");
    await make(author, "pending_review", "=cmd|' /C calc'!A0");
    as(mod);
    const row = parse((await get("sector=agriculture-dairy&tab=new")).text)[1]!;
    expect(row[1]).toBe("'=cmd|' /C calc'!A0");
  });
  it("refuses members (403) and signed-out visitors (401); an unknown or malformed sector is 404", async () => {
    const member = await user("ST", "Asha Rao"), mod = await user("TC", "Ravi Mod", true);
    as(member);
    expect((await get("sector=agriculture-dairy")).r.status).toBe(403);
    as(null);
    expect((await get("sector=agriculture-dairy")).r.status).toBe(401);
    as(mod);
    expect((await get("sector=no-such-sector")).r.status).toBe(404);
    expect((await get("sector=../etc")).r.status).toBe(404);
    expect((await get("")).r.status).toBe(404);
  });
});
