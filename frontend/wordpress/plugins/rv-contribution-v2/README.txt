RoboValley Contribution (v2) - WordPress plugin, version 0.1.0

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
  RV_CONTRIBUTION_PAGES    optional, comma separated page slugs. Default: contribution,contributor.
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
