// Contribution workflow end-to-end tools: names, ports and the throw-away secrets. Everything runs on THIS computer only: one Postgres
// container, one WordPress (+ MariaDB) container pair on their own Docker network, the app (next start) and a headless Chrome or Edge.
// Every container port is bound to 127.0.0.1. Every password and secret is made up at run time, kept in tools/contribution-e2e/.state/
// (ignored by git, never printed) and deleted by "rig.mjs down". Ports and images can be changed with environment variables (README.md).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const TOOLS = join(ROOT, "tools", "contribution-e2e");
export const STATE = join(TOOLS, ".state");
export const OUT = join(TOOLS, "out");

export const C = {
  pg: { container: env.RV_E2E_PG_CONTAINER || "rvcw-e2e-pg", image: env.RV_E2E_PG_IMAGE || "postgres:16-alpine", port: Number(env.RV_E2E_PG_PORT || 55432), db: "rvcw_e2e", migDb: "rvcw_mig" },
  app: { port: Number(env.RV_E2E_APP_PORT || 3041) },
  wp: {
    net: "rvcw-e2e", container: "rvcw-e2e-wp", db: "rvcw-e2e-wpdb", port: Number(env.RV_E2E_WP_PORT || 8099),
    image: env.RV_E2E_WP_IMAGE || "wordpress:7.1.4-php8.2-apache", cli: env.RV_E2E_WPCLI_IMAGE || "wordpress:cli-php8.2", dbImage: env.RV_E2E_WPDB_IMAGE || "mariadb:11.4",
    // optional: a LOCAL WordPress container to copy the Astra theme (and Elementor) from, read only; otherwise both come from wordpress.org
    themeFrom: env.RV_E2E_THEME_FROM || "",
  },
};
export const APP = `http://127.0.0.1:${C.app.port}`;
export const WP = `http://127.0.0.1:${C.wp.port}`;
/** The made-up people of the throw-away database (example.com addresses; no mail is ever sent: the app gets no mail settings). */
export const USERS = {
  admin: { email: "e2e-admin@example.com", name: "Admin Office", role: "admin", minor: false, moderator: false },
  mod: { email: "e2e-mod@example.com", name: "Ravi Kumar", role: "TC", minor: false, moderator: true },
  member: { email: "e2e-member@example.com", name: "Sita Devi", role: "TC", minor: false, moderator: false },
  minor: { email: "e2e-minor@example.com", name: "Neha Sharma", role: "ST", minor: true, moderator: false },
};

const file = () => join(STATE, "secrets.json");
/** The throw-away secrets (made on first use, never printed). */
export function secrets() {
  if (existsSync(file())) return JSON.parse(readFileSync(file(), "utf8"));
  mkdirSync(STATE, { recursive: true });
  const r = (n = 18) => randomBytes(n).toString("hex");
  const s = { db: r(), session: r(32), wpdb: r(12), wpadmin: r(12), users: Object.fromEntries(Object.keys(USERS).map((k) => [k, r()])) };
  writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });
  return s;
}
export const dropSecrets = () => rmSync(STATE, { recursive: true, force: true });
export const databaseUrl = (db = C.pg.db) => `postgresql://${C.pg.db}:${secrets().db}@127.0.0.1:${C.pg.port}/${db}`;

// Only what Node and Next.js need to run is passed on from your shell: never your own database, mail, bridge or API settings, so the
// test app can only reach the throw-away database and can never send a real email.
const PASS_ON = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "HOMEDRIVE", "HOMEPATH",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "LANG", "LC_ALL", "TZ", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"];
export const baseEnv = () => Object.fromEntries(PASS_ON.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
/** The app's environment: the throw-away database, a made-up session secret, the local WordPress as the only allowed origin, mock OTP. */
export const appEnv = () => ({
  ...baseEnv(), DATABASE_URL: databaseUrl(), SESSION_SECRET: secrets().session, SITE_URL: `${WP}/`, ALLOWED_ORIGINS: WP,
  OTP_PROVIDER: "mock", NEXT_TELEMETRY_DISABLED: "1",
});
/** Refuses anything that is not this computer (the tools never talk to another host). */
export function assertLocal(url) {
  const h = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(h)) throw new Error(`ABORT: ${h} is not this computer; these tools only run against local containers.`);
}
