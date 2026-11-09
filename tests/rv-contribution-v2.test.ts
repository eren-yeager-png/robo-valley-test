// @vitest-environment jsdom
// The WordPress plugin "RoboValley Contribution (v2)": the owner's form wired to the app API. The network is faked; nothing real is
// contacted. The PHP side is checked statically here (the switch, the pages, no storage, no secrets) and was run on a local test site.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DIR = join(__dirname, "..", "frontend", "wordpress", "plugins", "rv-contribution-v2");
const MARKUP = readFileSync(join(DIR, "assets", "rv-contribution-v2.html"), "utf8");
const SCRIPT = readFileSync(join(DIR, "assets", "rv-contribution-v2.js"), "utf8");
const PHP = readFileSync(join(DIR, "rv-contribution-v2.php"), "utf8");
const CSS = readFileSync(join(DIR, "assets", "rv-contribution-v2.css"), "utf8");
const BASE = "https://app.example.test";
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as unknown as T;
const field = (name: string) => (q<HTMLFormElement>("#contribute").elements as any)[name] as HTMLInputElement;
type Call = { path: string; method: string; body: any };
let calls: Call[];
const MINE = { success: true, contributor: true, counts: {}, items: [
  { id: 7, title: "Waiting one", status: "pending_review", statusLabel: "Pending review", sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy" }], note: null },
  { id: 8, title: "Live one", status: "published", statusLabel: "Published", sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy" }], note: null },
  { id: 9, title: "Not this time", status: "rejected", statusLabel: "Not accepted", sectors: [], note: "This reads as an advert." },
] };
const SECTORS = { success: true, sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy" }, { slug: "education", name: "Education" }] };
function routes(extra: (c: Call) => Response | undefined = () => undefined, me: unknown = { role: "user", firstName: "Asha", stakeholder: "Teacher / lab in-charge" }) {
  return (c: Call) => extra(c) ?? (c.path === "/api/auth/me" ? reply(me) : c.path === "/api/contributions/sectors" ? reply(SECTORS) : c.path === "/api/contributions/mine" ? reply(MINE) : undefined);
}
async function run(r: (c: Call) => Response | undefined, base: string | null = BASE) {
  document.body.innerHTML = MARKUP;
  (window as any).RoboValleyApi = base === null ? undefined : { base };
  calls = [];
  (window as any).fetch = vi.fn(async (u: string, o: any = {}) => {
    const body = o.body instanceof FormData ? Object.fromEntries((o.body as FormData).entries()) : o.body ? JSON.parse(o.body) : undefined;
    const c = { path: String(u).replace(BASE, ""), method: o.method ?? "GET", body };
    expect(String(u).startsWith(BASE), String(u)).toBe(true); // only the app is ever contacted
    expect(o.credentials).toBe("include");
    calls.push(c);
    return r(c) ?? reply({ success: false }, 404);
  });
  (0, eval)(SCRIPT);
  await flush();
}
function fillValid() {
  field("title").value = "Weekend robotics club";
  field("description").value = "A free weekend club where students build simple robots.";
  const projects = q<HTMLInputElement>('#choices input[value="Projects"]'); projects.checked = true; projects.dispatchEvent(new Event("change"));
  q<HTMLInputElement>('#sector-choices input[value="education"]').checked = true;
}
function addLink(type: string, url: string, gist: string) {
  const panel = Array.from(document.querySelectorAll(".category-details")).find((p) => !(p as HTMLFieldSetElement).hidden)!;
  (panel.querySelector(".add") as HTMLButtonElement).click();
  const row = panel.querySelector(".references")!.lastElementChild!;
  (row.querySelector("select") as HTMLSelectElement).value = type;
  (row.querySelector("[name=referenceUrl]") as HTMLInputElement).value = url;
  (row.querySelector("[name=referenceGist]") as HTMLInputElement).value = gist;
  return panel;
}
const submit = async () => { q<HTMLFormElement>("#contribute").dispatchEvent(new Event("submit", { cancelable: true })); await flush(); };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
async function choosePhoto(bytes: Uint8Array, name: string, size?: number) {
  const input = q<HTMLInputElement>("#photo-file");
  const file = new File([bytes], name);
  if (size) Object.defineProperty(file, "size", { value: size });
  (file as any).slice = () => ({ arrayBuffer: async () => bytes.buffer.slice(0, 16) });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await flush();
}

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => { setItem = vi.spyOn(Storage.prototype, "setItem"); });
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); expect(setItem).not.toHaveBeenCalled(); });

describe("signed out, signed in, not configured", () => {
  it("signed out: shows the Sign In / Sign Up box only, and asks the app nothing else", async () => {
    await run(routes(undefined, { role: null, firstName: null, stakeholder: null }));
    expect(q("#guest").hidden).toBe(false); expect(q("#member-area").hidden).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(["/api/auth/me"]);
    expect(document.body.innerHTML).not.toMatch(/registration|Create Demo Profile|demo member/i); // the simulation is gone
  });
  it("without the app address it says the form is not available and contacts nothing", async () => {
    await run(routes(), null);
    expect(q("#rv-c2-unavailable").hidden).toBe(false); expect(calls).toEqual([]);
  });
  it("signed in: first name, the stakeholder category from the profile, the sectors from the app, and My Contributions with real statuses", async () => {
    await run(routes());
    expect(q("#member-area").hidden).toBe(false);
    expect(q("#member-name").textContent).toBe("Asha");
    expect(q("#stakeholder").textContent).toBe("Teacher / lab in-charge");
    expect(Array.from(document.querySelectorAll("#sector-choices input")).map((i) => (i as HTMLInputElement).value)).toEqual(["agriculture-dairy", "education"]);
    const rows = Array.from(document.querySelectorAll("#history li")).map((li) => li.textContent);
    expect(rows[0]).toBe("Waiting one · Agriculture & Dairy · Pending review");
    expect(rows[1]).toContain("Published"); expect(rows[2]).toContain("Not accepted"); expect(rows[2]).toContain("This reads as an advert.");
    expect(q("#empty").hidden).toBe(true);
  });
});

describe("the owner's form: limits and messages", () => {
  it("keeps the owner's limits (title 120, description 1,200) and shows the server minimums as hints", async () => {
    await run(routes());
    expect(field("title").maxLength).toBe(120); expect(field("description").maxLength).toBe(1200);
    expect(q("#rv-c2-title-hint").textContent).toBe("At least 5 characters.");
    expect(q("#rv-c2-description-hint").textContent).toBe("At least 10 characters.");
  });
  it("refuses a short title, a short description, no category, a bad link, no sector, and too much text, with plain messages; nothing is sent", async () => {
    await run(routes());
    await submit(); expect(field("title").validationMessage).toBe("Give it a title of at least 5 characters.");
    field("title").value = "Weekend robotics club"; await submit(); expect(field("description").validationMessage).toBe("Tell us a little more (at least 10 characters).");
    field("description").value = "A free weekend club for students."; await submit();
    expect(q<HTMLInputElement>('#choices input[value="Projects"]').validationMessage).toBe("Select at least one directory category.");
    const p = q<HTMLInputElement>('#choices input[value="Projects"]'); p.checked = true; p.dispatchEvent(new Event("change"));
    const panel = addLink("Website", "ftp://nope", "Club page");
    await submit(); expect((panel.querySelector("[name=referenceUrl]") as HTMLInputElement).validationMessage).toBe("Enter a link beginning with https:// or http://.");
    (panel.querySelector("[name=referenceUrl]") as HTMLInputElement).value = "https://example.org/club"; await submit();
    expect(q<HTMLInputElement>("#sector-choices input").validationMessage).toBe("Choose at least one sector.");
    q<HTMLInputElement>('#sector-choices input[value="education"]').checked = true;
    (panel.querySelector("[name=remarks]") as HTMLTextAreaElement).value = "x".repeat(1990); await submit();
    expect(field("description").validationMessage).toMatch(/too long together \(2000 characters at most\)/);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
  it("contact details: a name and an email or phone are needed once anything is typed; sharing is off by default", async () => {
    await run(routes()); fillValid();
    expect(field("shareWithModerators").checked).toBe(false);
    field("contactEmail").value = "a@example.invalid"; await submit(); expect(field("contactName").validationMessage).toBe("Tell us who to contact.");
    field("contactEmail").value = ""; field("contactName").value = "Asha Rao"; await submit(); expect(field("contactEmail").validationMessage).toBe("Give an email address or a mobile number.");
  });
});

describe("photos: up to 3, JPG or PNG from the bytes, 4 MB, described", () => {
  it("refuses a GIF, a 5 MB file and a fourth photo; a photo needs a description before sending", async () => {
    await run(routes());
    await choosePhoto(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "anim.gif"); expect(q<HTMLInputElement>("#photo-file").validationMessage).toBe("Photos must be JPG or PNG.");
    await choosePhoto(PNG, "big.png", 5 * 1024 * 1024); expect(q<HTMLInputElement>("#photo-file").validationMessage).toBe("That photo is larger than 4 MB. Choose a smaller one.");
    for (const n of [1, 2, 3]) await choosePhoto(PNG, `p${n}.png`);
    expect(q("#photo-count").textContent).toBe("3 of 3 photos"); expect(q<HTMLInputElement>("#photo-file").disabled).toBe(true);
    fillValid(); await submit();
    expect((document.querySelector("#photos [name=photoAlt]") as HTMLInputElement).validationMessage).toBe("Describe the photo in a few words (for people who cannot see it).");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("sending: pending only, through the app", () => {
  it("creates the draft, uploads the photo, saves the contact, submits; the categories and links are folded into the description; then thanks and refreshes", async () => {
    await run(routes((c) => c.method === "POST" && c.path === "/api/contributions" ? reply({ success: true, id: 42, status: "draft" }, 201)
      : c.path === "/api/contributions/42/photos" ? reply({ success: true, photo: { id: 1 } }, 201)
      : c.path === "/api/contributions/42/contact" ? reply({ success: true })
      : c.path === "/api/contributions/42/submit" ? reply({ success: true, id: 42, status: "pending_review" }) : undefined));
    fillValid();
    const panel = addLink("Website", "https://example.org/club", "Club page with photos");
    (panel.querySelector("[name=remarks]") as HTMLTextAreaElement).value = "Runs on\nSaturdays";
    await choosePhoto(PNG, "club.png");
    (document.querySelector("#photos [name=photoAlt]") as HTMLInputElement).value = "Students building a robot";
    field("contactName").value = "Asha Rao"; field("contactEmail").value = "asha@example.invalid"; field("shareWithModerators").checked = true;
    await submit();
    expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/contributions", "POST /api/contributions/42/photos", "PUT /api/contributions/42/contact", "POST /api/contributions/42/submit"]);
    const create = calls.find((c) => c.method === "POST" && c.path === "/api/contributions")!.body;
    expect(create).toMatchObject({ type: "resource", sectors: ["education"], title: "Weekend robotics club", role: "Teacher / lab in-charge", district: "", website: "" });
    expect(create.description).toBe("A free weekend club where students build simple robots.\n\nDirectory categories: Projects\n[Projects] Remarks: Runs on Saturdays\n[Projects] Link 1 (Website): https://example.org/club - Club page with photos");
    expect(calls.find((c) => c.path.endsWith("/photos"))!.body.alt).toBe("Students building a robot");
    expect(calls.find((c) => c.path.endsWith("/contact"))!.body).toEqual({ name: "Asha Rao", email: "asha@example.invalid", phone: "", shareWithModerators: true });
    expect(q("#message").textContent).toMatch(/sent for review\. It stays pending and is not public until it is approved/);
    expect(field("title").value).toBe(""); expect(q("#photo-count").textContent).toBe("0 of 3 photos");
    expect(calls.filter((c) => c.path === "/api/contributions/mine").length).toBe(2); // refreshed after sending
  });
  it("a duplicate answer from the app is shown as a friendly message on the title; the draft is kept and the next try edits it", async () => {
    let n = 0;
    await run(routes((c) => c.method === "POST" && c.path === "/api/contributions" ? reply({ success: true, id: 50, status: "draft" }, 201)
      : c.method === "PATCH" && c.path === "/api/contributions/50" ? reply({ success: true, id: 50, status: "draft" })
      : c.path === "/api/contributions/50/submit" ? (++n === 1 ? reply({ success: false, error: "DUPLICATE", message: "Something with the same title is already waiting or published in this sector. Please check it, or give yours a clearer title.", fieldErrors: { title: "This title is already used in this sector." } }, 409) : reply({ success: true, id: 50, status: "pending_review" })) : undefined));
    fillValid(); await submit();
    expect(q("#message").textContent).toMatch(/already waiting or published in this sector.*Your draft is saved/);
    expect(field("title").validationMessage).toBe("This title is already used in this sector.");
    field("title").value = "Weekend robotics club for girls"; await submit();
    expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/contributions", "POST /api/contributions/50/submit", "PATCH /api/contributions/50", "POST /api/contributions/50/submit"]);
    expect(q("#message").textContent).toMatch(/sent for review/);
  });
  it("signing out calls the app and shows the Sign In box again", async () => {
    await run(routes((c) => c.path === "/api/auth/logout" ? reply({ success: true }) : undefined));
    q<HTMLButtonElement>("#sign-out").click(); await flush();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/auth/logout")).toBe(true);
    expect(q("#guest").hidden).toBe(false); expect(q("#member-area").hidden).toBe(true);
  });
});

describe("the WordPress side (static)", () => {
  it("the switch: only an explicit true turns it on; only the listed pages; the Contact page can never be switched", () => {
    expect(PHP).toContain("defined( 'RV_CONTRIBUTION_V2' ) && true === RV_CONTRIBUTION_V2");
    expect(PHP).toContain("'contribution,contributor'");
    expect(PHP).toContain("array( 'contact-us', 'contact' )");
    expect(PHP).toMatch(/add_filter\(\s*'the_content'[\s\S]*PHP_INT_MAX/);
    expect(PHP).toContain("if ( ! rv_c2_enabled() ) {\n\t\t\treturn '';"); // the shortcode also stays empty while off
  });
  it("stores nothing and holds no secrets: no options, no database, no cookies, no browser storage, no keys or real addresses", () => {
    expect(PHP).not.toMatch(/update_option|add_option|\$wpdb|setcookie|set_transient|wp_insert_post|wp_remote_/);
    expect(SCRIPT).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    for (const s of [PHP, SCRIPT, MARKUP, CSS]) expect(s).not.toMatch(/sk_live|npg_|AKIA|BEGIN (RSA|PRIVATE)|postgres(ql)?:\/\/|password\s*[:=]/i);
    expect(PHP + SCRIPT + MARKUP).not.toMatch(/techytree\.in|vercel\.app|neon\.tech/);
  });
  it("the styles are scoped to the form so the rest of the page cannot change", () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
    for (const r of rules) { const sel = r.split("{")[0]!.replace(/@media\([^)]*\)\s*/, "").trim(); if (sel) expect(sel.split(",").every((s) => s.trim().startsWith(".rv-c2")), sel).toBe(true); }
  });
  it("markup has no inline script and only one main area (the theme's)", () => {
    expect(MARKUP).not.toMatch(/<script|<main|<header/);
  });
});
