# Demo content for client presentations

A separate plugin, **RoboValley Projects: Demo Content** (`robovalley-projects-demo-content`), loads 20 realistic sample projects with one click and removes them with one click. It exists so the Projects page can be shown to a client with real-looking content before real projects are entered.

It is not part of the main `robovalley-projects` plugin, which is not changed by it.

## What you get

- 20 projects covering all 10 technologies (2 each), all 7 education levels, all 8 subjects and all 3 difficulty levels.
- 6 featured projects (display order 1 to 6, so the Featured tab looks intentional) and varied orders for the rest.
- Publish dates staggered over about two months, so the Latest tab looks natural.
- Each project has a short description, an overview, 4 to 6 skills, 4 to 6 components and an expected outcome (the last four are members-only, exactly like real projects).
- One generated thumbnail per project (cream, mint and green, a simple icon for the technology and the project title), 960 x 600 px (the 16:10 card shape), under 60 KB each. They are included in the plugin; nothing is downloaded.
- The public site shows clean titles. **There is no "DEMO" word on the public cards.** Tell the client these are sample projects.

## Install (WordPress admin, administrators only)

1. **Plugins > Add New > Upload Plugin**, choose `robovalley-projects-demo-content-0.1.0.zip`, **Install Now**, then **Activate**. Nothing is created yet.
2. Open **Projects > Demo content**.
3. Click **Install demo projects**, then **Yes, install the demo projects**. This takes a minute because 20 images are imported.
4. A green message tells you what was created. Open the Projects page on the website to check it (a normal refresh is enough; LiteSpeed is asked to refresh automatically).

While demo projects exist, every administrator sees a yellow notice: *"Demo content is installed. Remove it before real launch."* and the All Projects list shows a **Demo** badge on those rows.

Safe to click again: installing a second time creates nothing new and changes nothing that already exists. If you delete one demo project by hand and click Install again, only that one comes back.

## Remove (before real launch, or any time)

1. **Projects > Demo content > Remove demo projects**, then **Yes, remove the demo projects**.
2. The report says how many projects and images were removed. The page must now say **0 demo project(s) currently installed**, and the yellow notice disappears.
3. Then deactivate and delete the plugin: **Plugins > RoboValley Projects: Demo Content > Deactivate > Delete**.

Removal deletes only the projects and images that carry the plugin's tag (post meta `_rvp_demo` = `1`). Projects, posts, pages and images you made yourself are never touched, and this is checked again for every single item just before it is deleted. It cannot be undone.

## Rules the plugin follows

- Only users with the `manage_options` capability (administrators) see the page, the menu entry, the notice and the badge. Editors do not.
- Both buttons use a security nonce and a confirmation step.
- It refuses to do anything unless the main RoboValley Projects plugin is active.
- It never creates or changes technologies, education levels, subjects or any setting. If a category is missing on a site, the project is created without it and the report names it.
- **Activating, deactivating or deleting the plugin never creates or deletes projects.** Only the two buttons do. So if you delete the plugin before pressing Remove, the demo projects stay (you would then need to delete them by hand). Always remove first.

## What to tell the client

> "The projects you see are sample content that we loaded to show how the page works. Their titles, pictures and descriptions are illustrative. Each project's detailed information (overview, skills, components and expected outcome) is only visible to signed-in members, and we will replace the samples with your real projects before launch."

## Troubleshooting

| What you see | What to do |
|---|---|
| "The RoboValley Projects plugin must be active" | Activate **RoboValley Projects** first. |
| A category is reported as missing | Check **Projects > Technology Categories / Education Levels / Subjects**. The project was still created, without that category. Add the category and edit the project if you want it linked. |
| The page still shows the old list | Purge LiteSpeed Cache (Toolbox > Purge All). Install and Remove ask LiteSpeed to refresh the Projects page, but that depends on the live server (see the PR checklist). |
| A demo project is in the Trash | It still counts as installed. Restore it from the Trash, or click Remove, then Install. |
| Some demo projects are left after deleting the plugin | Install the demo plugin again, click Remove. |

## For developers

- Plugin: `frontend/wordpress/plugins/robovalley-projects-demo-content/` (dataset in `includes/dataset.php`, install and remove in `includes/installer.php`, admin page in `includes/admin.php`).
- Images are drawn by `frontend/dev-tools/robovalley-projects-demo-content/rvpdc-make-images.cjs` (Node and Edge, local only, uses the Bricolage Grotesque font already self-hosted by the Landing plugin, SIL OFL 1.1). The PNGs are committed in `assets/images/`; the plugin never needs the script.
- Tests: `frontend/tests/robovalley-projects/rvpdc-*` (WP-CLI install, re-install and remove; admin page over HTTP; leak scan; real-browser test).
- The old local-only script `frontend/dev-tools/robovalley-projects/rvprojects-demo-data.php` is left in place for local development; use this plugin for presentations.
