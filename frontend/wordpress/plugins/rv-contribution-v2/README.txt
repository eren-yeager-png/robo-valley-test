RoboValley Contribution (v2) - WordPress plugin, version 0.1.5

WHAT IT IS
The new Contribute form for the Contribution and Contributor pages. It only shows the form and talks to the RoboValley app.
It stores nothing in WordPress: no settings in the database, no rows, no cookies, no browser storage. The app saves every
submission as pending, checks duplicates, and handles the review (moderators verify, request changes or reject; only an
administrator can approve, remove, unpublish or republish).

WHERE IT GOES
public_html/wp-content/plugins/rv-contribution-v2/   (a normal plugin, activated under Plugins; NOT mu-plugins)

SETTINGS (in wp-config.php, above "That's all, stop editing!"; names only, type the real values yourself)
  RV_CONTRIBUTION_V2       true  -> the two pages show the new form.
                           missing or anything else -> the pages show their old content exactly as before.
  RV_CONTRIBUTION_APP_URL  the RoboValley app's address (http or https). Without it the form says it is not available.
  RV_CONTRIBUTION_PAGES    optional, comma separated page slugs. Default: contribute-now,contribution,contributor.
                           The first slug is the form page that "Contribute to this sector" links to.
  RV_CONTRIBUTION_SECTOR_PARENT  optional: the slug of the Robots by Sector page. Default: robots-by-sector.
  RV_CONTRIBUTE_PUBLIC     (shared with the Contribution button plugin) true = visitors see "Contribute to this sector";
                           missing = nobody sees it. WordPress administrators never see it (since 0.1.4: they review).
                           The Contact page (contact-us, contact) can never be switched, even if listed.
There is no API key: the form runs in the visitor's browser, so a key there would be visible to everyone and protect nothing.
The app already decides who may send (the visitor's own RoboValley sign-in) and which websites may call it (ALLOWED_ORIGINS).

THE APP SIDE MUST ALLOW THIS WEBSITE
The app's ALLOWED_ORIGINS must include this website's address, or the browser will block the form's requests.

UNDO
Deactivate the plugin (Plugins > RoboValley Contribution (v2) > Deactivate), or remove the RV_CONTRIBUTION_V2 line.
If the site shows a white screen: File Manager > public_html/wp-content/plugins/ > rename the folder rv-contribution-v2 to
rv-contribution-v2.off. WordPress then ignores it and the pages show their old content.

SHORTCODE
[rv_contribution_v2] shows the same form on any page, also only while RV_CONTRIBUTION_V2 is true.

NEW IN 0.1.1
  * A link such as /contribution/?sector=agriculture-dairy ticks that sector in the form (only sectors that really exist are ticked).
  * Signing in from the form now brings the visitor back to the same page. The app accepts /contribution/ and /contributor/ for that by default;
    if your page slugs are different, set CONTRIBUTION_PAGE_PATHS in the app's environment to the same paths (names only here, you type the values).

NEW IN 0.1.2
  * The form page is /contribute-now/ by default (it is listed first), so no RV_CONTRIBUTION_PAGES line is needed for it.
    The app already sends people back to /contribute-now/ after signing in (no app setting needed for that page).
  * "Contribute to this sector" on every Robots by Sector page: top right, next to the heading (moved there by a tiny script
    when the theme has a heading row; otherwise it sits at the top right of the content). It links to /contribute-now/?sector=<page slug>,
    which ticks that sector in the form. Shown only while RV_CONTRIBUTION_V2 is true; only to administrators until RV_CONTRIBUTE_PUBLIC is true.

NEW IN 0.1.3
  * Sign In and Sign Up keep the sector: a visitor who arrives from "Contribute to this sector" signed out comes back to
    /contribute-now/?sector=<that sector> after signing in, with the sector still ticked. Only a ?sector= value the app accepts
    is kept (plain slugs, up to 20, no repeats); anything else returns to the page without it.

NEW IN 0.1.4
  * Members contribute, administrators review. WordPress administrators no longer see "Contribute to this sector", and on the
    form pages they see a short note with a link to the app's Moderation page instead of the form (the Contribution button
    in the sector bar does the same from its version 1.2.0). Everyone else sees the buttons once RV_CONTRIBUTE_PUBLIC is true.
  * Signed in to the app as an administrator or moderator, the form shows a short note (sign in with a member account to
    contribute, or open Moderation) and a Sign Out button instead of the form. The app refuses their submissions anyway (403).
  * My Contributions shows every reply from a moderator under the item ("Reply from RoboValley: ..."), whatever the status, and
    the status reads "Replied" while a replied item is still waiting. Everything else in the member form is unchanged.
  * Needs the app with migration 019 for replies; without it the form works as before (no replies, nothing breaks).

NEW IN 0.1.5
  * Edit: in My Contributions, an item a moderator sent back ("Changes requested") has an Edit button. It opens this same form
    filled in with the saved title, description, directory categories (with their remarks and links), sectors, photos and
    private contact details. Make the changes and press Submit for Review: it goes back to the moderators as a new review.
    A saved photo can be removed (its description cannot be changed; remove it and add it again). Other items have no Edit.
  * The directory categories, remarks and links are also sent as structured data (the app stores them separately for the
    moderators' portal). The same text is still folded into the description, so nothing older breaks.
  * Needs the app with portal PR2. With an older app, the form works as 0.1.4 (the app ignores the extra data).
  * The form looks exactly the same (the HTML and CSS files are unchanged).
