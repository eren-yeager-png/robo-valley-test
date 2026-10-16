// Server-rendered dashboard pages: role content, access control and data isolation for all 12 roles.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_DASHBOARDS } from "../src/lib/dashboardConfig";
import { ROLE_CODES } from "../src/lib/roles";
import { createSessionToken } from "../src/lib/session";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const st = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  user: null as null | Record<string, unknown>,
  guardian: null as null | Record<string, unknown>,
  failProfileQuery: false,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && st.cookie ? { name: n, value: st.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../src/lib/db", () => ({
  pool: {
    query: async (sql: string, params: unknown[]) => {
      st.queries.push({ sql, params });
      if (/FROM guardian_details/.test(sql)) return { rows: st.guardian ? [st.guardian] : [] };
      if (/FROM users WHERE id/.test(sql)) {
        if (st.failProfileQuery && /preferred_language/.test(sql)) throw new Error("boom secret-host");
        return { rows: st.user && String(st.user.id) === String(params[0]) ? [st.user] : [] };
      }
      return { rows: [] };
    },
  },
}));

import DashboardLayout from "../src/app/dashboard/layout";
import DashboardHome from "../src/app/dashboard/page";
import SectionPage from "../src/app/dashboard/[section]/page";
import ProfilePage from "../src/app/dashboard/profile/page";
import NotificationsPage from "../src/app/dashboard/notifications/page";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const dbUser = (role: unknown, over: Record<string, unknown> = {}) => ({
  id: "7", full_name: "Asha Rao", email: "asha@example.com", mobile: "9876543210", district: "Guntur", preferred_language: "English",
  role, age_category: "adult", email_verification: "email", created_at: "2026-10-01T00:00:00.000Z", profile: {}, consents: {}, ...over,
});
const token = (id = "7", role = "ST") => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
function signInAs(role: unknown, over: Record<string, unknown> = {}) {
  st.user = dbUser(role, over);
  st.cookie = token("7", typeof role === "string" && role ? role : "ST");
}
const html = async (node: Promise<React.ReactNode> | React.ReactNode) => renderToStaticMarkup(<>{await node}</>);
const page = async (role: string) => html(DashboardLayout({ children: await DashboardHome() }));

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  st.cookie = undefined; st.user = null; st.guardian = null; st.failProfileQuery = false; st.queries = [];
});

describe.each(ROLE_CODES)("dashboard for role %s", (code) => {
  const dash = ROLE_DASHBOARDS[code];
  const others = ROLE_CODES.filter((c) => c !== code).map((c) => ROLE_DASHBOARDS[c]);

  it("shows this role's navigation, welcome and tiles", async () => {
    signInAs(code);
    const out = await page(code);
    expect(out).toContain("Welcome, Asha!");
    expect(out).toContain(esc(dash.label));
    for (const s of dash.sections) expect(out).toContain(`>${esc(s.label)}</a>`);
    expect(out).toContain(">Notifications</a>");
    expect(out).toContain(">Profile &amp; settings</a>");
    expect(out).toContain("Sign out");
    for (const t of dash.tiles) expect(out).toContain(`<span class="cap">${esc(t)}</span>`);
  });

  it("never shows another role's sections or tiles", async () => {
    signInAs(code);
    const out = await page(code);
    const mySections = new Set(dash.sections.map((s) => s.label));
    const myTiles = new Set(dash.tiles);
    for (const o of others) {
      for (const s of o.sections) if (!mySections.has(s.label)) expect(out, `${code} should not show "${s.label}"`).not.toContain(`>${esc(s.label)}</a>`);
      for (const t of o.tiles) if (!myTiles.has(t)) expect(out, `${code} should not show tile "${t}"`).not.toContain(`<span class="cap">${esc(t)}</span>`);
    }
  });

  it("labels placeholders honestly: no numeric metrics, sample data only inside a labelled block", async () => {
    signInAs(code);
    const out = await page(code);
    expect(out).toContain("Not available yet");
    expect((out.match(/aria-label="not available yet"/g) ?? []).length).toBe(dash.tiles.length);
    if (["AR", "FS"].includes(code)) expect(out).not.toContain("Sample data");
    else {
      expect(out).toContain("Sample data, not your data");
      expect(out).toContain("<details");
      expect(out).not.toMatch(/<details[^>]*\sopen/); // collapsed by default
    }
  });

  it("each of its sections renders an empty state naming what is missing", async () => {
    signInAs(code);
    for (const s of dash.sections) {
      const out = await html(SectionPage({ params: Promise.resolve({ section: s.slug }) }));
      expect(out).toContain(`<h1>${esc(s.label)}</h1>`);
      expect(out).toContain("Nothing to show here yet");
      expect(out).toContain(esc(s.needs));
      expect(out).not.toContain("Access denied");
    }
  });

  it("is denied every section that belongs only to other roles, with no data leaked", async () => {
    signInAs(code);
    const mine = new Set(dash.sections.map((s) => s.slug));
    const foreign = new Map(others.flatMap((o) => o.sections).filter((s) => !mine.has(s.slug)).map((s) => [s.slug, s]));
    expect(foreign.size).toBeGreaterThan(0);
    for (const [slug, s] of foreign) {
      const out = await html(SectionPage({ params: Promise.resolve({ section: slug }) }));
      expect(out, `${code} -> ${slug}`).toContain("Access denied");
      expect(out).not.toContain(esc(s.needs));
      expect(out).not.toContain(esc(s.description));
    }
  });
});

describe("authentication and unknown roles", () => {
  it("anonymous visitors are redirected to /login by the layout and every page", async () => {
    await expect(DashboardLayout({ children: null })).rejects.toThrow("REDIRECT:/login");
    await expect(DashboardHome()).rejects.toThrow("REDIRECT:/login");
    await expect(ProfilePage()).rejects.toThrow("REDIRECT:/login");
    await expect(NotificationsPage()).rejects.toThrow("REDIRECT:/login");
    await expect(SectionPage({ params: Promise.resolve({ section: "projects" }) })).rejects.toThrow("REDIRECT:/login");
  });

  it("a forged cookie is treated as anonymous", async () => {
    st.user = dbUser("SA");
    st.cookie = token().slice(0, -3) + "AAA";
    await expect(DashboardHome()).rejects.toThrow("REDIRECT:/login");
  });

  it.each([["XX"], [""], [null], ["admin"], ["st"]])("unknown/missing stored role %j: no dashboard, children never rendered", async (role) => {
    signInAs(role);
    const out = await html(DashboardLayout({ children: <p id="secret-child">PRIVATE CHILD CONTENT</p> }));
    expect(out).toContain("Your account has no dashboard yet");
    expect(out).not.toContain("PRIVATE CHILD CONTENT");
    expect(out).not.toContain("Sign out" + "x");
    for (const p of [DashboardHome(), ProfilePage(), NotificationsPage(), SectionPage({ params: Promise.resolve({ section: "projects" }) })]) {
      const o = await html(p);
      expect(o).toContain("Your account has no dashboard yet");
      expect(o).not.toContain("Nothing to show here yet");
    }
  });

  it("an unknown section URL is a 404 (not an access-denied that reveals structure)", async () => {
    signInAs("ST");
    await expect(SectionPage({ params: Promise.resolve({ section: "no-such-section" }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("the role comes from the database, never from the client", () => {
  it("a token that claims role SA does not unlock SA data when the database says ST", async () => {
    st.user = dbUser("ST");
    st.cookie = token("7", "SA"); // forged claim inside a validly signed token
    const out = await page("ST");
    expect(out).toContain(">Projects</a>");
    expect(out).not.toContain(">School profile</a>");
    const denied = await html(SectionPage({ params: Promise.resolve({ section: "school" }) }));
    expect(denied).toContain("Access denied");
  });

  it("a role change in the database takes effect immediately for an existing session", async () => {
    signInAs("ST");
    expect(await page("ST")).toContain(">Projects</a>");
    st.user = dbUser("KS");
    const out = await page("KS");
    expect(out).toContain(">Kit catalogue</a>");
    expect(out).not.toContain(">Projects</a>");
  });
});

describe("data isolation", () => {
  it("every database query is scoped to the session user's id and never reads secrets", async () => {
    signInAs("PA", { id: "7" });
    await page("PA");
    await html(ProfilePage());
    await html(NotificationsPage());
    expect(st.queries.length).toBeGreaterThan(3);
    for (const q of st.queries) {
      expect(q.params).toEqual(["7"]); // only the verified session user's id, nothing from the request
      expect(q.sql).toMatch(/WHERE (id|user_id) = \$1/);
      expect(q.sql).not.toMatch(/password|otp|secret/i);
      expect(q.sql).not.toMatch(/guardian_mobile|guardian_email/); // guardian contact details are never loaded
    }
  });

  it("another user's records are unreachable: a session for user 7 cannot load user 8", async () => {
    st.user = dbUser("ST", { id: "8" });
    st.cookie = token("7", "ST");
    await expect(DashboardHome()).rejects.toThrow("REDIRECT:/login"); // user 7 does not exist => anonymous
  });

  it("never renders password hashes or other sensitive fields", async () => {
    signInAs("ST", { password_hash: "$2b$12$abcdefghijklmnopqrstuv", otp: "123456" });
    const all = (await page("ST")) + (await html(ProfilePage())) + (await html(NotificationsPage()));
    expect(all).not.toMatch(/\$2[aby]\$|password_hash|123456|SESSION_SECRET/);
  });
});

describe("real data on the dashboard", () => {
  it("shows profile completeness from the user's own answers and a task for missing required ones", async () => {
    signInAs("TC", { profile: { school: "ZP High", subjects: ["Maths"] } }); // missing schoolCode
    const out = await page("TC");
    expect(out).toContain("67%");
    expect(out).toContain("Complete your profile");
    expect(out).toContain("School UDISE or ATL code");
  });

  it("complete profile: 100% and no profile task", async () => {
    signInAs("TC", { profile: { school: "ZP High", schoolCode: "1", subjects: ["Maths"] } });
    const out = await page("TC");
    expect(out).toContain("100%");
    expect(out).toContain("You&#x27;re all caught up");
  });

  it("minor student: shows pending guardian consent (test mode never counts as granted) without guardian contact details", async () => {
    signInAs("ST", { age_category: "minor", profile: { class: "Class 9–10", school: "GHS" } });
    st.guardian = { guardian_name: "Lakshmi", guardian_relationship: "Mother", consent_status: "pending", consent_mode: "test", consent_recorded_at: null };
    const out = await page("ST");
    expect(out).toContain("Parent or guardian consent is pending");
    expect(out).toContain(">Pending<");
    expect(out).toContain("Mother: Lakshmi");
    expect(out).not.toMatch(/9988776655|lakshmi@/);
    expect(out).not.toContain(">Granted<");
  });

  it("adult accounts show no guardian consent card", async () => {
    signInAs("ST", { profile: { class: "Class 9–10", school: "GHS" } });
    expect(await page("ST")).not.toContain("Parent or guardian consent");
  });

  it("a mock-verified account is flagged as test mode", async () => {
    signInAs("ST", { email_verification: "mock" });
    expect(await page("ST")).toContain("verified in test mode");
  });

  it("database failure shows a safe error state with no internals", async () => {
    signInAs("ST");
    st.failProfileQuery = true;
    const out = await page("ST");
    expect(out).toContain("We couldn&#x27;t load this page");
    expect(out).not.toMatch(/boom|secret-host|stack/i);
    expect(await html(ProfilePage())).toContain("couldn&#x27;t load");
    expect(await html(NotificationsPage())).toContain("couldn&#x27;t load");
  });
});
