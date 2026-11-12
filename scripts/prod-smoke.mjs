#!/usr/bin/env node
// Read-only production smoke test for the RoboValley app (and, optionally, the WordPress site).
//
//   node scripts/prod-smoke.mjs --dry-run --app https://app.example.com            # prints the plan, sends NOTHING
//   node scripts/prod-smoke.mjs --app https://app.example.com [--site https://www.example.com] --production
//
// What it does: a few dozen GET requests, one at a time, with a descriptive User-Agent and a pause between them.
// What it never does: sign in, send a cookie, send a POST/PUT/PATCH/DELETE, submit a form, upload, or load-test.
// Safety: without --production only localhost / 127.0.0.1 is accepted, so a typo cannot reach a real site by accident.
// Exit code: 0 = every check passed, 1 = at least one failed, 2 = bad arguments.
//
// POST-only routes (upload, decisions, Make Moderator) are NOT probed here, because any request to them is a write attempt.
// Their guards are covered by the automated suite (tests/portal-workflow.test.ts, tests/services-upload.test.ts).

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const dry = flag("--dry-run");
const allowProd = flag("--production");
const appRaw = opt("--app");
const siteRaw = opt("--site");
const PAUSE_MS = 400;

function base(raw, label) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { console.error(`${label}: "${raw}" is not a valid address`); process.exit(2); }
  if (u.protocol !== "https:" && u.protocol !== "http:") { console.error(`${label}: only http or https`); process.exit(2); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (!local && !allowProd) { console.error(`${label}: ${u.hostname} is not local. Add --production to confirm you mean a real site.`); process.exit(2); }
  return u.origin;
}
const APP = base(appRaw, "--app");
const SITE = base(siteRaw, "--site");
if (!APP) { console.error("Usage: node scripts/prod-smoke.mjs --app <app address> [--site <website address>] [--production] [--dry-run]"); process.exit(2); }

const ua = "RoboValley-smoke/1 (read-only; GET only; contact the site owner)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each check: name, url, and a function that judges the response. All requests are GET, never follow redirects (so a redirect is visible),
// and never send credentials.
const checks = [];
const add = (group, name, url, judge) => checks.push({ group, name, url, judge });

const noStore = (r) => /no-store/i.test(r.headers.get("cache-control") || "");
const locationPath = (r) => { const l = r.headers.get("location"); if (!l) return null; try { return new URL(l, "http://x").pathname; } catch { return l; } };

// 1. public pages load
if (SITE) {
  for (const p of ["/", "/find-a-service/", "/contribute-now/", "/robots-by-sector/"]) {
    add("Public website", `GET ${p} loads`, SITE + p, (r) => r.status === 200 ? null : `expected 200, got ${r.status}`);
  }
}
for (const p of ["/login", "/join"]) add("Public app pages", `GET ${p} loads`, APP + p, (r) => r.status === 200 ? null : `expected 200, got ${r.status}`);

// 2. public data
add("Public data", "GET /api/contributions/sectors returns the sector list with counts", APP + "/api/contributions/sectors", async (r) => {
  if (r.status !== 200) return `expected 200, got ${r.status}`;
  const b = await r.json().catch(() => null);
  if (!b || b.success !== true || !Array.isArray(b.sectors) || b.sectors.length === 0) return "no sectors in the answer";
  if (!b.sectors.every((s) => typeof s.slug === "string" && Number.isInteger(s.contributions))) return "a sector is missing slug or contributions count";
  return null;
});
add("Public data", "GET /api/services/categories answers", APP + "/api/services/categories", (r) => r.status === 200 ? null : `expected 200, got ${r.status}`);
add("Public data", "GET /api/services/search (PIN search) answers with success", APP + "/api/services/search?pincode=520010&radius=5", async (r) => {
  if (r.status !== 200) return `expected 200, got ${r.status}`;
  const b = await r.json().catch(() => null); return b && b.success === true ? null : "success is not true";
});

// 3. /api/db-test: only success or failure, nothing about the database
add("Information leaks", "GET /api/db-test says only success/failure and message (no database name), not cached", APP + "/api/db-test", async (r) => {
  const b = await r.json().catch(() => null);
  if (!b) return "not JSON";
  const keys = Object.keys(b).sort().join(",");
  if (keys !== "message,success") return `unexpected fields: ${keys}`;
  if (!noStore(r)) return "missing Cache-Control: no-store";
  if (r.status !== 200 && r.status !== 500) return `unexpected status ${r.status}`;
  if (/postgres|neon|supabase|database_url|password/i.test(JSON.stringify(b).replace(/Database connect(ed|ion failed)/g, ""))) return "answer mentions the database";
  return null;
});

// 4. admin and moderation pages send signed-out visitors to /login
for (const p of ["/admin/dashboard", "/admin/users", "/admin/upload", "/admin/datasets", "/admin/reports", "/admin/settings", "/moderation"]) {
  add("Signed-out visitors cannot open admin pages", `GET ${p} redirects to /login`, APP + p, (r) => {
    if (![302, 303, 307, 308].includes(r.status)) return `expected a redirect, got ${r.status}`;
    return locationPath(r) === "/login" ? null : `redirects to ${r.headers.get("location")}`;
  });
}

// 5. API routes answer 401 or 403 without sign-in (GET routes only; POST-only routes are never touched)
for (const p of ["/api/review/queue", "/api/review/1", "/api/contributions/mine", "/api/admin/datasets/1/report", "/api/admin/attachments/smoke"]) {
  add("Signed-out API requests are refused", `GET ${p} is 401/403 and not cached`, APP + p, (r) => {
    if (r.status !== 401 && r.status !== 403) return `expected 401 or 403, got ${r.status}`;
    return noStore(r) ? null : "missing Cache-Control: no-store";
  });
}
add("Signed-out API requests are refused", "GET /api/auth/me says signed out and reveals no personal data", APP + "/api/auth/me", async (r) => {
  const t = await r.text();
  if (r.status >= 500) return `server error ${r.status}`;
  return /@|"email"|"fullName"|"full_name"/.test(t) ? "answer contains personal data" : null;
});

if (dry) {
  console.log(`DRY RUN. ${checks.length} GET requests would be sent, one at a time, to:\n  app:  ${APP}\n  site: ${SITE ?? "(not checked; add --site)"}\n`);
  let g = ""; for (const c of checks) { if (c.group !== g) { g = c.group; console.log(`\n${g}`); } console.log(`  GET ${c.url}`); }
  console.log("\nNo request was sent. No sign-in, no cookie, no write of any kind.");
  process.exit(0);
}

let failed = 0, g = "";
for (const c of checks) {
  if (c.group !== g) { g = c.group; console.log(`\n${g}`); }
  let problem;
  try {
    const r = await fetch(c.url, { method: "GET", redirect: "manual", headers: { "user-agent": ua, accept: "text/html,application/json" }, signal: AbortSignal.timeout(20000) });
    problem = await c.judge(r);
  } catch (e) { problem = `request failed: ${e?.name ?? "error"}`; }
  if (problem) failed++;
  console.log(`  ${problem ? "FAIL" : "PASS"}  ${c.name}${problem ? `  -> ${problem}` : ""}`);
  await sleep(PAUSE_MS);
}
console.log(`\n${checks.length - failed} passed, ${failed} failed (${checks.length} checks, GET only)`);
process.exit(failed ? 1 : 0);
