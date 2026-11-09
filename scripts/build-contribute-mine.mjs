#!/usr/bin/env node
// Builds the Elementor page file for "Your contributions" from its widget file, so the two can never drift apart.
//   node scripts/build-contribute-mine.mjs           writes frontend/elementor/contribute-mine/contribute-mine.elementor.json
//   node scripts/build-contribute-mine.mjs --check   changes nothing; exits 1 if the page file is not what the widget would produce
// The page is created in WordPress as a DRAFT (the live /your-contributions/ page is new and stays a draft until you publish it).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "elementor", "contribute-mine");
const WIDGET = join(ROOT, "widgets", "03-your-contributions.html");
const OUT = join(ROOT, "contribute-mine.elementor.json");

export function buildPage(html) {
  return {
    version: "0.4",
    title: "Your contributions (DRAFT)",
    type: "page",
    page_settings: { hide_title: "yes" },
    content: [
      {
        id: "rvm0a01", elType: "container",
        settings: { _title: "Your contributions", content_width: "full", padding: { unit: "px", top: "24", right: "0", bottom: "0", left: "0", isLinked: false } },
        elements: [{ id: "rvm0a02", elType: "widget", widgetType: "html", settings: { html }, elements: [] }],
      },
    ],
  };
}

const text = JSON.stringify(buildPage(readFileSync(WIDGET, "utf8")), null, 2) + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) { console.error("contribute-mine.elementor.json is out of date. Run: node scripts/build-contribute-mine.mjs"); process.exit(1); }
  console.log("contribute-mine.elementor.json is up to date.");
} else {
  writeFileSync(OUT, text);
  console.log("Wrote", OUT);
}
