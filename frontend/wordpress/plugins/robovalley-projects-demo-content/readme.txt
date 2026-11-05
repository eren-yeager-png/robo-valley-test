=== RoboValley Projects: Demo Content ===
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later

One-click sample projects for a client presentation, and one-click removal.

== What it does ==

Adds Projects > Demo content (administrators only). Two buttons:

* Install demo projects: creates 20 realistic sample projects, each with a generated thumbnail, covering every technology, education level, subject and difficulty. Running it again never creates duplicates and never changes a project that is already installed.
* Remove demo projects: deletes ONLY the projects and images this plugin created (they carry the post meta _rvp_demo = 1) and tells you how many.

Both buttons ask for confirmation first.

== Good to know ==

* Needs the RoboValley Projects plugin to be active. Otherwise it refuses to do anything.
* Activating, deactivating or deleting this plugin does NOT create or delete any project. Only the two buttons do.
* The sample projects have clean titles on the public site (no "DEMO" word). Tell your audience they are sample content. In wp-admin they show a "Demo" badge, and a notice says "Demo content is installed. Remove it before real launch." while any exist.
* It never creates or changes categories (technologies, education levels, subjects) or any setting. If a category is missing it is skipped and reported.
* All thumbnails are generated locally and included in the plugin. Nothing is downloaded.

== Before the real launch ==

1. Projects > Demo content > Remove demo projects > confirm.
2. Check that "0 demo projects currently installed" is shown.
3. Plugins > deactivate and delete "RoboValley Projects: Demo Content".

== Changelog ==

= 0.1.0 =
First version.
