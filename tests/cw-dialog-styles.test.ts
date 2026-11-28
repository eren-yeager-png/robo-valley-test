// The portal's dialogs (public/cw/js/dialog.js: Archive, Delete, Uninstall, a reason, a new name) are styled by src/app/_cw/cw-portal.css.
// Every app page that mounts a screen using them, directly or through another module, must load that stylesheet itself (in the page or
// one of its layouts): without it a dialog shows as plain text under the page with no backdrop (Sectors' "Archive", Phase B). The
// screens come from CwMount's map and every page's <CwMount screen="...">, so a new page is checked without changing this test.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

const { join, dirname } = posix;
const read = (p: string) => readFileSync(p, "utf8");
const JS = "public/cw/js";
const SRC: Record<string, string> = Object.fromEntries(Array.from(read("src/app/_cw/CwMount.tsx").matchAll(/(\w+): "\/cw\/js\/([\w-]+\.js)"/g)).map((m) => [m[1], m[2]]));

function usesDialogs(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file) || !existsSync(join(JS, file))) return false;
  seen.add(file);
  const deps = Array.from(read(join(JS, file)).matchAll(/from "\.\/([\w-]+\.js)"/g)).map((m) => m[1]);
  return deps.includes("dialog.js") || deps.some((d) => usesDialogs(d, seen));
}
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pages(p) : n === "page.tsx" ? [p] : [];
  });
}
/** The page itself, or a layout in its folder or above it (up to src/app), imports cw-portal.css. */
function loadsDialogStyles(page: string): boolean {
  const imports = (p: string) => existsSync(p) && /^import\s+"[./]*\/?(?:\.\.\/)*_cw\/cw-portal\.css";/m.test(read(p));
  if (imports(page)) return true;
  for (let d = dirname(page); ; d = dirname(d)) {
    if (imports(join(d, "layout.tsx"))) return true;
    if (d === "src/app" || d === "." || d === "") return false;
  }
}

describe("the dialogs' styles on every page that can open one", () => {
  it("the map of screens is read (a sanity check of this test)", () => {
    expect(SRC.sectorForms).toBe("sector-forms.js");
    expect(usesDialogs("sector-forms.js")).toBe(true);
    expect(usesDialogs("audit.js")).toBe(false);
  });
  it("every page that mounts a screen with dialogs loads src/app/_cw/cw-portal.css (in the page or a layout)", () => {
    const checked: string[] = [];
    for (const page of pages("src/app")) {
      for (const m of read(page).matchAll(/<CwMount\b[^>]*?\bscreen="(\w+)"/g)) {
        const file = SRC[m[1]];
        expect(file, `${page}: the screen "${m[1]}" is not in CwMount's map`).toBeTruthy();
        if (!usesDialogs(file)) continue;
        checked.push(page);
        expect(loadsDialogStyles(page), `${page} mounts ${file}, which opens dialogs, but does not load src/app/_cw/cw-portal.css`).toBe(true);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(["src/app/admin/sector-forms/page.tsx", "src/app/admin/sectors/page.tsx", "src/app/admin/approvals/page.tsx"]));
  });
});
