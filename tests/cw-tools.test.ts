// The local end-to-end tools (tools/contribution-e2e): they hold no secret and no live address, every container port is bound to
// 127.0.0.1, the app never inherits your own environment (no real database, mail or API keys), the browser blocks the hosted services
// before anything else, the scripts parse, and the README documents them. The tools themselves need Docker and are run by hand.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = "tools/contribution-e2e";
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === ".state" || f === "out" ? [] : walk(p)) : [p]; });
const all = walk(DIR).map((p) => p.replace(/\\/g, "/"));
const text = (p: string) => readFileSync(p, "utf8");

describe("tools/contribution-e2e", () => {
  it("has the rig, the three checks, the shared helpers, the README, the git ignore list and the test-only plugin", () => {
    for (const f of ["rig.mjs", "e2e.mjs", "lifecycle.mjs", "migrations-twice.mjs", "lib/config.mjs", "lib/browser.mjs", "lib/docker.mjs", "lib/seed.mjs", "README.md", ".gitignore", "wp-plugins/rv-e2e-dummy-fields/rv-e2e-dummy-fields.php"]) {
      expect(all, f).toContain(`${DIR}/${f}`);
    }
    expect(text(`${DIR}/.gitignore`).split(/\r?\n/)).toEqual(expect.arrayContaining([".state/", "out/"])); // the made-up secrets never reach git
  });
  it("holds no secret, key, password or live address", () => {
    for (const f of all) {
      const t = text(f);
      expect(t, f).not.toMatch(/postgres(?:ql)?:\/\/[^\s`'"$]+:[^\s`'"$@{]+@/); // a connection string with a written-out password
      expect(t, f).not.toMatch(/\bnpg_[A-Za-z0-9]{8,}|\bre_[A-Za-z0-9]{16,}|\bsk-[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY/);
      expect(t, f).not.toMatch(/techytree/i); // the live site's host names come from RV_E2E_BLOCK_HOSTS at run time, never from the repo
      expect(t, f).not.toMatch(/\bep-[a-z]+-[a-z]+-\d{4,}/); // no database endpoint id
      expect(t, f).not.toMatch(/(?:PASSWORD|SECRET)=(?!\$\{)[A-Za-z0-9]{6,}/); // values come from the throw-away secrets file only
    }
  });
  it("binds every container port to 127.0.0.1 and refuses any other host", () => {
    const rig = text(`${DIR}/rig.mjs`);
    const ports = rig.match(/"-p", `[^`]*`/g) || [];
    expect(ports.length).toBe(2); // Postgres and WordPress
    for (const p of ports) expect(p).toContain("127.0.0.1:");
    expect(text(`${DIR}/lib/config.mjs`)).toContain("export function assertLocal");
    for (const f of ["rig.mjs", "e2e.mjs", "lifecycle.mjs", "migrations-twice.mjs", "lib/seed.mjs", "lib/browser.mjs"]) expect(text(`${DIR}/${f}`), f).toMatch(/assertLocal\(/);
  });
  it("never passes your own environment to the app: only what Node needs, plus the throw-away values", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { DATABASE_URL: "postgresql://real", RESEND_API_KEY: "real-key", RVP_BRIDGE_SECRET: "real", SESSION_SECRET: "real", CRON_SECRET: "real" });
    try {
      const { baseEnv } = await import("../tools/contribution-e2e/lib/config.mjs");
      const env = baseEnv();
      for (const k of ["DATABASE_URL", "RESEND_API_KEY", "RVP_BRIDGE_SECRET", "SESSION_SECRET", "CRON_SECRET"]) expect(env, k).not.toHaveProperty(k);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    expect(text(`${DIR}/lib/config.mjs`)).toMatch(/appEnv = \(\) => \(\{\s*\.\.\.baseEnv\(\), DATABASE_URL: databaseUrl\(\)/);
  });
  it("its own browser: port 0, the hosted services blocked and checked before anything else, every process of its profile stopped at the end", () => {
    const b = text(`${DIR}/lib/browser.mjs`);
    expect(b).toContain('"*.vercel.app", "*.neon.tech"');
    expect(b).toContain("--remote-debugging-port=0");
    expect(b).toContain("DevToolsActivePort");
    expect(b).toMatch(/--host-resolver-rules=/);
    expect(b).toMatch(/was not blocked in the test browser/);
    expect(b).toMatch(/CommandLine\.Contains\(\$env:RV_E2E_PROFILE\)/);
  });
  it("every script parses", () => {
    for (const f of all.filter((x) => x.endsWith(".mjs"))) expect(spawnSync(process.execPath, ["--check", f]).status, f).toBe(0);
  });
  it("the dummy plugin says it is for tests only; the README documents each script and the safety rules", () => {
    expect(text(`${DIR}/wp-plugins/rv-e2e-dummy-fields/rv-e2e-dummy-fields.php`)).toMatch(/TEST ONLY[\s\S]*Never install it on a real site/);
    const r = text(`${DIR}/README.md`);
    for (const s of ["rig.mjs up", "e2e.mjs", "lifecycle.mjs", "migrations-twice.mjs", "rig.mjs down", "RV_E2E_BLOCK_HOSTS", "127.0.0.1", ".state/"]) expect(r, s).toContain(s);
  });
  it("is not linted as app code (like scripts/)", () => {
    expect(text("eslint.config.mjs")).toContain('"tools/**"');
  });
});
