# RoboValley website frontend (WordPress + Elementor)

This folder holds the custom frontend code for the RoboValley WordPress site: the homepage (page 432) and the Find a Service page (page 510). It was built and tested on a local copy of the site at `http://localhost/wordpress`. The live site (`https://techytree.in/`) has **not** been changed.

It is separate from the Next.js application in the rest of this repository. Nothing here is built or run by `npm`.

> **How the code is stored on the site.** Most of the page code is *not* in theme files. It lives in the WordPress database, inside Elementor **HTML widgets** and in the Astra **Additional CSS**. The files under `elementor/` and `wordpress/` are exact copies of those database values, taken from the local site on 2026-10-31. If you edit a file here, nothing changes on the site until you paste the edit into the widget in Elementor and save.

## Contents

- [Folder structure](#folder-structure)
- [Required versions](#required-versions)
- [Where each piece of code lives](#where-each-piece-of-code-lives)
- [Page settings](#page-settings)
- [Assets: images, fonts and external services](#assets-images-fonts-and-external-services)
- [Local development](#local-development)
- [Importing the pages and moving them to the live site](#importing-the-pages-and-moving-them-to-the-live-site)
- [Deployment checklist](#deployment-checklist)
- [Testing](#testing)
- [Known limitations and dependencies](#known-limitations-and-dependencies)
- [Future database integration (Find a Service)](#future-database-integration-find-a-service)
- [What is not in this folder](#what-is-not-in-this-folder)

## Folder structure

```
frontend/
├── README.md
├── .gitignore
├── wordpress/
│   ├── plugins/robovalley-landing/      Custom plugin (install as-is into wp-content/plugins/)
│   │   ├── robovalley-landing.php       Loads the assets below only on pages flagged robovalley_landing
│   │   └── assets/
│   │       ├── robovalley-home.css      Homepage styles, all scoped to .robovalley-home sections
│   │       ├── robovalley-home.js       Homepage slider (city map, tabs, controls) and chart tooltips
│   │       ├── robovalley-fonts.css     @font-face rules for the self-hosted fonts
│   │       └── fonts/                   Bricolage Grotesque, Mulish, JetBrains Mono (woff2) + SIL OFL licences
│   ├── additional-css.css               Appearance > Customize > Additional CSS (header Sign In button)
│   └── header/astra-header-signin.json  Astra Header Builder settings for the Sign In link
├── elementor/
│   ├── home-432/
│   │   ├── home-432.elementor.json      Full Elementor page (importable template file)
│   │   ├── page-config.json             Page template, Elementor and Astra page settings, plugin flag
│   │   └── widgets/                     The 6 HTML widgets, one file each (<order>-<name>.<widget id>.html)
│   └── find-a-service-510/
│       ├── find-a-service-510.elementor.json
│       ├── page-config.json
│       └── widgets/                     The 3 HTML widgets (search panel, DEMO DATA, results + map script)
├── assets/images/uploads/2026/10/       The 7 Media Library images the homepage uses
├── tests/find-a-service/                Browser test scripts for the Find a Service page (Node, no dependencies)
└── docs/
    ├── environment.json                 WordPress, PHP, theme and active plugin versions on the local site
    ├── media-manifest.json              Which upload files each page references
    └── screenshots/                     Desktop / tablet / mobile screenshots from the last test run
```

## Required versions

Taken from the local site where everything was built and tested (full list in `docs/environment.json`).

| Component | Version | Needed for |
|---|---|---|
| WordPress | 7.1.4 | everything |
| PHP | 8.2.12 (plugin requires 7.4+) | everything |
| Astra theme | 4.14.0 | header (Sign In button), full-width page layout |
| Elementor (free) | 4.3.5 | both pages (containers + HTML widgets) |
| RoboValley Landing (this folder) | 1.2.0 | homepage styles, fonts, slider, charts |
| WPForms Lite | 2.0.2.2 | the contact form widget on the homepage |
| SureCookie | 1.6.1 | cookie banner (not part of this code, but shown on all pages) |

Elementor Pro is **not** required. Other active plugins on the local site (Essential Addons, ElementsKit, Premium Addons, Royal Addons, UAE, Yoast, LiteSpeed Cache and others) are not used by the code in this folder. A page setting from Essential Addons (`eael_ext_toc_title`) is stored on page 432 but is not used.

## Where each piece of code lives

### Homepage: page 432 "Home" (the site's front page)

| File | Elementor widget | Section (container anchor) | What it does |
|---|---|---|---|
| `widgets/01-hero-slider.8335bc6.html` | HTML `8335bc6` | `#top` | 7-slide hero: the plugin script adds the hexagon city map, tabs, autoplay, swipe and keyboard controls |
| `widgets/02-platform-member-card.aaf3000.html` | HTML `aaf3000` | `#platform` | Example member card |
| `widgets/03-opportunity-chart-turnover.235f3ac.html` | HTML `235f3ac` | `#opportunity` | Bar chart (SVG) "Total ecosystem turnover", tooltips from the plugin script |
| `widgets/04-opportunity-chart-sources.edd5fe8.html` | HTML `edd5fe8` | `#opportunity` | Bar chart (SVG) "Year 10 turnover by source" |
| `widgets/05-contact-socials.36adf1a.html` | HTML `36adf1a` | `#contact` | Social links block |
| `widgets/06-story-animation.2355c42.html` | HTML `2355c42` | last container `6b3e117` | "Story of the month" card: opens at the bottom right on the live page, with its own CSS and JS |

The rest of the homepage (headings, text, buttons, images, the WPForms form, layout) is ordinary Elementor content. It is in `home-432.elementor.json`. Sections: `#top`, `#vision`, `#robocity`, `#platform`, `#board`, `#opportunity`, `#contact`. The section styles come from `robovalley-home.css`; each styled container has the class `robovalley-home`.

### Find a Service: page 510 (`/find-a-service`)

| File | Elementor widget | What it does |
|---|---|---|
| `widgets/01-search-panel.a51f0c7.html` | HTML `a51f0c7` "Find a Service – search panel (fonts, styles, form)" | All the page's CSS, the search form and the Popular services chip row (incl. the "Coming Soon!" tooltip styles) |
| `widgets/02-demo-data.a51f0d2.html` | HTML `a51f0d2` "Find a Service – DEMO DATA (replace with real providers later)" | Categories and facilities as JSON (`<script type="application/json" id="rv-fas-data">`). **Demonstration data only.** |
| `widgets/03-results-map-script.a51f0d3.html` | HTML `a51f0d3` "Find a Service – results, map and script" | Results list, Leaflet map, location search, radius filter, Coming Soon behaviour |

All CSS classes on this page start with `rv-fas-`, so they don't affect other pages. The page currently has 1 live category (ATL Labs, 5 demo facilities). Five categories are marked Coming Soon: Robotics Labs, STEM Labs, 3D Printing Facilities, Robotics Training Centres and Innovation Centres. Selecting one shows a "Coming Soon!" panel instead of results.

### Header (all pages)

| File | Where it is set on the site |
|---|---|
| `wordpress/header/astra-header-signin.json` | Appearance > Customize > Header Builder. "HTML 1" is placed after "Button 1" in Primary Right. Its content is `<a href="#" class="rv-signin">Sign In / Login</a>`. |
| `wordpress/additional-css.css` | Appearance > Customize > Additional CSS. Styles the Sign In link and hides it below 1140px. |

The Sign In link deliberately points to `#` for now.

## Page settings

Both pages use the same layout settings (full values in each `page-config.json`):

| Setting | Where in WordPress | Page 432 | Page 510 |
|---|---|---|---|
| Template `elementor_header_footer` | Page > Template: "Elementor Full Width" | ✓ | ✓ |
| Astra content layout `full-width-container` | Page > Astra Settings > Container: Full Width | ✓ | ✓ |
| Astra `site-post-title: disabled` | Astra Settings > Disable Title | ✓ | ✓ |
| Elementor `hide_title: yes` | Elementor > Page Settings > Hide Title | ✓ | ✓ |
| Custom field `robovalley_landing = 1` | Turns on the RoboValley Landing plugin for the page (see below) | ✓ | — |
| Static front page | Settings > Reading > Homepage | ✓ | — |
| Slug | | `robovalley-home-draft` | `find-a-service` |

**Turning on the plugin for a page.** The plugin loads its CSS, fonts and script only when the page has the post meta `robovalley_landing` set to `1`. The meta is registered for the REST API, so it can be set with `POST /wp-json/wp/v2/pages/<id>` and body `{"meta":{"robovalley_landing":true}}`, or with WP-CLI: `wp post meta update <id> robovalley_landing 1`. The script is not loaded inside the Elementor editor, because the editor's preview would clash with it. The CSS is.

## Assets: images, fonts and external services

**Images.** The homepage uses 7 Media Library files. Copies are in `assets/images/uploads/2026/10/`, at the same path they have under `wp-content/uploads/`. The 6 zone images (`01_vidya_kshetra.png` … `07_seva_peetham.png`) appear in the hero slider. `robovalley-campus-hero-1040.webp` is the hero image. Find a Service uses no images; its map markers and icons are inline SVG and CSS.

**Fonts.** Bricolage Grotesque, Mulish and JetBrains Mono are self-hosted by the plugin, so no font service is called. They are licensed under SIL OFL 1.1, with the licence files next to the fonts. The header Sign In button uses Astra's "Rubik", which Astra loads itself.

**External services used by Find a Service** (loaded in the visitor's browser):

| Service | Used for | Notes |
|---|---|---|
| `cdnjs.cloudflare.com`, Leaflet 1.9.4 | Map library | Loaded with SRI integrity hashes |
| `tile.openstreetmap.org` | Map tiles | OSM tile usage policy applies; attribution is shown on the map |
| `nominatim.openstreetmap.org` | Turning a typed town or PIN code into coordinates | Max 1 request/second, no autocomplete. The page only geocodes when Search is pressed. |
| Google Maps (`google.com/maps/dir/`) | "Directions" link on each result | A plain link; no API key |
| Browser geolocation | "Use my location" | Needs HTTPS on the live site (localhost is exempt) |

## Local development

1. Install XAMPP (Apache + MariaDB + PHP 8.2) and WordPress 7.1.x at `C:\xampp\htdocs\wordpress`, or use an existing local copy of the site.
2. Install the Astra theme and the plugins listed in [Required versions](#required-versions).
3. Copy `wordpress/plugins/robovalley-landing/` to `wp-content/plugins/robovalley-landing/` and activate **RoboValley Landing**.
4. Upload the images in `assets/images/uploads/2026/10/` to the Media Library, or copy them to `wp-content/uploads/2026/10/` and register them.
5. Create the pages by importing the Elementor JSON files (next section), then apply the [page settings](#page-settings).
6. Add the header Sign In link and the Additional CSS (see [Header](#header-all-pages)).

**Editing the code.** Open the page with **Edit with Elementor**, select the HTML widget by the title or ID shown above, and edit its HTML. Copy the result back into the matching file here so the repository stays in sync. The plugin's CSS and JS are ordinary files: edit them in `wp-content/plugins/robovalley-landing/assets/`. Then bump `ROBOVALLEY_LANDING_VERSION` in `robovalley-landing.php` so browsers and caches fetch the new version.

## Importing the pages and moving them to the live site

> Nothing in this folder has been deployed. Moving it to `https://techytree.in/` needs the site owner's approval. Take a full backup of the live site first.

### Option A: import the Elementor JSON files (recommended for moving single pages)

1. **Media first.** Upload the 7 images in `assets/images/uploads/2026/10/` to the live Media Library.
2. **Fix the local URLs.** The JSON files and the hero slider widget contain `http://localhost/wordpress/wp-content/uploads/...` image URLs, and Media Library attachment IDs from the local site. Before importing, replace `http://localhost/wordpress` with `https://techytree.in` in `home-432.elementor.json`. The JSON escapes slashes, so search for `http:\/\/localhost\/wordpress` too. After importing, re-pick each image in Elementor so it uses the live attachment ID.
3. **Import.** In wp-admin go to Templates > Saved Templates > Import Templates, choose the `.elementor.json` file, then create the page and insert the template with "Add Template" > My Templates. Alternatively, open the page in Elementor and use the folder icon > My Templates > Insert.
4. **Page settings.** Set the template, Astra settings and title options from [Page settings](#page-settings). On the homepage, add the `robovalley_landing` meta and set it as the front page if required.
5. **Plugin.** Upload and activate `robovalley-landing` (Plugins > Add New > Upload, from a zip of the folder).
6. **Header.** Add the HTML 1 element and the Additional CSS in the Customizer.
7. **Purge caches.** Clear LiteSpeed Cache and use Elementor > Tools > Regenerate CSS & Data. Then check the pages while logged out.

### Option B: full-site migration (All-in-One WP Migration)

The local site has All-in-One WP Migration installed. A full export replaces the **entire** live site (database, plugins, media), including anything changed on live since the local copy was made. Use it only if that is intended. Do not commit `.wpress` exports to this repository.

## Deployment checklist

- [ ] Site owner has approved the transfer to the live site
- [ ] Full backup of the live site taken and verified
- [ ] Live site runs compatible versions of WordPress, Astra and Elementor (see [Required versions](#required-versions))
- [ ] `robovalley-landing` plugin uploaded and activated; version constant bumped if any asset changed
- [ ] 7 images uploaded; no `localhost` URLs left in the imported pages (view the page source and search for `localhost`)
- [ ] Page 432 imported; template, Astra settings, `robovalley_landing = 1`, front page set
- [ ] Page 510 imported at `/find-a-service`; template and Astra settings set
- [ ] DEMO DATA notice visible on Find a Service; no real businesses presented as partners
- [ ] Header HTML 1 (Sign In) and Additional CSS added; Sign In link still `#` unless a login URL has been approved
- [ ] Caches purged (LiteSpeed, Elementor CSS); checked logged-out at desktop 1280px, tablet 820px and mobile 390px
- [ ] Find a Service: ATL Labs results and map markers appear; "Use my location" works over HTTPS; a typed town (for example "Guntur") is found; the 5 Coming Soon chips show the tooltip and the Coming Soon panel
- [ ] Homepage: slider tabs and autoplay, chart tooltips, story card, contact form all work
- [ ] No JavaScript errors in the browser console; no horizontal scrolling on mobile
- [ ] Cookie banner still works (it is managed by SureCookie and was not changed)

## Testing

### Automated browser tests (Find a Service)

The scripts in `tests/find-a-service/` drive a real browser through the Chrome DevTools Protocol. They need only **Node 22+**: they use the built-in `fetch` and `WebSocket`, with no `npm install`. They expect the local site at `http://localhost/wordpress/find-a-service/` and a browser at the standard Windows install path.

| Script | Browser | What it covers | Last result (2026-10-31) |
|---|---|---|---|
| `cs-test.js` | Microsoft Edge | The Coming Soon change at 1280 / 820 / 390px: tooltips on hover (desktop), keyboard focus, Escape and tap (touch); the Coming Soon panel with 0 results and 0 markers; ATL results and markers; "Use my location" (simulated 25 km); manual "Guntur" search through real Nominatim; search suggestions; no horizontal scroll; no JS errors; no write requests to WordPress | **128 / 128 passed** |
| `edge-check-atl.js` | Microsoft Edge | Regression check with no request interception: typed location search, ATL Labs at 50 km, "View on map" highlighting, popup fully visible at all three sizes | **31 / 31 passed** |
| `fas-test.js` | Google Chrome | The original 97-check suite | **Outdated, not run.** It expects the earlier 14-facility demo data, so many checks now fail by design. Kept for reference; update it before reuse. |

```
cd frontend/tests/find-a-service
node cs-test.js           # PASS/FAIL lines; screenshots written to ./shots-cs (git-ignored)
node edge-check-atl.js    # screenshots written to ./shots-edge-atl (git-ignored)
```

The tests only read pages. They never submit forms and they refuse to click anything covered by another element, such as the cookie banner. To run them against another address, change `URL_` at the top of each script.

### Static checks run on this folder (2026-10-31)

- Every file is byte-identical to its source on the local site. That covers the 13 plugin files, the 9 HTML widgets (compared with the stored `_elementor_data`), both page JSON files, the Additional CSS, the Astra header values and the 7 images.
- All JSON files parse, including the demo data inside the widget.
- PHP lint (`php -l`) passes on `robovalley-landing.php`.
- JavaScript syntax passes on `robovalley-home.js`, the three test scripts and every inline `<script>` in the widgets.
- Every asset the plugin enqueues and every font referenced in `robovalley-fonts.css` exists. There are no duplicate files.
- Scanned for passwords, keys and tokens: none found.

The homepage was tested during earlier work, but its test harness was not kept and is not in this folder.

### Screenshots

`docs/screenshots/` contains the Coming Soon test screenshots at desktop (1280px), tablet (820px) and mobile (390px): tooltip, Coming Soon results, ATL results and search suggestions. The SureCookie banner appears over some full-page captures. In `mobile-390-atl-results.png`, a "Coming Soon!" tooltip from the previous tap had not yet faded when the screenshot was taken.

## Known limitations and dependencies

- **Database-stored code.** The HTML widgets and Additional CSS live in the WordPress database. Changing these files does nothing to the site until the change is pasted into Elementor or the Customizer, as described above.
- **Local URLs.** The hero slider widget and `home-432.elementor.json` contain `http://localhost/wordpress/...` image URLs and local attachment IDs. These must be replaced when moving the pages (see [Importing](#importing-the-pages-and-moving-them-to-the-live-site)).
- **Demo data.** Find a Service shows demonstration facilities only: placeholder names, addresses, phone numbers and `example.org` links, at approximate town-centre coordinates. The on-page notice must stay visible until real data replaces it.
- **Leftover STEM tags.** Two ATL demo facilities are still named "Demo STEM Lab – Amaravati / Ongole", and three keep a `stem` category tag in the data. While STEM Labs is Coming Soon, those tags are ignored.
- **Nominatim limits.** Public OSM services have usage limits, so a high-traffic live site should use its own geocoder or a commercial one.
- **HTTPS for location.** "Use my location" requires HTTPS on the live site.
- **Plugin version mismatch.** The header says `Version: 1.2.0`, while `ROBOVALLEY_LANDING_VERSION` (used for cache-busting) is `1.2.1`. This is harmless, but align them on the next change.
- **Homepage slug.** Page 432's slug is still `robovalley-home-draft`. It is served as the front page, so the slug doesn't appear in the homepage URL.
- **Elementor template exports.** Templates saved in the local Elementor library are not part of this folder. The page JSON files here are taken directly from the pages.
- **Plugins in the page data.** The Elementor JSON for page 432 references the WPForms form widget, which needs WPForms with an equivalent form on the target site. The form itself is not exported.

## Future database integration (Find a Service)

The page reads all its data from one JSON block, `<script type="application/json" id="rv-fas-data">` in widget `a51f0d2`. To switch to real providers, keep the same shape and either replace the JSON or change `results-map-script` to fetch it from an endpoint. For example, a custom REST route or a custom post type exposed through the REST API.

```json
{
  "source": "demo",
  "categories": [
    { "id": "atl", "label": "ATL Labs", "aliases": ["atal tinkering lab"] },
    { "id": "robotics", "label": "Robotics Labs", "status": "coming-soon", "aliases": ["robot lab"] }
  ],
  "facilities": [
    { "id": "demo-01", "name": "…", "city": "…", "categories": ["atl"], "address": "…",
      "lat": 16.4996, "lng": 80.6565, "services": ["…"], "phone": "…", "website": "https://…" or null }
  ]
}
```

- A category with `"status": "coming-soon"` is listed with a "Coming Soon!" tooltip. Its facilities are never shown. To launch a category, remove the `status` field.
- `lat` / `lng` must be real coordinates; the radius filter uses straight-line distance.
- Before connecting a live provider database, plan how it will be checked, how often it is updated, privacy and consent for provider contact details, and server-side geocoding of addresses.
- Remove the DEMO DATA notice, and set `"source"` to something other than `demo`, only when every entry is real and verified.

## What is not in this folder

| Excluded | Why |
|---|---|
| WordPress core, Astra, Elementor and the other third-party plugins | Not custom code; install them from their official sources |
| Database dumps, backups and `.wpress` exports | They contain private site data (users, settings, form entries) |
| `wp-config.php`, application passwords, keys, `.env` files | Secrets; never commit them |
| Logs, caches, generated Elementor CSS, test output | Generated files |
| Earlier versions and test harnesses from the homepage work | Not kept on disk; only the final versions (stored in the site) could be exported |
| Elementor library templates saved by the site owner | Not part of this work |
| Local snapshots, rendered page captures, admin scripts used to save the pages | Contain local site state, or write directly to the local database |
