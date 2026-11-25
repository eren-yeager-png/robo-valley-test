// docs/reference/robovalley-admin-landing-updates.html: one self-contained file that shows the admin portal and landing page updates.
// It carries copies of the project's own stylesheets and settings; this keeps them identical to what ships.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n").trimEnd();
const FILE = read("docs/reference/robovalley-admin-landing-updates.html");
const COPIES = ["src/app/globals.css", "src/app/join/join.css", "src/app/login/login.css", "src/app/dashboard/dashboard.css", "src/app/admin/admin.css",
  "src/app/(reviewer)/admin/moderation/moderation.css", "frontend/wordpress/plugins/rv-contribution-v2/assets/rv-site.css"];

describe("the reference file", () => {
  it("holds the shipped stylesheets and axis settings, unchanged", () => {
    for (const f of COPIES) expect(FILE.includes(`/* BEGIN ${f} */\n${read(f)}\n/* END ${f} */`), `${f} changed: run the reference file's generator again, or copy the new text between its BEGIN and END marks`).toBe(true);
    expect(FILE).toContain(`<script type="text/plain" id="code-css">${read(COPIES[6])}</script>`); // the CSS printed in section 4
    expect(FILE).toContain(`<script type="text/plain" id="code-axis">${read("src/app/admin/_components/chartAxis.ts")}</script>`);
  });
  it("needs nothing from outside: no linked file, no request", () => {
    expect(FILE).not.toMatch(/<(script|img|iframe|link)[^>]*\s(src|href)="(?!data:)/i);
    expect(FILE).not.toMatch(/@import|url\((?!data:)/);
    expect(FILE).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(/);
  });
  it("holds made-up people only", () => {
    const emails: string[] = FILE.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((e) => e.endsWith("@example.com"))).toBe(true);
    expect(FILE).not.toMatch(/neon\.tech|postgres(ql)?:\/\/|techytree/i);
  });
});
