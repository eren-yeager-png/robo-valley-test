// @vitest-environment jsdom
// The WordPress plugin "RoboValley Contribution (v2)": the owner's form wired to the app API. The network is faked; nothing real is
// contacted. The PHP side is checked statically here (the switch, the pages, no storage, no secrets) and was run on a local test site.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateContributeReturn } from "../src/lib/contributeReturnTo";

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
async function run(r: (c: Call) => Response | undefined, base: string | null = BASE, script = SCRIPT, markup = MARKUP) {
  document.body.innerHTML = markup;
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
  (0, eval)(script);
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
  const file = new File([bytes as unknown as BlobPart], name);
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
    expect(PHP).toContain("'contribute-now,contribution,contributor'"); // 0.1.2: the form page /contribute-now/ is the default and comes first
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

describe("?sector= preselects sectors (the Contribute to this sector link)", () => {
  const ticked = () => Array.from(document.querySelectorAll<HTMLInputElement>('#sector-choices input[name="sector"]')).filter((i) => i.checked).map((i) => i.value);
  const at = async (search: string) => { history.replaceState(null, "", "/contribution/" + search); await run(routes()); };
  afterEach(() => history.replaceState(null, "", "/"));
  it("ticks the named sector, or several, and nothing else", async () => {
    await at("?sector=education"); expect(ticked()).toEqual(["education"]);
    await at("?sector=agriculture-dairy,education"); expect(ticked()).toEqual(["agriculture-dairy", "education"]);
  });
  it("ignores unknown names, markup, too-long values and other parameters; ticks nothing without the parameter", async () => {
    await at("?sector=nope"); expect(ticked()).toEqual([]);
    await at("?sector=%3Cimg%20src=x%3E"); expect(ticked()).toEqual([]);
    await at("?sector=Education"); expect(ticked()).toEqual([]);
    await at("?other=education"); expect(ticked()).toEqual([]);
    await at(""); expect(ticked()).toEqual([]);
  });
  it("the ticked sector is what is sent", async () => {
    await at("?sector=education");
    field("title").value = "Weekend robotics club"; field("description").value = "A free weekend club where students build simple robots.";
    const p = q<HTMLInputElement>('#choices input[value="Projects"]'); p.checked = true; p.dispatchEvent(new Event("change"));
    await submit();
    const create = calls.find((c) => c.method === "POST" && c.path === "/api/contributions");
    expect(create?.body.sectors).toEqual(["education"]);
  });
  it("the plugin version moved to 0.1.6 so browsers fetch the new script", () => {
    expect(PHP).toMatch(/Version: 0\.1\.6/); expect(PHP).toMatch(/RV_C2_VERSION = '0\.1\.6'/);
  });
});

describe("Sign In and Sign Up keep the sector (0.1.3)", () => {
  // jsdom cannot navigate, so this copy of the script records the address instead of going there (only these two lines differ)
  const SPY = SCRIPT.replace(/location\.href = /g, "window.__rvNav = ");
  const signedOut = { role: null, firstName: null, stakeholder: null };
  const leave = async (search: string, button = "#sign-in") => {
    history.replaceState(null, "", "/contribute-now/" + search);
    await run(routes(undefined, signedOut), BASE, SPY);
    q<HTMLButtonElement>(button).click();
    const to = new URL((window as any).__rvNav);
    expect(to.origin).toBe(BASE);
    return { path: to.pathname, back: to.searchParams.get("returnTo") as string };
  };
  const page = () => `${location.origin}/contribute-now/`;
  afterEach(() => { history.replaceState(null, "", "/"); delete (window as any).__rvNav; });
  it("only the two sign-in navigations are swapped for the recorder", () => {
    expect(SCRIPT.match(/location\.href = /g)).toHaveLength(2);
  });
  it("arriving from Contribute to this sector, signing in or up returns to the form with the same sector", async () => {
    expect(await leave("?sector=agriculture-dairy")).toEqual({ path: "/login", back: page() + "?sector=agriculture-dairy" });
    expect(await leave("?sector=agriculture-dairy,education", "#sign-up")).toEqual({ path: "/join", back: page() + "?sector=agriculture-dairy,education" });
    expect((await leave("?sector=agriculture-dairy&utm=x")).back).toBe(page() + "?sector=agriculture-dairy"); // only the sector is carried
  });
  it("a value the app would refuse is dropped, so the visitor still comes back to the page (not the home page)", async () => {
    const many = Array.from({ length: 21 }, (_, i) => "s" + i).join(",");
    for (const bad of ["a,a", "-x", "a--b", "x,", "a".repeat(61), many]) {
      expect(validateContributeReturn(page() + "?sector=" + bad, location.origin, "/contribute-now/"), bad).toBeNull();
      expect((await leave("?sector=" + bad)).back, bad).toBe(page());
    }
    for (const none of ["", "?sector=Education", "?other=education"]) expect((await leave(none)).back, none).toBe(page());
  });
  it("every address the form sends back is one the app accepts unchanged", async () => {
    for (const s of ["", "?sector=agriculture-dairy", "?sector=agriculture-dairy,education", "?sector=" + "a".repeat(60), "?sector=a,a"]) {
      const { back } = await leave(s);
      expect(validateContributeReturn(back, location.origin, "/contribute-now/"), s).toBe(back);
    }
  });
});

describe("Contribute to this sector (0.1.2, static; run on a local WordPress too)", () => {
  it("only on child pages of the Robots by Sector page, using the page slug as the sector", () => {
    expect(PHP).toContain("'robots-by-sector'");
    expect(PHP).toContain("RV_CONTRIBUTION_SECTOR_PARENT");
    expect(PHP).toMatch(/\$parent->post_name !== \$parent_slug/);
    expect(PHP).toContain("return sanitize_title( $page->post_name );");
  });
  it("shows only while the form is on and RV_CONTRIBUTE_PUBLIC is true, and never to WordPress administrators (0.1.4)", () => {
    expect(PHP).toContain("if ( ! rv_c2_enabled() || '' === rv_c2_sector_slug() ) {");
    expect(PHP).toContain("return defined( 'RV_CONTRIBUTE_PUBLIC' ) && true === RV_CONTRIBUTE_PUBLIC && ! rv_c2_is_wp_admin();");
    expect(PHP).not.toContain("|| current_user_can( 'manage_options' )");
  });
  it("links to the first form page with ?sector=, escaped, with the reference wording and plus icon, once per page", () => {
    expect(PHP).toContain("add_query_arg( 'sector', rv_c2_sector_slug(), home_url( '/' . ( $slugs ? $slugs[0] : 'contribute-now' ) . '/' ) )");
    expect(PHP).toContain("esc_url( $url )");
    expect(PHP).toContain("Contribute to this sector</a>");
    expect(PHP).toContain('<path d="M12 5v14M5 12h14"></path>');
    expect(PHP).toContain("false !== strpos( $content, 'rv-c2-sector-cta' )");
  });
  it("looks like the reference: outline button in #237A33, 44 px tall, radius 8, bold; with a hover and a visible focus ring", () => {
    expect(PHP).toContain("border:1.5px solid #237A33;border-radius:8px;color:#237A33");
    expect(PHP).toContain("min-height:44px");
    expect(PHP).toContain(".rv-c2-sector-btn:hover{");
    expect(PHP).toContain(".rv-c2-sector-btn:focus-visible{");
  });
  it("the form page ticks the sector from ?sector= (added in 0.1.1), only sectors that exist", () => {
    expect(SCRIPT).toContain("function preselectSectors()");
  });
});

describe("members contribute, administrators review (0.1.4)", () => {
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  it("the member form's markup and styles are byte-for-byte the 0.1.3 files (only the script changed)", () => {
    expect(sha(MARKUP)).toBe("26285aea36f400c70864cad144f67d0b2fdc9b1f1b7b93a33b73ece69cc2d046");
    expect(sha(CSS)).toBe("1b897db635e89d8f004b6fd5c4bb5e466860aedda0e857a9cc133a3b996af11a");
  });
  it("WordPress administrators get a note with a Moderation link instead of the form, and no form script (static; also run in PHP)", () => {
    expect(PHP).toContain("function rv_c2_is_wp_admin() {\n\treturn function_exists( 'current_user_can' ) && current_user_can( 'manage_options' );");
    expect(PHP).toContain("return rv_c2_is_wp_admin() ? rv_c2_admin_note() : rv_c2_markup( false );");
    expect(PHP).toContain("if ( rv_c2_is_target_page() && ! rv_c2_is_wp_admin() ) {\n\t\t\trv_c2_enqueue();");
    expect(PHP).toContain("if ( rv_c2_is_wp_admin() ) {\n\t\t\treturn rv_c2_admin_note();\n\t\t}\n\t\t$atts = shortcode_atts(");
    expect(PHP).toContain("esc_url( $app . '/moderation' )");
    expect(PHP).toContain("esc_html( 'You are signed in to WordPress as an administrator, so the Contribute form is hidden here");
  });
  it("signed in to the app as a reviewer: a note with a Moderation link and Sign Out instead of the form; nothing else is asked", async () => {
    await run(routes(undefined, { role: "admin", firstName: "Ola", stakeholder: null, reviewer: true }));
    expect(q("#member-area").hidden).toBe(true);
    expect(q("#guest").hidden).toBe(true);
    const note = q("#rv-c2-reviewer");
    expect(note.textContent).toContain("You are signed in to RoboValley as an administrator or moderator. Reviewers do not send contributions");
    expect(note.querySelector("a")!.getAttribute("href")).toBe(BASE + "/moderation");
    expect(calls.map((c) => c.path)).toEqual(["/api/auth/me"]); // no sectors, no My Contributions, no drafts
    (note.querySelector("button") as HTMLButtonElement).click();
    await flush();
    expect(calls.at(-1)).toMatchObject({ path: "/api/auth/logout", method: "POST" });
    expect(document.querySelector("#rv-c2-reviewer")).toBeNull();
    expect(q("#guest").hidden).toBe(false);
  });
  it("a flagged moderator with a member profile is a reviewer too (the app says reviewer: true)", async () => {
    await run(routes(undefined, { role: "user", firstName: "Mo", stakeholder: "Teacher / lab in-charge", reviewer: true }));
    expect(q("#member-area").hidden).toBe(true);
    expect(q("#rv-c2-reviewer")).not.toBeNull();
  });
  it("a member (reviewer: false) sees exactly the 0.1.3 form", async () => {
    await run(routes(undefined, { role: "user", firstName: "Asha", stakeholder: "Teacher / lab in-charge", reviewer: false }));
    expect(q("#member-area").hidden).toBe(false);
    expect(document.querySelector("#rv-c2-reviewer")).toBeNull();
    expect(q("#member-name").textContent).toBe("Asha");
    expect(q("#history").textContent).toContain("Waiting one · Agriculture & Dairy · Pending review");
    expect(document.querySelectorAll("#history .hint").length).toBe(1); // only the rejected item's reason, as before
  });
  it("My Contributions shows every reply under its item, whatever the status, and the app's 'Replied' label", async () => {
    const withReplies = { ...MINE, items: [
      { id: 7, title: "Waiting one", status: "pending_review", statusLabel: "Replied", sectors: [], note: null, replies: [{ message: "Thanks, could you add a photo?", at: "2026-11-11T10:00:00.000Z" }] },
      { id: 8, title: "Live one", status: "published", statusLabel: "Published", sectors: [], note: null, replies: [{ message: "First reply", at: "2026-11-10T10:00:00.000Z" }, { message: "Second reply <b>not bold</b>", at: "2026-11-11T09:00:00.000Z" }] },
      { id: 9, title: "Not this time", status: "rejected", statusLabel: "Not accepted", sectors: [], note: "This reads as an advert.", replies: [] },
    ] };
    await run(routes((c) => (c.path === "/api/contributions/mine" ? reply(withReplies) : undefined)));
    const rows = Array.from(document.querySelectorAll("#history li"));
    expect(rows[0]!.textContent).toContain("Waiting one · Replied");
    expect(rows[0]!.textContent).toContain("Reply from RoboValley: Thanks, could you add a photo?");
    expect(Array.from(rows[1]!.querySelectorAll(".hint")).map((h) => h.textContent)).toEqual(["Reply from RoboValley: First reply", "Reply from RoboValley: Second reply <b>not bold</b>"]);
    expect(rows[1]!.querySelector("b")).toBeNull(); // text, never HTML
    expect(Array.from(rows[2]!.querySelectorAll(".hint")).map((h) => h.textContent)).toEqual(["This reads as an advert."]);
  });
  it("if the app refuses a reviewer's submission (403), the form shows the app's message", async () => {
    const msg = "Administrators and moderators review contributions. Please use a member account to contribute.";
    await run(routes((c) => (c.path === "/api/contributions" && c.method === "POST" ? reply({ success: false, error: "REVIEWER_CANNOT_CONTRIBUTE", message: msg }, 403) : undefined)));
    fillValid();
    await submit();
    expect(q("#message").textContent).toContain(msg);
  });
});

describe("structured categories and Edit after changes are requested (0.1.5)", () => {
  const SAVED = { success: true, contribution: {
    id: 55, status: "changes_requested", title: "Solar milking robot", description: "A student team built a small solar milking unit.",
    directory: [
      { category: "Projects", remarks: "Tested for six weeks.", links: [{ type: "Website", url: "https://example.org/milker", gist: "The build log" }] },
      { category: "Events", remarks: "", links: [] },
    ],
    sectors: ["education"], photos: [{ id: 901, position: 1, alt: "The milking unit", mime: "image/png" }],
    contact: { name: "Asha", email: "asha@example.com", phone: null, shareWithModerators: true },
  } };
  const WITH_CHANGES = { ...MINE, items: [...MINE.items, { id: 55, title: "Solar milking robot", status: "changes_requested", statusLabel: "Changes requested", sectors: [], note: "Please add the district.", replies: [] }] };
  const editRoutes = (extra: (c: Call) => Response | undefined = () => undefined) => routes((c) => extra(c) ?? (c.path === "/api/contributions/mine" ? reply(WITH_CHANGES) : c.path === "/api/contributions/55" && c.method === "GET" ? reply(SAVED) : undefined));
  const openEdit = async () => {
    await run(editRoutes((c) => (c.method === "PATCH" ? reply({ success: true, id: 55, status: "changes_requested" }) : c.path.startsWith("/api/contributions/55/photos") && c.method === "DELETE" ? reply({ success: true }) : c.path === "/api/contributions/55/contact" ? reply({ success: true }) : c.path === "/api/contributions/55/submit" ? reply({ success: true, id: 55, status: "pending_review" }) : undefined)));
    const edit = Array.from(document.querySelectorAll<HTMLButtonElement>("#history button.rv-c2-edit"));
    expect(edit).toHaveLength(1);
    edit[0]!.click();
    await flush();
  };

  it("the payload carries the categories, remarks and links as structured data, and the folded text as before", async () => {
    await run(routes((c) => (c.path === "/api/contributions" && c.method === "POST" ? reply({ success: true, id: 41, status: "draft" }, 201) : c.path.endsWith("/submit") ? reply({ success: true, id: 41, status: "pending_review" }) : undefined)));
    fillValid();
    addLink("Website", "https://example.org/club", "Our club page");
    (document.querySelector(".category-details:not([hidden]) [name=remarks]") as HTMLTextAreaElement).value = "  Open   on Saturdays ";
    await submit();
    const create = calls.find((c) => c.path === "/api/contributions" && c.method === "POST")!;
    expect(create.body.directory).toEqual([{ category: "Projects", remarks: "Open on Saturdays", links: [{ type: "Website", url: "https://example.org/club", gist: "Our club page" }] }]);
    expect(create.body.description).toContain("Directory categories: Projects");
    expect(create.body.description).toContain("[Projects] Link 1 (Website): https://example.org/club - Our club page");
  });
  it("Edit appears only for an item with Changes requested", async () => {
    await run(editRoutes());
    const rows = Array.from(document.querySelectorAll("#history li"));
    expect(rows.map((r) => !!r.querySelector("button.rv-c2-edit"))).toEqual([false, false, false, true]);
    expect(rows[3]!.querySelector("button")!.getAttribute("aria-label")).toBe("Edit: Solar milking robot");
  });
  it("Edit fills the same form: title, your words, categories with remarks and links, sectors, the saved photo and the private contact", async () => {
    await openEdit();
    expect(calls.some((c) => c.path === "/api/contributions/55" && c.method === "GET")).toBe(true);
    expect(field("title").value).toBe("Solar milking robot");
    expect(field("description").value).toBe("A student team built a small solar milking unit.");
    const checked = Array.from(document.querySelectorAll<HTMLInputElement>("#choices input")).filter((i) => i.checked).map((i) => i.value);
    expect(checked).toEqual(["Projects", "Events"]);
    const open = Array.from(document.querySelectorAll<HTMLFieldSetElement>(".category-details")).filter((p) => !p.hidden);
    expect(open.map((p) => p.querySelector("legend")!.textContent)).toEqual(["Projects", "Events"]);
    expect((open[0]!.querySelector("[name=remarks]") as HTMLTextAreaElement).value).toBe("Tested for six weeks.");
    const row = open[0]!.querySelector(".references")!.firstElementChild!;
    expect((row.querySelector("select") as HTMLSelectElement).value).toBe("Website");
    expect((row.querySelector("[name=referenceUrl]") as HTMLInputElement).value).toBe("https://example.org/milker");
    expect((row.querySelector("[name=referenceGist]") as HTMLInputElement).value).toBe("The build log");
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("#sector-choices input")).filter((i) => i.checked).map((i) => i.value)).toEqual(["education"]);
    const photo = q("#photos").lastElementChild!;
    expect(photo.querySelector("legend")!.textContent).toBe("Photo 1 · already saved");
    expect((photo.querySelector("input") as HTMLInputElement).value).toBe("The milking unit");
    expect((photo.querySelector("input") as HTMLInputElement).readOnly).toBe(true);
    expect(q("#photo-count").textContent).toBe("1 of 3 photos");
    expect(field("contactName").value).toBe("Asha"); expect(field("contactEmail").value).toBe("asha@example.com");
    expect(field("shareWithModerators").checked).toBe(true);
    expect(q("#rv-c2-editing").textContent).toContain("Editing “Solar milking robot”: make the changes the moderator asked for");
  });
  it("Submit for Review saves the change (PATCH with the structured data), removes a photo you took out, and sends it again", async () => {
    await openEdit();
    (q("#photos").lastElementChild!.querySelector(".remove") as HTMLButtonElement).click();
    field("title").value = "Solar milking robot, Guntur";
    await submit();
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/api/contributions/55");
    expect(patch.body.title).toBe("Solar milking robot, Guntur");
    expect(patch.body.sectors).toEqual(["education"]);
    expect(patch.body.directory.map((d: any) => d.category)).toEqual(["Projects", "Events"]);
    expect(patch.body.description.startsWith("A student team built a small solar milking unit.\n\nDirectory categories: Projects, Events")).toBe(true);
    const after = calls.slice(calls.indexOf(patch) + 1).map((c) => `${c.method} ${c.path}`);
    expect(after).toEqual(["DELETE /api/contributions/55/photos?photoId=901", "PUT /api/contributions/55/contact", "POST /api/contributions/55/submit", "GET /api/contributions/mine"]);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/contributions")).toBe(false); // no new contribution
    expect(document.querySelector("#rv-c2-editing")).toBeNull();
    expect(q("#message").textContent).toContain("sent for review");
  });
  it("Cancel editing empties the form and leaves Edit; an item that is no longer waiting for changes is not opened", async () => {
    await openEdit();
    (q("#rv-c2-editing").querySelector("button") as HTMLButtonElement).click();
    expect(document.querySelector("#rv-c2-editing")).toBeNull();
    expect(field("title").value).toBe("");
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("#choices input")).some((i) => i.checked)).toBe(false);
    expect(q("#photos").querySelectorAll("fieldset").length).toBe(0);
    await run(routes((c) => (c.path === "/api/contributions/mine" ? reply(WITH_CHANGES) : c.path === "/api/contributions/55" ? reply({ success: true, contribution: { ...SAVED.contribution, status: "pending_review" } }) : undefined)));
    (document.querySelector("#history button.rv-c2-edit") as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector("#rv-c2-editing")).toBeNull();
    expect(q("#message").textContent).toBe("This contribution cannot be edited right now.");
  });
});

describe("no Sign Out on the Contribute page (0.1.6)", () => {
  const BUTTON = /const RV_C2_SIGN_OUT_BUTTON = '([^']+)';/.exec(PHP)![1];
  // What the Contribute page serves: the same two replacements rv_c2_markup( false ) makes in PHP (also run in real PHP, see the PR)
  const CONTRIBUTE_PAGE = MARKUP.replace(BUTTON, "").replace('<div class="rv-c2" id="rv-c2">', '<div class="rv-c2" id="rv-c2" data-sign-out="no">');
  const ACCOUNT_JS = readFileSync(join(__dirname, "..", "frontend", "wordpress", "plugins", "robovalley-landing", "assets", "robovalley-account.js"), "utf8");

  it("the PHP removes exactly the banner's button from the markup (it is in the file once), on the server, not with CSS", () => {
    expect(BUTTON).toBe(' <button type="button" id="sign-out">Sign Out</button>');
    expect(MARKUP.split(BUTTON).length).toBe(2); // exactly once, so a change to the HTML cannot silently leave it in
    expect(MARKUP).toContain('<div class="rv-c2" id="rv-c2">');
    expect(CONTRIBUTE_PAGE).not.toContain('id="sign-out"'); expect(CONTRIBUTE_PAGE).not.toContain("Sign Out");
    expect(CONTRIBUTE_PAGE).toContain('<strong id="member-name"></strong> · Registered member</p>'); // the banner text stays
    expect(PHP).toContain("$html = str_replace( RV_C2_SIGN_OUT_BUTTON, '', $html );");
    expect(CSS).not.toMatch(/sign-out/); // not hidden with CSS
  });
  it("only the Contribute page drops it: the switched form pages pass false; the shortcode keeps it unless sign_out=\"no\"", () => {
    expect(PHP).toContain("rv_c2_markup( false ); // the Contribute page: no Sign Out in the banner");
    expect(PHP).toContain("shortcode_atts( array( 'sign_out' => 'yes' )");
    expect(PHP).toContain("return rv_c2_markup( 'no' !== strtolower( trim( (string) $atts['sign_out'] ) ) );");
    expect(PHP).toContain("function rv_c2_markup( $sign_out = true ) {"); // anything else gets the button, as before
  });
  it("a member on the Contribute page: the banner shows the name and 'Registered member', no Sign Out in the page; the form works as before", async () => {
    await run(routes(), BASE, SCRIPT, CONTRIBUTE_PAGE);
    expect(q("#member-area").hidden).toBe(false);
    expect(q("#member-name").textContent).toBe("Asha");
    expect(q("#member-name").parentElement!.textContent).toBe("Asha · Registered member");
    expect(document.querySelector("#sign-out")).toBeNull();
    expect(document.body.textContent).not.toContain("Sign Out");
    expect(q("#sector-choices").querySelectorAll("input").length).toBe(2); // sectors still load
    expect(q("#history").textContent).toContain("Waiting one");
  });
  it("a reviewer on the Contribute page gets the note and the Moderation link, without a Sign Out button", async () => {
    await run(routes(undefined, { role: "admin", firstName: "Ola", stakeholder: null, reviewer: true }), BASE, SCRIPT, CONTRIBUTE_PAGE);
    const note = q("#rv-c2-reviewer");
    expect(note.querySelector("a")!.getAttribute("href")).toBe(BASE + "/moderation");
    expect(note.querySelector("button")).toBeNull();
    expect(document.body.textContent).not.toContain("Sign Out");
  });
  it("anywhere else the form keeps its Sign Out, and the site header's account menu has Sign out for every signed-in user", async () => {
    await run(routes());
    expect(q("#sign-out").textContent).toBe("Sign Out");
    expect(ACCOUNT_JS).toContain("b.textContent = 'Sign out';");
    expect(ACCOUNT_JS).toMatch(/any other signed-in user[^\n]*then "Sign out"/);
    expect(ACCOUNT_JS).not.toMatch(/contribute/i); // the header does not treat the Contribute page differently
  });
});
