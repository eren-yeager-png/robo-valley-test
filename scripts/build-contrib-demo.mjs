// Builds the three contribution-DEMO widgets and their Elementor page files from their sources and the one demo data file.
//   node scripts/build-contrib-demo.mjs          write frontend/elementor/contrib-demo/widgets/*.html and the page JSON files
//   node scripts/build-contrib-demo.mjs --check  exit 1 if the committed output is out of date (used by a test)
// Source of the words and numbers: frontend/demo/contributions-demo.json. To turn the preview off set "enabled": false there and rebuild.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "frontend/elementor/contrib-demo/src");
const OUT = join(ROOT, "frontend/elementor/contrib-demo");
const dataText = readFileSync(join(ROOT, "frontend/demo/contributions-demo.json"), "utf8");
const data = JSON.parse(dataText);
if (data.isDemo !== true) throw new Error("the demo data file must say isDemo: true");

// The data goes into the page as JSON text; "<" is escaped so nothing in it can close the script tag.
const embedded = JSON.stringify(data).replace(/</g, "\\u003c");
const coreCss = readFileSync(join(SRC, "core.css"), "utf8").trimEnd();
const coreJs = readFileSync(join(SRC, "core.js"), "utf8").trimEnd();

const PAGES = [
  { src: "sector.html", widget: "06-sector.html", json: "contrib-demo-sector.elementor.json", id: "rvd0c01", title: "Robots by Sector (DEMO)", slug: "robots-by-sector-demo" },
  { src: "contribute.html", widget: "07-contribute.html", json: "contrib-demo-contribute.elementor.json", id: "rvd0c02", title: "Contribute (DEMO)", slug: "contribute-demo" },
  { src: "directory.html", widget: "08-directory.html", json: "contrib-demo-directory.elementor.json", id: "rvd0c03", title: "RoboValley Directory (DEMO)", slug: "robovalley-directory-demo" },
];

const files = {};
for (const p of PAGES) {
  const html = readFileSync(join(SRC, p.src), "utf8")
    .replace("/*@CORE_CSS@*/", () => coreCss)
    .replace("/*@DATA@*/", () => embedded)
    .replace("/*@CORE_JS@*/", () => coreJs);
  if (html.includes("/*@")) throw new Error("a placeholder is left in " + p.src);
  files[join("widgets", p.widget)] = html;
  const page = {
    version: "0.4",
    title: p.title,
    type: "page",
    content: [
      {
        id: p.id, elType: "container",
        settings: { _title: p.title, content_width: "full", padding: { unit: "px", top: "24", right: "24", bottom: "0", left: "24", isLinked: false }, padding_mobile: { unit: "px", top: "16", right: "16", bottom: "0", left: "16", isLinked: false } },
        elements: [{ id: p.id + "w", elType: "widget", widgetType: "html", settings: { html }, elements: [] }],
        isInner: false,
      },
    ],
    page_settings: { hide_title: "yes" },
  };
  files[p.json] = JSON.stringify(page, null, 4) + "\n";
}
files["contrib-demo-pages.json"] = JSON.stringify({
  note: "Create each page as a DRAFT (never publish it) and import its .elementor.json. Slugs and titles are the demo's own; no live page is changed.",
  pages: PAGES.map((p) => ({ title: p.title, slug: p.slug, status: "draft", file: p.json, widget: "widgets/" + p.widget })),
}, null, 4) + "\n";

let stale = 0;
for (const [name, text] of Object.entries(files)) {
  const path = join(OUT, name);
  if (process.argv.includes("--check")) {
    if (!existsSync(path) || readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== text) { console.error("out of date: " + name); stale++; }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log("wrote " + name + " (" + Buffer.byteLength(text) + " bytes)");
  }
}
if (stale) process.exit(1);
