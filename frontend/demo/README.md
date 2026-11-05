# Contribution demo (front-end prototype)

A visual and interaction prototype of the "Robots by Sector", "Contribute" and "RoboValley Directory" screens. **It runs on sample data and writes nowhere**: no database, no API route, no account, no moderation, no photo storage, no request of any kind. Submitting the wizard only adds a line to a list in the page's memory; reload and it is gone. Every item shows a "Demo" chip and every page shows "Sample content for design preview. Not real contributions."

| What | Where |
|---|---|
| The one data source | `frontend/demo/contributions-demo.json` (sectors, robot types, contributions, directory items, wizard types and fields, links, the notice) |
| Sources of the three widgets | `frontend/elementor/contrib-demo/src/` (`core.css`, `core.js`, `sector.html`, `contribute.html`, `directory.html`) |
| Built output (what WordPress gets) | `frontend/elementor/contrib-demo/widgets/*.html` and `frontend/elementor/contrib-demo/*.elementor.json`, made by `npm run build:contrib-demo` (a test fails if they are out of date) |
| The design it follows | `reference/RV-Web-Robots_by_Sector___Directory.html` and its three pages unpacked in `reference/unpacked/` |
| Local-only import script | `scripts/wp-import-contrib-demo.php` (refuses unless `WP_ENVIRONMENT_TYPE` is local or development; creates DRAFT pages) |

Swapping the sample data for real data later is a one-file change: `contributions-demo.json` is the only place the words and numbers live.

## Turn the demo off
- **One line in the data file:** in `frontend/demo/contributions-demo.json` change `"enabled": true,` to `"enabled": false,`, run `npm run build:contrib-demo`, and import the pages again. Every widget then shows only "This preview is switched off."
- **One line in WordPress, no rebuild:** in the Elementor HTML widget, change the first line's `data-rvd="on"` to `data-rvd="off"`.

## Remove it completely
Delete `frontend/demo/`, `frontend/elementor/contrib-demo/`, `scripts/build-contrib-demo.mjs`, `scripts/wp-import-contrib-demo.php`, `tests/contrib-demo.test.ts` and the `build:contrib-demo` line in `package.json`; trash the three draft pages. Nothing else in the project refers to the demo.

## Pages (drafts only)
`sector-demo` (use `?sector=agriculture-dairy`, `education` or `healthcare`), `contribute-demo` (`?sector=`, `?robot=`, `?type=`), `directory-demo` (`?sector=`).
