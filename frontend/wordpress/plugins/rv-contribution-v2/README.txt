RoboValley Contribution (v2) - WordPress plugin, version 0.1.12

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

NEW IN 0.1.6
  * No Sign Out button on the Contribute page: the member banner shows only "<first name> - Registered member". The button is
    taken out of the page on the server (it is not hidden with CSS). Signing out stays in the site header's account menu, on
    every page. A signed-in administrator or moderator sees the reviewer note without a Sign Out button too.
  * The [rv_contribution_v2] shortcode on any other page keeps the button; write [rv_contribution_v2 sign_out="no"] to drop it.
  * The HTML and CSS files are unchanged; only the PHP (which removes the button) and the script (which copes without it) changed.

NEW IN 0.1.7
  * Sectors: a "Choose sectors" button opens a searchable list (type to filter; choose at least 1, at most 20). The chosen
    sectors show as chips with a remove button. When the list loads but has no sectors, it says so ("No sectors are set up
    yet") instead of "could not be loaded".
  * Opened from a sector page ("Contribute to this sector", ?sector=<slug>): that sector is already chosen and the list is
    replaced by one read-only line, "Sector · Agriculture & Dairy", like the stakeholder line, with a Change link that brings
    the list back. A slug that is not a real sector is ignored: the normal list shows with nothing chosen. The app checks the
    sectors again when the contribution is saved.
  * Contact: the Name / Email / Mobile number fields are gone. One box instead, unticked by default: "Let moderators contact me
    using my profile details". It is saved with the contribution (app migration 021). Moderators and administrators see the profile's contact only
    when it is ticked; it is never shown publicly. Contact details sent with older versions stay in the app, unchanged.
  * Needs the app with migration 021 for the box to be saved (with an older app the box is ignored: nothing is shared).
  * The HTML and CSS changed (the sector list and the contact section).

NEW IN 0.1.8
  * Opened from a sector page ("Contribute to this sector"): only that sector, as fixed text ("Sector · Agriculture & Dairy").
    No list, no other sectors and no Change link: a contribution started from a sector page is for that sector.
  * The sector list (search, up to 20) appears only on the general Contribute page, when no sector was given.
  * Edit (Changes requested) still shows the saved sectors in the list, wherever it is opened, so the member can fix them.
  * Contact box wording unchanged; on the app side administrators now see a shared contact too (app change, not the plugin).

NEW IN 0.1.9
  * Edit (Changes requested) looks the way the contribution was started, wherever Edit is opened: started from a sector page, its
    saved sector as fixed text with no list; started from the general Contribute page, the list. A new contribution tells the app
    where it was started (fromSectorPage) and the app remembers it (app migration 022); an edit never changes it.
  * Where the origin was never recorded, Edit shows the list: contributions sent before 0.1.9, and every contribution while the
    app does not have migration 022 yet. A saved sector that is no longer offered also shows the list, so the member can choose again.
  * The HTML and CSS are unchanged; only the script changed.

NEW IN 0.1.10
  * The form starts with "What would you like to share?" (required): Describe a problem, Share an idea, or Share a video or resource.
    They are saved as problem, improve and resource, and the form tells the app the member chose it (typeChosen); the app
    remembers that (app migration 023). Moderation's item page and the CSV show the type.
  * Older contributions (sent before 0.1.10, which had no type question and sent "resource" for everything) show
    "Type: not asked (older form)". Their Edit has nothing ticked, with a short note, and the member picks one before sending.
  * Edit (Changes requested) keeps the saved type ticked, and the member can change it.
  * Install it only after the app has migration 023 (the app also works without it, but then every contribution shows
    "not asked (older form)").
  * The CSS is unchanged; the HTML has the new question and the script sends it.

NEW IN 0.1.11
  * "Which robot is it about?" (optional): for each chosen sector that has robot types, a list with "Not sure" first and then the
    robot types an administrator switched on in the app's Sector forms (they come with the sector list). Sectors without robot
    types ask nothing. The answers go to the app as robots: { "<sector>": "<robot>" | "" } and are stored privately (app migration 025).
  * From a robot card's link (?sector=<one sector>&robot=<slug>): that robot shows as fixed text, "Robot · Milking robots", like the
    fixed sector, if it really is one of that sector's robot types that are on (anything else shows the normal question). After
    signing in, the page comes back with the robot. The app is told (fromRobotPage) so Edit can look the same way later.
  * Edit (Changes requested) shows the saved robots; one that was switched off since stays chosen, marked "(no longer offered)".
  * Install it only after the app has migrations 024 and 025 (without them nothing is asked and nothing is saved, as in 0.1.10).
  * The HTML has the new question, the CSS one spacing rule, the script the rest.

NEW IN 0.1.12
  * Site styles (assets/rv-site.css), loaded on every public page after Astra's stylesheet while RV_CONTRIBUTION_V2 is true:
    the space around the entry header (single posts and pages 35px above / 25px below, page-builder pages 25px / 15px; a page
    whose title is switched off gets none), and the .rv-rt block, now 1080px wide (it was 880px).
  * The one block that shows what administrators add in Sector Forms ("Which robot is it about?") is an .rv-rt block. Robot types
    added later appear in it by themselves. Its width is the form's own column (800px); .rv-rt is 1080px wherever there is room.
  * If an older .rv-rt rule exists somewhere else in WordPress (Additional CSS, a code snippet, another plugin), delete it there:
    this file is the only place for it.
