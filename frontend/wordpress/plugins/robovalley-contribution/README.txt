RoboValley Contribution - WordPress plugin, version 1.5.0

WHAT IT IS
The website part of the Contribution Publishing Workflow: the "Share Your Idea" form and the public "Community Ideas" page.
A thin shell: the screens are plain HTML, CSS and JavaScript (no Bootstrap, no framework), and every idea lives in the RoboValley
app's database. This plugin has no database tables and no WordPress roles. The Moderator Workspace and the Admin Approval
Dashboard (with the Publish Preview) are pages of the app's admin portal, not WordPress pages.

The current Contribute form (plugin rv-contribution-v2) is not changed by this plugin and keeps working until the switch-over
below is turned on.

NEEDS
  * The RoboValley app with database migrations 027 and 028 applied (before 027 the pages say they are not available yet).
  * The app address the current Contribute form already uses: RV_CONTRIBUTION_APP_URL in wp-config.php (or the
    robovalley_api_base option of the RoboValley Landing plugin). Nothing new to set.
  * WordPress 6.4 or newer, PHP 7.4 or newer.

WHAT IT DOES ON ACTIVATION (and whenever its version changes)
  * Creates, if missing, two PRIVATE pages (visible to WordPress administrators only):
      Share Your Idea   /share-your-idea/   [rv_contribution_form]
      Community Ideas   /community-ideas/   [rv_community_ideas]
    A page that exists is never changed or duplicated; an existing page at the same address is used only if it already holds the
    plugin's shortcode.
  * Its stylesheet and script load only on pages that hold its shortcodes, with ?ver=<plugin version>.
  * Its pages are never cached (DONOTCACHEPAGE and no-cache headers), so LiteSpeed and other caches always serve them fresh.

"CONTRIBUTE TO THIS SECTOR" ON EVERY SECTOR PAGE AND EVERY FIELD (on as soon as the plugin is active)
  Every Robots by Sector page (every child page of the "Robots by Sector" page, also ones published later) shows
  "+ Contribute to this sector" next to its title, sticky in the top-right while the page scrolls (below the title at full width on
  phones), and every field (section) of the page shows a sticky "Contribute to this sector" button (full width at the bottom of the
  field on phones). For every visitor and every role. They open the contribute flow that is live (the current form; "Share Your Idea"
  once switched over) with the sector (and the field) filled in, and the visitor can come back to the page afterwards.
  WHERE IT LIVES (do not remove): sector-buttons.php (the_content at PHP_INT_MAX - 10, the script and stylesheet, a fallback that
  prints them if another plugin dequeued them) and assets/js/rv-sector.js + assets/css/rv-sector.css (generated from public/cw in the
  app's repository). The script puts the buttons back after any change to the page, so new fields get theirs automatically.
  A FIELD is: an element with data-rv-field="<id>" (the way for other plugins), a top-level section of the page content (Elementor
  sections and containers, Gutenberg groups, <section>, .rv-rt blocks), or a selector added with the rv_contrib_field_selectors filter.
  Other pages can be made sector pages with the rv_contrib_sector_slug filter.
  The ONLY way to hide a field's button: Settings > Contribution workflow > "Fields without the button" (one field id per line,
  optionally <sector>/<field id>). The header button cannot be turned off. The current form's own header button (when it is on) is
  replaced by this one on these pages.
  Long words and addresses wrap inside the cards, and wide tables scroll sideways inside their card.

THE SWITCH-OVER (one setting, OFF by default)
  Settings > Contribution workflow > "Switch over to the new contribution workflow".
  ON:  both pages become public; the current form's pages (contribute-now, contribution, contributor, or the slugs in
       RV_CONTRIBUTION_PAGES; never a contact page) redirect to "Share Your Idea" with 301, keeping ?sector= (the redirect is sent
       with Cache-Control: no-store, so switching off takes effect at once); the "Contribute to this sector" button on the sector
       pages opens the new form.
  OFF: exactly today's behaviour: the two pages are private again, no redirect, the button as the current form prints it.
  Deactivating this plugin is a full undo as well (its pages go back to private).
  Purge the site cache after changing the setting.

INSTALL OR UPDATE
  WordPress > Plugins > Add New Plugin > Upload Plugin > robovalley-contribution-<version>.zip
  (choose "Replace current with uploaded" when updating), Activate, then purge all caches.

UNINSTALL
  Keeps everything by default (the ideas live in the app). Only when RV_CONTRIB_UNINSTALL_DELETE is defined as true in
  wp-config.php are this plugin's own options removed. Pages are never deleted automatically.

CHANGELOG
  1.5.0  "+ Contribute to this sector" in the header of every Robots by Sector page and a sticky button on every field (existing ones,
         ones added later through "Suggest a field" or by other plugins), one injection point (sector-buttons.php), a per-field off
         switch; long words wrap and wide tables scroll inside the cards; the switch-over redirect keeps the field and the way back.
         The Earn (18+) path is not offered to contributors under 18 (the app refuses it too). The shared rules and screens now
         know the owner's decisions on the spec's open points: Unpublish, edit after publishing, Reopen after Rejected (those
         screens are in the app's admin portal; this plugin only shows the form and the public page).
  1.4.0  Hardening: accessibility pass (labelled fields, announced errors, keyboard pills), spam protection on the app side (the same
         idea twice within minutes, a daily cap per member, rate limits), notifications sent by the app, this README.
  1.3.1  The switch-over setting (OFF by default).
  1.3.0  The public "Community Ideas" page ([rv_community_ideas]), created private.
  1.0.0  The "Share Your Idea" form ([rv_contribution_form]) on a private page.
  (1.1.0 and 1.2.0 were not released: the Moderator Workspace and the Admin Approval Dashboard are in the app, not in WordPress.)
