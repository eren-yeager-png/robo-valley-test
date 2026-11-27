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
  1.5.0  The Earn (18+) path is not offered to contributors under 18 (the app refuses it too). The shared rules and screens now
         know the owner's decisions on the spec's open points: Unpublish, edit after publishing, Reopen after Rejected (those
         screens are in the app's admin portal; this plugin only shows the form and the public page).
  1.4.0  Hardening: accessibility pass (labelled fields, announced errors, keyboard pills), spam protection on the app side (the same
         idea twice within minutes, a daily cap per member, rate limits), notifications sent by the app, this README.
  1.3.1  The switch-over setting (OFF by default).
  1.3.0  The public "Community Ideas" page ([rv_community_ideas]), created private.
  1.0.0  The "Share Your Idea" form ([rv_contribution_form]) on a private page.
  (1.1.0 and 1.2.0 were not released: the Moderator Workspace and the Admin Approval Dashboard are in the app, not in WordPress.)
