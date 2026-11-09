#!/usr/bin/env node
// Builds the Elementor page file for the Contribute hub from its widget file, so the two can never drift apart.
//   node scripts/build-contribute-hub.mjs           writes frontend/elementor/contribute-hub/contribute-hub.elementor.json
//   node scripts/build-contribute-hub.mjs --check   changes nothing; exits 1 if the page file is not what the widget would produce
// The page is created in WordPress as a DRAFT (the live /contribute-now/ address keeps its "coming soon" page until the hub is approved).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "elementor", "contribute-hub");
const WIDGET = join(ROOT, "widgets", "01-contribute-hub.html");
const OUT = join(ROOT, "contribute-hub.elementor.json");

export function buildPage(html) {
  return {
    version: "0.4",
    title: "Contribute (hub, DRAFT)",
    type: "page",
    page_settings: { hide_title: "yes" },
    content: [
      {
        id: "rvh0a01", elType: "container",
        settings: { _title: "Contribute hub", content_width: "full", padding: { unit: "px", top: "24", right: "0", bottom: "0", left: "0", isLinked: false } },
        elements: [{ id: "rvh0a02", elType: "widget", widgetType: "html", settings: { html }, elements: [] }],
      },
    ],
  };
}

const text = JSON.stringify(buildPage(readFileSync(WIDGET, "utf8")), null, 2) + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) { console.error("contribute-hub.elementor.json is out of date. Run: node scripts/build-contribute-hub.mjs"); process.exit(1); }
  console.log("contribute-hub.elementor.json is up to date.");
} else {
  writeFileSync(OUT, text);
  console.log("Wrote", OUT);
}
