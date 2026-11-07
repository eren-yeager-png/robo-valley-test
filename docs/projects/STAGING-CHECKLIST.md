# RoboValley Projects: staging checklist

Run this on **staging first**, then once more on live right after the real deploy. Everything here is copy-paste. Nothing in it needs a secret except check 1.6, which reads the secret from an environment variable in your own terminal (never paste the secret into a chat, ticket or file).

Set these once in your terminal (bash). Replace the three addresses with staging's if staging uses different ones:

```bash
SITE=https://techytree.in            # WordPress site
APP=https://app.techytree.in         # RoboValley app
PID=<the id of one PUBLISHED project>   # wp-admin > Projects > hover a title: post=NN
UNPUB=<the id of one DRAFT project>
```

Tick **Pass** or **Fail** for every item. A single Fail on sections 1, 2 or 4 blocks the launch.

**Known limitation (accepted):** the Projects rate limits are counted in each app instance's memory (so per instance on serverless hosting, best effort) and the per-IP limit trusts the host's `X-Forwarded-For`; a shared limiter was deliberately not built. Do not fail the checklist for this.

Marker strings for the leak checks: take one sentence from the **Overview** and one line from **Skills required** of a published project in wp-admin. Below they are called `OVERVIEW-TEXT` and `SKILL-TEXT`.

---

## 1. curl checks (any computer, no login)

### 1.1 Public catalogue shows public fields only
```bash
curl -s "$SITE/wp-json/rvp/v1/projects?per_page=2" | head -c 1500; echo
curl -s "$SITE/wp-json/rvp/v1/projects?per_page=24" | grep -c -iE "OVERVIEW-TEXT|SKILL-TEXT|\"overview\"|\"skills\"|\"components\"|\"outcome\"|\"subjects\""
```
Expected: items have only `id, title, short_description, thumbnail, technology, difficulty, education` (and paging fields). The `grep -c` prints **0**.

- [ ] Pass  - [ ] Fail

### 1.2 Public catalogue headers
```bash
curl -s -D - -o /dev/null "$SITE/wp-json/rvp/v1/projects"
```
Expected: `200`, `Cache-Control: public, max-age=60, s-maxage=120`. No `Set-Cookie`.

- [ ] Pass  - [ ] Fail

### 1.3 Bridge refuses an unsigned request
```bash
curl -s -i "$SITE/wp-json/rvp-bridge/v1/project/$PID" | head -20
curl -s -i "$SITE/wp-json/rvp-bridge/v1/subjects"       | head -20
```
Expected: **401** (or **503** with body `Unavailable.` if the constant is not set yet; the real launch needs 401). Body is `Denied.` and never contains project text. Headers include `Cache-Control: no-store, private`.

- [ ] Pass  - [ ] Fail

### 1.4 Bridge refuses a browser (Origin header) and sends no CORS headers
```bash
curl -s -i -H "Origin: https://evil.example" "$SITE/wp-json/rvp-bridge/v1/project/$PID" | head -20
curl -s -i -H "Origin: null"                 "$SITE/wp-json/rvp-bridge/v1/project/$PID" | head -20
curl -s -i -H "Origin: $APP"                 "$SITE/wp-json/rvp-bridge/v1/project/$PID" | grep -i "access-control" || echo "no Access-Control-* header"
```
Expected: **403** (or 503 if the secret is not set yet), and the last command prints `no Access-Control-* header`.

- [ ] Pass  - [ ] Fail

### 1.5 POST /query returns no restricted fields and is never cached
```bash
curl -s -i -X POST "$SITE/wp-json/rvp/v1/projects/query" -H "Content-Type: application/json" -d "{\"include\":[$PID],\"per_page\":5}" | tee /tmp/q.txt | head -25
grep -c -iE "OVERVIEW-TEXT|SKILL-TEXT|\"overview\"|\"skills\"|\"components\"|\"outcome\"|\"subjects\"" /tmp/q.txt
curl -s -X POST "$SITE/wp-json/rvp/v1/projects/query" -H "Content-Type: application/json" -d '{"subjects":["physics"]}' | head -c 300; echo
```
Expected: `200`, `Cache-Control: no-store`, `X-LiteSpeed-Cache-Control: no-cache`, the `grep -c` prints **0**. A `subjects` key in the body is ignored (it must not filter by subject).

- [ ] Pass  - [ ] Fail

### 1.6 Bridge accepts a correctly signed request (needs the secret; stays in your terminal)
Only on staging, or on live from the server itself. Put the secret in the variable without echoing it: `read -rs RVP_BRIDGE_SECRET; export RVP_BRIDGE_SECRET`.
```bash
node -e '
const c=require("crypto"),s=process.env.RVP_BRIDGE_SECRET,site=process.argv[1],id=process.argv[2];
const route="/rvp-bridge/v1/project/"+id,ts=String(Math.floor(Date.now()/1000)),nonce=c.randomBytes(16).toString("hex");
const sig=c.createHmac("sha256",s).update(["RVP1","GET",route,ts,nonce,c.createHash("sha256").update("").digest("hex")].join("\n")).digest("hex");
fetch(site+"/wp-json"+route,{headers:{"X-RVP-Timestamp":ts,"X-RVP-Nonce":nonce,"X-RVP-Signature":sig}}).then(async r=>{console.log(r.status,r.headers.get("cache-control"));console.log((await r.text()).slice(0,200))})' "$SITE" "$PID"
```
Expected: `200 no-store, private`, then JSON that starts with the project's public fields (it is the only place `overview` appears). Run it twice with the same nonce (edit the script) and the second must be **401** (replay refused). For `$UNPUB` the answer must be **404**.

- [ ] Pass  - [ ] Fail  - [ ] Skipped (state why)

### 1.7 App route needs a session, never caches, never opens CORS wide
```bash
curl -s -i "$APP/api/projects/$PID" | head -20
curl -s -i -H "Origin: https://evil.example" "$APP/api/projects/$PID" | head -20
curl -s -i -H "Origin: $SITE" "$APP/api/projects/$PID" | grep -iE "^HTTP|cache-control|access-control"
curl -s -i "$APP/api/projects/abc" | head -3
```
Expected: no cookie gives **401** with `Cache-Control: no-store` and no project text; evil origin gives **403** and no `Access-Control-Allow-Origin`; `$SITE` as origin gives 401 plus `Access-Control-Allow-Origin: <exactly $SITE>` and `Access-Control-Allow-Credentials: true`; `abc` gives **400**.

- [ ] Pass  - [ ] Fail

### 1.8 Same checks for the other two app routes
```bash
curl -s -i "$APP/api/projects/subject-options" | head -12
curl -s -i "$APP/api/projects/subject-filter?subjects=physics" | head -12
```
Expected: both **401**, `no-store`.

- [ ] Pass  - [ ] Fail

---

## 2. Logged-out view-source search (browser)
1. Open a private/incognito window (not signed in to the app). Open `$SITE/projects/`.
2. View source (Ctrl+U). Search (Ctrl+F) for each of: `OVERVIEW-TEXT`, `SKILL-TEXT`, `Expected outcome`, a component name from a project, a subject name (for example `Physics`).
3. Click **View Project** on a card, then look at the Network tab.

Expected: none of the strings appear in the source or in any response; View Project shows the unlock prompt and makes **no** request that returns project text (the app answers 401).

- [ ] Pass  - [ ] Fail

Also search the sitemap and feeds: `curl -s $SITE/wp-sitemap.xml | grep -ci "rv_project"` must print **0**, and `curl -s -o /dev/null -w "%{http_code}\n" "$SITE/?post_type=rv_project&p=$PID"` must **not** show the project (404 or the home page).

- [ ] Pass  - [ ] Fail

---

## 3. Same-site cookie test (techytree.in and app.techytree.in)
The app's `rv_session` cookie is `HttpOnly; SameSite=Lax; Secure` and is set for `app.techytree.in`. The Projects page (on `techytree.in`) calls the app with `credentials: include`. That works because the two hosts are the same site (same registrable domain).

1. Open `$APP/login` and sign in as a normal member (not an admin).
2. DevTools > Application > Cookies > `$APP`: `rv_session` exists, **HttpOnly** and **Secure** ticked, SameSite **Lax**.
3. Open `$SITE/projects/` in the same browser. DevTools > Network (tick Preserve log), click **View Project**.
4. Click the request `/api/projects/<id>`: Status **200**; Request Headers include `Cookie: rv_session=...` and `Origin: https://techytree.in`; Response Headers include `Access-Control-Allow-Origin: https://techytree.in` (exactly, never `*`), `Access-Control-Allow-Credentials: true`, `Cache-Control: no-store`.
5. The details window shows three tabs. Press Escape: the window closes. In the Elements tab search for a word from the overview: **not found** (details are removed from the page).
6. Sign out in the app, reload `$SITE/projects/`, click **View Project**: the unlock prompt appears again.
7. From `$SITE/projects/` click the lock prompt's **Sign in**, sign in, and confirm you land back on `/projects/` (with the project open if you came from a card). Then try `$APP/login?returnTo=https://evil.example/` while signed out, sign in: you must land on the site home, **not** evil.example.
8. If step 4 shows no cookie or a 401: the hosts are not the same site, or `ALLOWED_ORIGINS` is missing `https://techytree.in` (staging may differ from live). Record what you see.

- [ ] Pass  - [ ] Fail

---

## 4. LiteSpeed checks
LiteSpeed's behaviour cannot be proven from the code; it must be seen on the server. Use `curl -s -D - -o /dev/null URL | grep -i "x-litespeed\|cache-control\|age"`.

1. **Projects page cached for visitors**: request `$SITE/projects/` twice. Second response shows `X-LiteSpeed-Cache: hit` (if page caching is on). Expected either `hit`, or a `miss` that becomes `hit`.
2. **Catalogue GET cached**: `$SITE/wp-json/rvp/v1/projects` twice: second shows `hit` or at least `Cache-Control: public, max-age=60, s-maxage=120`.
3. **POST /query never cached**: send the 1.5 request twice with different `include` lists; the answers must differ and there is no `X-LiteSpeed-Cache: hit`.
4. **Bridge never cached**: the 1.6 request twice (different nonces) both `200`, no `hit`; the response has `Cache-Control: no-store, private`.
5. **Purge on edit**: note a card title on `/projects/`; in wp-admin edit that project's title, Update; reload `/projects/` in a private window within a minute: the new title shows (cache purged by tag `rvp_catalogue`). Then also trash a project and confirm its card disappears.
6. **Optimisation settings**: with CSS/JS combine, minify, defer and *Delay JS* on, the page filters and the details window still work. If Delay JS is on, exclude `rvp-projects-page` and the inline `window.RVP_PAGE` block.
7. **Logged-in members**: the Projects page must not show a member's details to the next visitor: sign in, open details, sign out, hard refresh in a private window, and check view-source again (section 2).

- [ ] Pass  - [ ] Fail

---

## 5. Clock skew between servers
The bridge refuses a signed request whose timestamp is more than **60 seconds** from WordPress's clock, so the two servers' clocks must agree.

1. On each server run `date -u` at (nearly) the same moment, or compare `curl -sI $SITE | grep -i ^date` with `curl -sI $APP | grep -i ^date`.
2. Expected difference under **5 seconds**. Over 30 seconds: fix the time sync (NTP) before launch.
3. Functional proof: as a signed-in member click **View Project**: `200`. If every details request ends in a 503 (the app logs `projects bridge: unexpected status 401`) while the secret is right, suspect the clock.

- [ ] Pass  - [ ] Fail

---

## 6. `/projects/` slug clash
1. wp-admin > Pages (include Drafts, Trash): search `projects`. Also Posts, Categories, Tags, and any redirect plugin (Redirection, Rank Math, Yoast, LiteSpeed). Nothing else may own `/projects/`.
2. `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $SITE/projects/` before the page is created: expected **404**. After publishing the Projects page: **200** and the final URL is `/projects/` (no redirect).
3. The app's `PROJECTS_RETURN_PATH` must equal the page's path (default `/projects/`).

- [ ] Pass  - [ ] Fail

---

## 7. Rollback drill (do it once on staging before live)
Goal: prove you can return to the previous state in minutes.

1. Before starting, take the backup: copy `wp-content/plugins/robovalley-projects/` and export the database. Write down the plugin version shown in Plugins.
2. Replace the three page files (`includes/page.php`, `assets/rvp-projects-page.css`, `assets/rvp-projects-page.js`) and `robovalley-projects.php` with the previous versions from the backup. Purge LiteSpeed.
3. Confirm: Plugins shows the previous version number, `/projects/` loads, a card opens (details window still behaves as before).
4. Put the new files back and purge again. Confirm the new version number and layout.
5. Full removal drill (staging only): remove the `RVP_BRIDGE_SECRET` line from `wp-config.php`: `curl` 1.3 now gives **503**, View Project shows an error and **no** project text. Restore the line: it works again.
6. Deactivate the plugin: `/projects/` no longer lists projects and nothing else on the site breaks; reactivate. (Projects and settings stay in the database: deactivating or deleting the plugin removes no content.)

- [ ] Pass  - [ ] Fail

---

## Sign-off
| Section | Pass | Fail | Notes |
|---|---|---|---|
| 1 curl | | | |
| 2 view-source | | | |
| 3 cookie | | | |
| 4 LiteSpeed | | | |
| 5 clock | | | |
| 6 slug | | | |
| 7 rollback drill | | | |

Tested by: ____________   Date: ____________   Environment (staging / live): ____________   Plugin version: ______   App deploy: ______
