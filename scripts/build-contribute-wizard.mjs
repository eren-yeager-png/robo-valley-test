#!/usr/bin/env node
// Builds the Elementor page file for the Contribute page (hub + form together) from the two widget files, so they can never drift apart.
//   node scripts/build-contribute-wizard.mjs           writes frontend/elementor/contribute-wizard/contribute-wizard.elementor.json
//   node scripts/build-contribute-wizard.mjs --check   changes nothing; exits 1 if the page file is not what the widgets would produce
// The page is created in WordPress as a DRAFT (the live /contribute-now/ address keeps its "coming soon" page until you publish it).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "elementor");
const HUB = join(FRONT, "contribute-hub", "widgets", "01-contribute-hub.html");
const WIZARD = join(FRONT, "contribute-wizard", "widgets", "02-contribute-wizard.html");
const OUT = join(FRONT, "contribute-wizard", "contribute-wizard.elementor.json");

const box = (id, title, html, padding) => ({
  id, elType: "container",
  settings: { _title: title, content_width: "full", padding },
  elements: [{ id: id + "w", elType: "widget", widgetType: "html", settings: { html }, elements: [] }],
});

export function buildPage(hubHtml, wizardHtml) {
  return {
    version: "0.4",
    title: "Contribute (hub and form, DRAFT)",
    type: "page",
    page_settings: { hide_title: "yes" },
    content: [
      box("rvw0a01", "Contribute hub", hubHtml, { unit: "px", top: "24", right: "0", bottom: "0", left: "0", isLinked: false }),
      box("rvw0a02", "Contribute form", wizardHtml, { unit: "px", top: "0", right: "20", bottom: "40", left: "20", isLinked: false }),
    ],
  };
}

const text = JSON.stringify(buildPage(readFileSync(HUB, "utf8"), readFileSync(WIZARD, "utf8")), null, 2) + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* missing */ }
  if (current !== text) { console.error("contribute-wizard.elementor.json is out of date. Run: node scripts/build-contribute-wizard.mjs"); process.exit(1); }
  console.log("contribute-wizard.elementor.json is up to date.");
} else {
  writeFileSync(OUT, text);
  console.log("Wrote", OUT);
}
