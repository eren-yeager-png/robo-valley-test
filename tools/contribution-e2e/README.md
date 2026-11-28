# Contribution workflow: end-to-end, lifecycle, migrations-twice and portal checks

These scripts check the contribution workflow on a **throw-away stack on your own computer**:

- a Postgres container;
- the app (`next build` + `next start` of this checkout);
- a WordPress site with the Astra theme;
- a headless Chrome or Edge.

Nothing here talks to a live database or website.

- Every container port is bound to `127.0.0.1`. The scripts refuse any address that is not this computer.
- Every password and secret is made up at run time and kept in `tools/contribution-e2e/.state/`. That folder is ignored by git, and the secrets are never printed. `rig.mjs down` deletes it.
- The app gets only the environment Node needs, plus the throw-away database, a made-up session secret and mock OTP. It never sees your own database, mail, bridge or API settings, so it cannot send a real email.
- The browser blocks `*.vercel.app` and `*.neon.tech`, plus every host you list in `RV_E2E_BLOCK_HOSTS`. Put your live site's host names there. Before any check, the browser proves these hosts are unreachable and that the app is the local build. If either check fails, the run stops.
- The WordPress site may reach only wordpress.org, to install Astra (`WP_HTTP_BLOCK_EXTERNAL`).

## What you need

- Docker (Docker Desktop on Windows or macOS).
- Node 20 or newer, and `npm install` done in the repository.
- Chrome, Edge or Chromium. Set `RV_E2E_BROWSER` to its program file if it is not found.

## Run it

```sh
node tools/contribution-e2e/rig.mjs up            # Postgres + base schema + every migration + made-up people; next build; next start; WordPress
node tools/contribution-e2e/e2e.mjs               # the end-to-end check (prints PASS/FAIL per check, screenshots in tools/contribution-e2e/out/)
node tools/contribution-e2e/lifecycle.mjs         # WordPress lifecycle: switch, deactivate, reactivate, version change, uninstall, reinstall
node tools/contribution-e2e/migrations-twice.mjs  # every migration twice on a fresh database (in the same Postgres container)
node tools/contribution-e2e/portal.mjs --label after  # every portal page in every role at 1440, 1024 and 390 px (app and demo), with screenshots
node tools/contribution-e2e/rig.mjs down          # stop and delete everything, including the made-up secrets
```

Each check script exits with code 1 if any check failed.

`rig.mjs` also has single steps:

- `pg-up`
- `build`
- `app-up` and `app-down` (after a code change: `build`, then `app-down` and `app-up`)
- `wp-up` and `wp-down`
- `pg-down`
- `status`
- `wp <args>`: WP-CLI on the throw-away site, e.g. `wp option get rv_contrib_switch_over`

Run `e2e.mjs` before `lifecycle.mjs`: the lifecycle ends by uninstalling the plugin and installing it again.

## Settings (environment variables, all optional)

| Variable | Default | What it is |
|---|---|---|
| `RV_E2E_BLOCK_HOSTS` | (none) | Extra host names to block in the test browser, comma separated (e.g. your live site and its app) |
| `RV_E2E_BROWSER` | Edge or Chrome in the usual place | The browser program file |
| `RV_E2E_THEME_FROM` | (none) | A **local** WordPress container to copy the Astra theme and Elementor from (read only); otherwise they come from wordpress.org |
| `RV_E2E_PG_PORT`, `RV_E2E_APP_PORT`, `RV_E2E_WP_PORT` | 55432, 3041, 8099 | Ports on 127.0.0.1 |
| `RV_E2E_PG_IMAGE`, `RV_E2E_WP_IMAGE`, `RV_E2E_WPCLI_IMAGE`, `RV_E2E_WPDB_IMAGE` | postgres:16-alpine, wordpress:7.1.4-php8.2-apache, wordpress:cli-php8.2, mariadb:11.4 | Images |
| `RV_E2E_PG_CONTAINER` | rvcw-e2e-pg | The Postgres container's name |

Every container these scripts make carries the label `rvcw-e2e=1`. `down` removes only containers with that label.

## What is checked

**`e2e.mjs`** checks both forms, the sector buttons, the workflow and the portals.

- **The current form (switch OFF).** `/contribute-now/` (rv-contribution-v2, unchanged) still saves through the old API. The new pages are private.
- **Sector pages: the header.** There is one "+ Contribute to this sector" button in the header, with the title on the left and the button on the right. It is white with a green border, green bold text and 8px corners. It stays sticky while the page scrolls and never covers a card.
- **Sector pages: every field.** Every field has its own sticky button. This includes the page's sections, a field added by a plugin through `the_content`, a field added by JavaScript after loading, and a "suggested" field once approved. An empty block gets no button.
- **Ways to remove a button.** The administrator's per-field setting removes exactly that field's button. CSS that tries to hide the buttons cannot. A script that removes them sees them come straight back.
- **Other pages and layouts.** A page with its title switched off still has the header button. Pages that are not sector pages have no buttons.
- **On a phone.** The header button sits below the title at full width. The field buttons are full width. There is no sideways scrolling, long addresses wrap, and wide tables scroll inside their own box.
- **Switch ON.** The redirect works and is never cached, and every button opens Share Your Idea with the sector and the field. A signed-out visitor goes to the app's sign-in page and comes back to the form with everything still filled in.
- **The workflow.**
  - A member shares an idea with a photo.
  - The Moderator edits it and sends it to the Admin.
  - The Admin previews and publishes it, and the card appears on Community Ideas.
  - **Unpublish and publish again:** the card disappears, and publishing again needs a new preview first.
  - **A failed publish, then a retry:** this gives exactly one card.
  - **A Moderator's decline:** the Admin's Rejected filter shows who declined, why and when, and **Reopen** sends it back.
- **Earn (18+).** It is not offered to a learner under 18, and the app refuses it if it is sent anyway.
- **The Member portal.** Sectors shows the same header and field buttons. My Contributions lists only your own items, and the active nav item is highlighted.
- **The reviewer screens.** They use the same sector header.
- **Switch OFF again.** Everything is exactly as it was before.

**`lifecycle.mjs`** checks the WordPress plugin's lifecycle.

- It never creates a duplicate page.
- The buttons come and go with the plugin.
- The per-field setting survives deactivation, reactivation and uninstalling.
- A version change re-runs the setup.
- Every way of turning the plugin off (switch, deactivate, uninstall) gives today's site back.

**`migrations-twice.mjs`** runs every migration twice on a fresh database.

1. Every migration in `db/migrations` runs on a fresh database.
2. Real rows are added to the newest tables.
3. A normal second run must skip every migration.
4. A forced second run (`--force`) of each migration must run without an error.
5. `--status` must report every migration as applied.
6. Every table's rows and content, and the whole schema, must be **identical** before and after. A sequence that only moved forward with no row added is listed as a note. That happens when a forced rerun repeats an `INSERT … ON CONFLICT DO NOTHING`, such as 016's default sector, which uses up an id.

The test-only WordPress plugin `wp-plugins/rv-e2e-dummy-fields` adds the plugin, JavaScript and suggested fields. **Never install it on a real site.**

## The portal check (`portal.mjs`)

It needs only the Postgres container and the app (`pg-up`, `build`, `app-up`); WordPress is not used. Once per database it adds the
portal's sample data: two more made-up people (a parent and a mentor), a few items sent with the current form (one verified), and ideas
sent with Share Your Idea through the app's own API (some approved, two published, one declined, one "Suggest a field").

Then, signed in as each role (administrator, moderator, student, teacher, parent, contributor), it opens every portal page at 1440, 1024
and 390 pixels wide, and every page of the standalone demo in every role, and checks:

- the page never scrolls sideways;
- the blocks of the page (header, sector grid, panel) never overlap;
- no button is stretched to its container's width;
- no word is broken in the middle (slugs have an ellipsis instead);
- every Sent date is on one line;
- the keyboard reaches the page, with a visible focus ring (at 1440).

Each page view is saved as `<phase>-<role>-<page>-<width>-<label>.png` in `--out` (default `tools/contribution-e2e/out/portal`), and the
results in `<phase>-checks-<label>.json`. With `--label before` problems are recorded but do not fail the run (use it on the code before
a change); `--only app` or `--only demo` runs one half; `--demo <file>` checks another copy of the demo.
