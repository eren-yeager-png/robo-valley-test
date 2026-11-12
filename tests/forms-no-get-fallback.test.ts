// A <form> without a method is submitted as GET if the visitor clicks before the page's JavaScript has attached (slow phone, slow network).
// For the sign-in form that puts the e-mail AND PASSWORD in the address bar, the browser history and the server's access logs
// (seen in a real-browser audit: /login?email=...&password=...). Every form must therefore say method="post" (or "get" on purpose,
// for a search/filter form that holds nothing private). The scripts all call preventDefault, so nothing changes once the page is ready.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });
}
/** Every opening <form ...> tag (the attributes may span lines and contain {...} expressions). */
function formTags(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<form\b/g)) {
    let i = m.index! + 5, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index!, i + 1));
  }
  return out;
}

describe("forms never fall back to a GET that would put their fields in the address", () => {
  const files = walk(SRC);
  const forms = files.flatMap((f) => formTags(readFileSync(f, "utf8")).map((tag) => ({ file: relative(SRC, f).replace(/\\/g, "/"), tag })));

  it("finds the forms (the scan itself works)", () => {
    expect(forms.length).toBeGreaterThanOrEqual(5);
    expect(forms.some((f) => f.file === "app/login/LoginForm.tsx")).toBe(true);
  });

  it("every <form> declares method=...", () => {
    const missing = forms.filter((f) => !/\bmethod=/.test(f.tag)).map((f) => f.file);
    expect(missing).toEqual([]);
  });

  it("the forms that hold a password or personal details use POST", () => {
    for (const file of ["app/login/LoginForm.tsx", "app/admin/dashboard/ChangePasswordForm.tsx", "app/dashboard/profile/ProfileForm.tsx", "app/admin/_components/UploadForm.tsx"]) {
      const tags = forms.filter((f) => f.file === file);
      expect(tags.length, file).toBeGreaterThan(0);
      for (const t of tags) expect(t.tag, file).toMatch(/method="post"/);
    }
  });
});
