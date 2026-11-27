// Contribution workflow: the generated files (plugin script, plugin stylesheet, standalone demo) are exactly what
// scripts/build-contribution-workflow.mjs builds from the source files, the demo needs nothing from outside, and this feature uses
// only HTML, CSS and plain JavaScript (acceptance 17: no Tailwind, no jQuery, no Bootstrap, no framework in its files).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUT, outputs, PARITY, toModule } from "../scripts/build-contribution-workflow.mjs";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const FEATURE_FILES = [...walk("public/cw"), ...walk("frontend/wordpress/plugins/robovalley-contribution"), ...walk("src/app/_cw")].filter((f) => /\.(js|css|php|html|tsx)$/.test(f));

describe("generated files", () => {
  it("are exactly what the build script produces from the sources (run it after changing public/cw)", () => {
    for (const [file, content] of Object.entries(outputs())) expect(read(file), `${file} is out of date: node scripts/build-contribution-workflow.mjs`).toBe(content);
  });
  it("the plugin script is one plain script: no import or export left, and it parses", () => {
    const js = read(OUT.pluginJs);
    expect(js).not.toMatch(/^\s*(import|export)\s/m);
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain('__def("form.js"');
  });
  it("the bundler refuses an import or export form it does not understand", () => {
    expect(() => toModule("x.js", 'export default function () {}')).toThrow(/does not handle/);
    expect(() => toModule("x.js", 'import x from "./y.js";')).toThrow(/does not handle/);
  });
});

describe("the standalone demo (docs/reference/contribution_demo.html)", () => {
  const html = read(OUT.demo);
  it("opens by double-click: no linked file, stylesheet, font or script from anywhere", () => {
    expect(html).not.toMatch(/<(script|img|iframe|link)[^>]*\s(src|href)="(?!data:|#)/i);
    expect(html).not.toMatch(/@import|url\((?!data:)/);
    expect(html).toContain("new api.MockAdapter(");
  });
  it("lists the parity checklist and the plugin version, and is built from the same files production uses", () => {
    for (const p of PARITY) expect(html).toContain(`[x] ${p.replace(/--/g, "-")}`);
    expect(html).toMatch(/Plugin v\d+\.\d+\.\d+/);
    expect(html).toContain(read("public/cw/contribution-workflow.css"));
  });
  it("holds made-up people only", () => {
    const emails: string[] = html.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.every((e) => e.endsWith("example.com"))).toBe(true);
    expect(html).not.toMatch(/neon\.tech|postgres(ql)?:\/\//i);
  });
});

describe("only HTML, CSS and plain JavaScript in this feature's files (acceptance 17)", () => {
  it("no Tailwind, jQuery or Bootstrap, and no front-end framework", () => {
    expect(FEATURE_FILES.length).toBeGreaterThan(5);
    for (const f of FEATURE_FILES) {
      const t = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|\*).*$/gm, ""); // code only (comments may say "no Bootstrap")
      expect(t, f).not.toMatch(/tailwind|jquery|bootstrap/i);
      if (/\.(js|css|php|html)$/.test(f)) expect(t, f).not.toMatch(/from ["'](react|vue|@angular|preact|svelte)/);
      expect(t, f).not.toMatch(/class="[^"]*\b(px|py|mx|my|bg|text)-(\d|blue|red|gray|sm|lg|xl)/); // Tailwind-style utility classes
    }
    expect(readdirSync(".").some((f) => /^tailwind\.config/.test(f))).toBe(false);
  });
  it("every rule of the WordPress stylesheet is scoped under .rv-app (it cannot restyle the theme), and none uses !important", () => {
    const css = read("public/cw/contribution-workflow.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((b) => b.split("{")[0].trim()).filter(Boolean);
    for (const s of selectors) for (const one of s.split(",")) expect(one.trim(), s).toMatch(/^\.rv-app\b/);
    expect(css).not.toContain("!important");
  });
});
