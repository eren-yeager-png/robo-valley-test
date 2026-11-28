#!/usr/bin/env node
// The throw-away local stack for the contribution workflow's end-to-end checks. THIS COMPUTER ONLY: every port is bound to 127.0.0.1,
// every secret is made up at run time (.state/, never printed), and nothing here can reach a live database or website.
//   node tools/contribution-e2e/rig.mjs up          everything below, in order (pg-up, build, app-up, wp-up)
//   node tools/contribution-e2e/rig.mjs pg-up       Postgres container + base schema + every migration + the made-up people and data
//   node tools/contribution-e2e/rig.mjs build       next build of this checkout against the throw-away database
//   node tools/contribution-e2e/rig.mjs app-up      next start on 127.0.0.1 (APP port)      app-down: stop it
//   node tools/contribution-e2e/rig.mjs wp-up       WordPress + MariaDB with Astra, the sector pages and the three plugins
//   node tools/contribution-e2e/rig.mjs wp <args>   WP-CLI on the throw-away site, e.g. "wp option get rv_contrib_switch_over"
//   node tools/contribution-e2e/rig.mjs status      what is running
//   node tools/contribution-e2e/rig.mjs down        stop and delete all of it (only containers carrying this tool's label) and the secrets
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP, C, ROOT, STATE, TOOLS, WP, appEnv, assertLocal, baseEnv, databaseUrl, dropSecrets, secrets } from "./lib/config.mjs";
import { docker, exists, installPlugin, run, running, sqlFile, tryRun, wp, wpExtra } from "./lib/docker.mjs";
import { seed } from "./lib/seed.mjs";

const LABEL = "rvcw-e2e=1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const ours = (name) => (tryRun("docker", ["inspect", "-f", "{{index .Config.Labels \"rvcw-e2e\"}}", name]) || "") === "1";
const removeOurs = (...names) => { for (const n of names) { if (!exists(n)) continue; if (!ours(n)) throw new Error(`ABORT: a container named ${n} exists but was not made by this tool; rename it or set the RV_E2E_* names.`); docker("rm", "-f", "-v", n); } };
const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const pidFile = join(STATE, "app.pid");

async function until(what, fn, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return; } catch { /* not yet */ } await sleep(1500); }
  throw new Error(`timed out waiting for ${what}`);
}
const answers = async (url, want = (s) => s < 500) => want((await fetch(url, { redirect: "manual" })).status);

function requireDocker() {
  if (tryRun("docker", ["version", "--format", "{{.Server.Version}}"]) === null) throw new Error("Docker is not running (docker version failed). Start Docker Desktop or the Docker service first.");
}

async function pgUp() {
  requireDocker();
  assertLocal(databaseUrl());
  if (!running(C.pg.container)) {
    removeOurs(C.pg.container);
    docker("run", "-d", "--name", C.pg.container, "--label", LABEL, "-p", `127.0.0.1:${C.pg.port}:5432`,
      "-e", `POSTGRES_USER=${C.pg.db}`, "-e", `POSTGRES_PASSWORD=${secrets().db}`, "-e", `POSTGRES_DB=${C.pg.db}`, C.pg.image);
  }
  // over TCP: the image's first-start server listens on a socket only, so this waits for the real one
  await until("Postgres", () => tryRun("docker", ["exec", C.pg.container, "pg_isready", "-h", "127.0.0.1", "-U", C.pg.db, "-d", C.pg.db]) !== null);
  const has = tryRun("docker", ["exec", C.pg.container, "psql", "-U", C.pg.db, "-d", C.pg.db, "-tA", "-c", "SELECT to_regclass('users') IS NOT NULL"]);
  if (has !== "t") {
    const base = readFileSync(join(ROOT, "db", "base_schema_local.sql"), "utf8").replaceAll("robovalley_dev", C.pg.db);
    sqlFile(base);
    log("base schema applied");
  }
  const mig = spawnSync(process.execPath, ["scripts/migrate.mjs", "--expect-db", C.pg.db, "--apply"], { cwd: ROOT, env: { ...baseEnv(), DATABASE_URL: databaseUrl() }, encoding: "utf8" });
  writeFileSync(join(STATE, "migrate.log"), (mig.stdout || "") + (mig.stderr || ""));
  if (mig.status !== 0) throw new Error("the migrations failed; see tools/contribution-e2e/.state/migrate.log");
  log(`migrations: ${((mig.stdout || "").match(/^Skipping /gm) || []).length} already applied, the rest applied now (log in .state/migrate.log)`);
  await seed();
  log(`Postgres ready on 127.0.0.1:${C.pg.port} (database ${C.pg.db}) with the made-up people and data`);
}

function build() {
  const envFile = join(ROOT, "next-env.d.ts"), before = existsSync(envFile) ? readFileSync(envFile, "utf8") : null;
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    r = spawnSync(process.execPath, [nextBin, "build"], { cwd: ROOT, env: appEnv(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    writeFileSync(join(STATE, "build.log"), (r.stdout || "") + (r.stderr || ""));
    // Next.js can stop the very first build once with a notice; the same command then continues
    if (r.status === 0 || !/SecurityFatalError/.test((r.stdout || "") + (r.stderr || ""))) break;
  }
  if (before !== null && readFileSync(envFile, "utf8") !== before) writeFileSync(envFile, before); // next build may rewrite it; keep the checkout clean
  if (r.status !== 0) throw new Error("next build failed; see tools/contribution-e2e/.state/build.log");
  log("next build: done (log in .state/build.log)");
}

async function appUp() {
  assertLocal(APP);
  if (await answers(`${APP}/login`).catch(() => false)) { log(`the app already answers at ${APP}`); return; }
  mkdirSync(STATE, { recursive: true });
  const out = openSync(join(STATE, "app.log"), "a");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(C.app.port), "-H", "127.0.0.1"], { cwd: ROOT, env: appEnv(), detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.unref();
  closeSync(out);
  writeFileSync(pidFile, String(child.pid));
  await until("the app", () => answers(`${APP}/login`, (s) => s === 200), 90000);
  log(`the app answers at ${APP} (log in .state/app.log)`);
}

function appDown() {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  try {
    if (process.platform === "win32") run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    else process.kill(-pid, "SIGTERM");
  } catch { /* already stopped */ }
  rmSync(pidFile, { force: true });
  log("the app is stopped");
}

const RT = (title) => `<div class="rv-rt"><h3>About this sector</h3><p>${title} robots help with the heavy, repetitive work. This rich-text block is long on purpose, so the page scrolls.</p>`
  + Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i + 1}: robots in this sector are tested with farmers, teachers and students before they are recommended.</p>`).join("")
  + "<p>https://example.com/averyveryveryveryveryveryveryveryveryveryverylongaddresswithoutanyspaceatallinit/more/more/more/more</p>"
  // a genuinely wide table (ten columns of long single words): wider than a phone and than the content column, so it must scroll in its card
  + "<table><tr>" + ["Robot", "Availability", "Electricity", "Maintenance", "Certification", "Installation", "Subscription", "Accessories", "Warranty", "Manufacturer"].map((h) => `<th>${h}</th>`).join("") + "</tr>"
  + "<tr>" + ["Milking", "Everywhere", "Single-phase", "Quarterly", "Recommended", "Professional", "Optional", "Included", "Two-years", "Independent"].map((c) => `<td>${c}</td>`).join("") + "</tr></table></div>"
  + `<div class="rv-rt"><h3>Milking robots</h3><p>Robots that milk cows on their own schedule.</p></div>`
  + `<div class="rv-rt"><h3>Drone sprayers</h3><p>Drones that spray only where it is needed.</p></div>`
  + `<div class="rv-rt"></div>`;

async function wpUp() {
  requireDocker();
  assertLocal(WP);
  const s = secrets();
  if (!exists(C.wp.container)) {
    removeOurs(C.wp.db);
    if (tryRun("docker", ["network", "inspect", C.wp.net]) === null) docker("network", "create", "--label", LABEL, C.wp.net);
    docker("run", "-d", "--name", C.wp.db, "--label", LABEL, "--network", C.wp.net, "-e", "MARIADB_RANDOM_ROOT_PASSWORD=1", "-e", "MARIADB_DATABASE=wp", "-e", "MARIADB_USER=wp", "-e", `MARIADB_PASSWORD=${s.wpdb}`, C.wp.dbImage);
    docker("run", "-d", "--name", C.wp.container, "--label", LABEL, "--network", C.wp.net, "-p", `127.0.0.1:${C.wp.port}:80`,
      "-e", `WORDPRESS_DB_HOST=${C.wp.db}`, "-e", "WORDPRESS_DB_USER=wp", "-e", `WORDPRESS_DB_PASSWORD=${s.wpdb}`, "-e", "WORDPRESS_DB_NAME=wp", "-e", `WORDPRESS_CONFIG_EXTRA=${wpExtra()}`, C.wp.image);
  }
  await until("WordPress", () => answers(`${WP}/wp-admin/install.php`));
  await sleep(5000);
  const copyFrom = (kind, name) => {
    const tmp = join(STATE, "wpcopy", name);
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(join(STATE, "wpcopy"), { recursive: true });
    if (tryRun("docker", ["cp", `${C.wp.themeFrom}:/var/www/html/wp-content/${kind}/${name}`, tmp]) === null) return false;
    docker("cp", tmp, `${C.wp.container}:/var/www/html/wp-content/${kind}/`);
    rmSync(tmp, { recursive: true, force: true });
    return true;
  };
  if (C.wp.themeFrom) { copyFrom("themes", "astra"); copyFrom("plugins", "elementor"); }
  docker("exec", C.wp.container, "chown", "-R", "www-data:www-data", "/var/www/html/wp-content");
  const wpTry = (args) => { try { return wp(args); } catch { return null; } };
  let installed = wpTry(["core", "is-installed"]) !== null;
  for (let i = 0; i < 8 && !installed; i++) {
    installed = /Success/.test(wpTry(["core", "install", `--url=${WP}`, "--title=Local", "--admin_user=local", `--admin_password=${s.wpadmin}`, "--admin_email=local@example.com", "--skip-email"]) || "");
    if (!installed) await sleep(5000);
  }
  if (!installed) throw new Error("WordPress could not be installed");
  const has = (kind, name) => (tryRun("docker", ["exec", C.wp.container, "ls", `/var/www/html/wp-content/${kind}`]) || "").split(/\s+/).includes(name);
  if (!has("themes", "astra")) wp(["theme", "install", "astra"]); // from wordpress.org (the only host the site may reach)
  if (!has("plugins", "elementor") && wpTry(["plugin", "install", "elementor"]) === null) log("Elementor could not be installed (optional): continuing without it");
  wp(["theme", "activate", "astra"]);
  if (has("plugins", "elementor")) wpTry(["plugin", "activate", "elementor"]);
  wp(["rewrite", "structure", "/%postname%/", "--hard"]);

  if (!wp(["post", "list", "--post_type=page", "--name=robots-by-sector", "--field=ID"]).trim()) {
    const page = (title, name, content, parent = 0) => wp(["post", "create", "--post_type=page", "--post_status=publish", `--post_title=${title}`, `--post_name=${name}`, `--post_content=${content}`, `--post_parent=${parent}`, "--porcelain"]).trim().split("\n").pop();
    const parent = page("Robots by Sector", "robots-by-sector", "<p>Every sector.</p>");
    page("Agriculture and Dairy", "agriculture-dairy", RT("Agriculture and Dairy"), parent);
    const b = page("Education", "education", RT("Education"), parent);
    const c = page("Healthcare", "healthcare", "<p>Content of a sector page whose title is switched off.</p>", parent);
    for (const x of [b, c]) { wp(["post", "meta", "update", x, "site-content-layout", "page-builder"]); wp(["post", "meta", "update", x, "ast-site-content-layout", "full-width-container"]); }
    wp(["post", "meta", "update", c, "site-post-title", "disabled"]);
    page("About us", "about-us", "<section><h3>Not a sector page</h3><p>No contribute buttons here.</p></section>");
    page("Contribute now", "contribute-now", "<p>The page text before the plugin switches it.</p>");
    wp(["post", "create", "--post_type=post", "--post_status=publish", "--post_title=A news post", "--post_name=news", "--post_content=<p>Text</p>"]);
  }
  const plugins = [["rv-contribution-v2", join(ROOT, "frontend", "wordpress", "plugins", "rv-contribution-v2")],
    ["robovalley-contribution", join(ROOT, "frontend", "wordpress", "plugins", "robovalley-contribution")],
    ["rv-e2e-dummy-fields", join(TOOLS, "wp-plugins", "rv-e2e-dummy-fields")]];
  for (const [name, dir] of plugins) installPlugin(name, dir);
  log(`WordPress ready at ${WP} (Astra; sector pages; plugins: ${plugins.map((p) => p[0]).join(", ")})`);
}

function wpDown() { removeOurs(C.wp.container, C.wp.db); tryRun("docker", ["network", "rm", C.wp.net]); rmSync(join(STATE, "wpcopy"), { recursive: true, force: true }); log("WordPress removed"); }
function pgDown() { removeOurs(C.pg.container); log("Postgres removed"); }

async function status() {
  for (const n of [C.pg.container, C.wp.container, C.wp.db]) log(`${n}: ${running(n) ? "running" : exists(n) ? "stopped" : "absent"}`);
  log(`app ${APP}: ${(await answers(`${APP}/login`, (s) => s === 200).catch(() => false)) ? "answers" : "not running"}`);
}

const cmd = process.argv[2];
try {
  mkdirSync(STATE, { recursive: true });
  if (cmd === "up") { await pgUp(); build(); await appUp(); await wpUp(); }
  else if (cmd === "pg-up") await pgUp();
  else if (cmd === "build") build();
  else if (cmd === "app-up") await appUp();
  else if (cmd === "app-down") appDown();
  else if (cmd === "wp-up") await wpUp();
  else if (cmd === "wp-down") wpDown();
  else if (cmd === "pg-down") pgDown();
  else if (cmd === "wp") log(wp(process.argv.slice(3)));
  else if (cmd === "status") await status();
  else if (cmd === "down") { appDown(); wpDown(); pgDown(); dropSecrets(); log("everything removed, secrets deleted"); }
  else { log("usage: node tools/contribution-e2e/rig.mjs up | pg-up | build | app-up | app-down | wp-up | wp-down | pg-down | wp <args> | status | down"); process.exitCode = 2; }
} catch (e) {
  console.error(String(e?.message || e));
  process.exitCode = 1;
}
