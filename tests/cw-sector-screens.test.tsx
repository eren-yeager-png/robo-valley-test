// The shared sector header on the app's own sector screens: Moderation by sector (administrators and moderators) and Sector forms
// (administrators). The GUARD: EVERY sector (also one added later) renders "+ Contribute to this sector" with its sector filled in.
// The markup is the website's own (public/cw/js/sector.js), rendered on the server. In-process database (PGlite), real pages.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";
const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/moderation",
}));
import SectorFormPage from "../src/app/admin/sector-forms/[slug]/page";
import ModerationSectorPage from "../src/app/(reviewer)/admin/moderation/sector/[slug]/page";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const signInAs = (id: number, role: string) => { m.cookie = createSessionToken({ id: String(id), role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
const html = async (p: Promise<any>) => renderToStaticMarkup(await p);
let seq = 0;
/** THE GUARD for a screen: exactly one header button, leading to the contribute flow with this sector. */
function assertHeader(h: string, slug: string) {
  const buttons = h.match(/class="rv-contribute-btn rv-contribute-btn--header" href="([^"]+)"/g) ?? [];
  expect(buttons, `${slug}: one header button`).toHaveLength(1);
  const href = /href="([^"]+)"/.exec(buttons[0]!)![1]!.replace(/&amp;/g, "&");
  expect(new URL(href).searchParams.get("sector")).toBe(slug);
  expect(h).toContain("rv-sector-headbar");
}

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  for (const [slug, name, o] of [["agriculture-dairy", "Agriculture & Dairy", 10], ["education", "Education", 20], ["healthcare", "Healthcare", 30], ["manufacturing", "Manufacturing", 40]] as const) {
    await q("INSERT INTO sectors (slug, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING", [slug, name, o]);
  }
});

describe("every sector renders the header button on the app's sector screens", () => {
  it("Sector forms (administrators): every sector, also one added later", async () => {
    const admin = Number((await seedUser({ email: `a${++seq}@example.com`, role: "admin", fullName: "Boss" })).id);
    signInAs(admin, "admin");
    await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('space-robots', 'Space robots', 90)"); // a new sector: no code for it
    const slugs = ((await q("SELECT slug FROM sectors WHERE is_active AND NOT is_demo ORDER BY sort_order")).rows as any[]).map((r) => r.slug);
    expect(slugs).toContain("space-robots");
    for (const slug of slugs) assertHeader(await html(SectorFormPage({ params: Promise.resolve({ slug }) })), slug);
  });
  it("Moderation by sector (administrators and moderators): every sector", async () => {
    const mod = Number((await seedUser({ email: `m${++seq}@example.com`, role: "TC", fullName: "Priya Moderator" })).id);
    await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod]);
    signInAs(mod, "TC");
    for (const slug of ["agriculture-dairy", "education", "healthcare", "manufacturing"]) {
      const h = await html(ModerationSectorPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));
      assertHeader(h, slug);
      expect(h).toContain("Contributors for");
    }
  });
});

describe("the Member portals' navigation (src/lib/memberNav.ts, the same in every portal)", () => {
  it("Home, the role's sections, Sectors, My Contributions, Notifications, Profile; every entry points at a page that exists", async () => {
    const { existsSync } = await import("node:fs");
    const { memberNavItems } = await import("../src/lib/memberNav");
    const { getRoleDashboard } = await import("../src/lib/dashboardConfig");
    const { ROLE_CODES } = await import("../src/lib/roles");
    for (const code of ROLE_CODES) {
      const dash = getRoleDashboard(code);
      if (!dash) continue;
      const items = memberNavItems(dash);
      expect(items.map((i) => i.label).slice(-4), code).toEqual(["Sectors", "My Contributions", "Notifications", "Profile & settings"]);
      expect(items[0]).toEqual({ href: "/dashboard", label: "Home" });
      for (const i of items) {
        const page = i.href === "/dashboard" ? "src/app/dashboard/page.tsx" : i.href.startsWith("/dashboard/") && !["/dashboard/sectors", "/dashboard/notifications", "/dashboard/profile"].includes(i.href) ? "src/app/dashboard/[section]/page.tsx" : `src/app${i.href}/page.tsx`;
        expect(existsSync(page), `${code} ${i.href}`).toBe(true);
      }
    }
  });
});
