// Contribution workflow: the contributor's "Share Your Idea" form (WordPress page, shortcode [rv_contribution_form], and the demo).
// Same fields, labels, order and messages as the demo. Name and type come from the signed-in profile and are read-only. Sector is
// optional (Sector Forms + "Not sure") and the robot type list follows the sector. The Earn (18+) path is not offered to a minor
// (users.age_category; the app refuses it anyway). The attachment's real type is checked from its first bytes before it is sent; the
// app checks everything again.
import { $, $$, checkedValues, esc, options, pills } from "./utils.js";
import * as R from "./rules.js";
import { CATEGORIES, EARN, FEATURES, KINDS, LEVELS, LIMITS, MESSAGES, NEW_IDEA, NOT_SURE, NOT_SURE_LABEL, PATHS, RESOURCE_TYPES } from "./lists.js";
import { RestAdapter } from "./api.js";

const INTRO = "Students, parents, guardians, teachers and anyone else can suggest a new idea or improve something already on RoboValley. Submissions are reviewed before anything is made public.";

/** The demo's sample answers (used only by the standalone demo, so the form can be tried with one click). */
export const SAMPLE = {
  kind: NEW_IDEA, title: "Robot that picks up plastic from beaches", categories: ["Robotics"], suitableFor: ["K6–K8", "K9–K10"], learningPath: "Make",
  description: "A small robot that drives on the beach and picks up plastic bottles and wrappers so the beach stays clean.",
  resourcePath: "Robots by Sector › Agriculture & Dairy › Weeding robots",
  resourceUrl: "https://techytree.in/robots-by-sector/agriculture-dairy/#rv-type-weeding-robots",
};

const notice = (kind, html, role = "status") => `<div class="rv-notice rv-n-${kind}" role="${role}">${html}</div>`;

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(el.getAttribute("data-api-base") || "");
  const loc = opts.location || (typeof location !== "undefined" ? location : null);
  const storage = opts.storage !== undefined ? opts.storage : sessionStore();
  let query = opts.query || new URLSearchParams(loc ? loc.search : "");
  el.classList.add("rv-app");
  el.innerHTML = `<section class="rv-panel" aria-labelledby="rv-form-h"><h2 id="rv-form-h">Share Your Idea</h2><p class="rv-muted">${esc(INTRO)}</p><div class="rv-body" aria-live="polite"><p class="rv-muted">Loading…</p></div></section>`;
  const body = $(el, ".rv-body");
  let me, cfg;
  try {
    [me, cfg] = await Promise.all([adapter.me(), adapter.formConfig()]);
  } catch (e) {
    body.innerHTML = notice("err", esc(e && e.status === 503 ? "The contribution form is not available right now. Please try again later." : MESSAGES.failed), "alert");
    return;
  }
  if (!me.signedIn) {
    stashQuery(query, storage); // the field, the kind and the way back survive the trip to the sign-in page
    const back = loginBack(loc, query, cfg.sectors || []);
    body.innerHTML = notice("info", esc(MESSAGES.signIn)) + `<p><a class="rv-btn rv-btn-primary" href="${esc(adapter.loginUrl(back))}">Sign in</a></p>`;
    return;
  }
  if (me.reviewer) { body.innerHTML = notice("info", esc(MESSAGES.reviewerCannot)); return; }
  query = restoreQuery(query, storage);
  const origins = [loc && /^https?:/.test(loc.protocol || "") ? loc.origin : "", originOf(adapter.base)].filter(Boolean);
  renderForm(body, { adapter, me, sectors: cfg.sectors || [], query, origins, sample: opts.sample === true });
}

// ---- signing in from the form and coming back ----
// The app sends a visitor back after signing in only to this form's address with ?sector= (and one ?robot=); any other parameter, or an
// encoded character, and it sends them to their portal instead. So the sign-in link comes back with just those, and the rest of what
// the page passed (the field, the kind, the way back, the resource path) waits in this tab's sessionStorage for the return.
const STASH = "rv-cw-form-return";
const STASH_MS = 30 * 60 * 1000;
function sessionStore() { try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; } }
const originOf = (u) => { try { return u && /^https?:/i.test(u) ? new URL(u).origin : ""; } catch { return ""; } };

/** The address the sign-in page sends the visitor back to: this page with ?sector= (and ?robot= for a robot type), nothing else. */
export function loginBack(loc, query, sectors = []) {
  if (!loc || !/^https?:/.test(loc.protocol || "")) return "";
  const sector = R.slug(query.get("sector") || ""), field = R.slug(query.get("field") || query.get("robot") || "");
  const s = sectors.find((x) => x.slug === sector);
  if (!s) return loc.origin + loc.pathname;
  const robot = field && (s.robots || []).some((r) => r.slug === field) ? `&robot=${field}` : "";
  return `${loc.origin}${loc.pathname}?sector=${sector}${robot}`;
}
/** Keeps what the page passed (only when there is more than the sector) for the return from the sign-in page. */
export function stashQuery(query, storage) {
  if (!storage) return;
  const keep = new URLSearchParams();
  for (const k of ["sector", "field", "kind", "return_to", "resource_path", "resource_url"]) if (query.get(k)) keep.set(k, query.get(k).slice(0, 2048));
  try {
    if ([...keep.keys()].some((k) => k !== "sector")) storage.setItem(STASH, JSON.stringify({ q: keep.toString(), at: Date.now() }));
    else storage.removeItem(STASH);
  } catch { /* storage blocked: the sector still comes back */ }
}
/** After signing in: the kept parameters of the same sector (at most 30 minutes old) are used again, once. */
export function restoreQuery(query, storage) {
  if (!storage) return query;
  let saved = null;
  try { saved = JSON.parse(storage.getItem(STASH) || "null"); storage.removeItem(STASH); } catch { return query; }
  if (!saved || typeof saved.q !== "string" || !(Date.now() - Number(saved.at) < STASH_MS)) return query;
  const keys = [...query.keys()];
  if (keys.some((k) => k !== "sector" && k !== "robot")) return query; // the page was opened with its own parameters: those win
  const kept = new URLSearchParams(saved.q);
  if (R.slug(kept.get("sector") || "") !== R.slug(query.get("sector") || "")) return query;
  return kept;
}

function renderForm(body, ctx) {
  const { me, sectors, query, sample } = ctx;
  const presetSector = sectors.some((s) => s.slug === query.get("sector")) ? query.get("sector") : NOT_SURE;
  const sectorOptions = [[NOT_SURE, NOT_SURE_LABEL], ...sectors.map((s) => [s.slug, s.name])];
  const path0 = query.get("resource_path") || (sample ? SAMPLE.resourcePath : "");
  const url0 = query.get("resource_url") || (sample ? SAMPLE.resourceUrl : "");
  const minor = me.minor === true;
  // pressed on a sector page: the field (a robot type of that sector, or another section of the page) is what it refers to
  const field = R.slug(query.get("field") || query.get("robot") || "");
  const presetRobot = field && ((sectors.find((s) => s.slug === presetSector) || {}).robots || []).some((r) => r.slug === field) ? field : "";
  const presetType = field ? (presetRobot ? "Robot type" : "Button or section on a page") : "Robot type";
  const presetKind = KINDS.includes(query.get("kind")) ? query.get("kind") : NEW_IDEA; // "Suggest a field" opens a Suggestion
  const paths = minor ? PATHS.filter((x) => x !== EARN) : PATHS; // the Earn (18+) path is for learners 18 and above
  const pathPick = sample && paths.includes(SAMPLE.learningPath) ? [SAMPLE.learningPath] : [];
  body.innerHTML = `<form class="rv-form" novalidate>
  <fieldset class="rv-fs"><legend class="rv-lbl">What would you like to do?</legend>${pills("rv-kind", KINDS, [presetKind], { type: "radio" })}</fieldset>
  <label class="rv-toggle" data-refers-row><input type="checkbox" name="rv-refers"${field ? " checked" : ""}> This idea refers to something already on the RoboValley website</label>
  <div class="rv-refbox" data-refbox>
    <div class="rv-ttl">RoboValley resource you are referring to</div>
    <div class="rv-grid2">
      <div><label for="rv-f-feature">Feature</label><select id="rv-f-feature">${options(FEATURES, "Robots by Sector")}</select></div>
      <div><label for="rv-f-rtype">Resource type</label><select id="rv-f-rtype">${options(Object.keys(RESOURCE_TYPES), presetType)}</select></div>
    </div>
    <label for="rv-f-rpath">Resource path <span class="rv-opt">(filled from where you started; change it if needed)</span></label>
    <input id="rv-f-rpath" maxlength="${LIMITS.path}" value="${esc(path0)}">
    <div class="rv-grid2">
      <div><label for="rv-f-rurl">Link to that page</label><input id="rv-f-rurl" type="url" maxlength="${LIMITS.url}" value="${esc(url0)}"></div>
      <div><label for="rv-f-rid">Resource ID <span class="rv-opt">(auto, read-only)</span></label><input id="rv-f-rid" readonly></div>
    </div>
    <label for="rv-f-change">What should change?</label>
    <textarea id="rv-f-change" rows="3" maxlength="${LIMITS.change}" placeholder="What is there now, and what you would change or add"></textarea>
  </div>
  <div class="rv-grid2">
    <div>
      <label for="rv-f-name">Your name <span class="rv-opt">(from your profile)</span></label><input id="rv-f-name" readonly value="${esc(me.name)}">
      <label for="rv-f-type">I am a <span class="rv-opt">(from your profile)</span></label><input id="rv-f-type" readonly value="${esc(me.type)}">
      <fieldset class="rv-fs"><legend class="rv-lbl">Category</legend>${pills("rv-cat", CATEGORIES, sample ? SAMPLE.categories : [])}</fieldset>
      <label for="rv-f-sector">Sector <span class="rv-opt">(optional)</span></label><select id="rv-f-sector">${options(sectorOptions, presetSector)}</select>
      <label for="rv-f-robot">Robot type <span class="rv-opt">(optional)</span></label><select id="rv-f-robot"></select>
    </div>
    <div>
      <label for="rv-f-title">Idea title</label><input id="rv-f-title" maxlength="${LIMITS.title}" value="${esc(sample ? SAMPLE.title : "")}">
      <label for="rv-f-desc">Describe your idea</label>
      <textarea id="rv-f-desc" rows="7" maxlength="${LIMITS.description}">${esc(sample ? SAMPLE.description : "")}</textarea>
      <label for="rv-f-file">Photo / attachment <span class="rv-opt">(optional)</span></label>
      <input id="rv-f-file" type="file" accept="image/jpeg,image/png,application/pdf" aria-describedby="rv-f-file-hint">
      <p class="rv-hint" id="rv-f-file-hint">JPEG, PNG or PDF, up to 4 MB. Only moderators and admins can see it.</p>
    </div>
  </div>
  <fieldset class="rv-fs"><legend class="rv-lbl">Reference links <span class="rv-opt">(optional)</span></legend>
    <p class="rv-muted rv-tight">Pages, videos or documents that explain the idea well. Add a short remark for each.</p>
    <div class="rv-refs" data-refs></div>
    <button type="button" class="rv-btn rv-btn-secondary" data-add-ref>+ Add another link</button>
  </fieldset>
  <fieldset class="rv-fs"><legend class="rv-lbl">Suitable for <span class="rv-opt">(optional, pick any)</span></legend>${pills("rv-lvl", LEVELS, sample ? SAMPLE.suitableFor : [])}</fieldset>
  <fieldset class="rv-fs"><legend class="rv-lbl">Suggested path <span class="rv-opt">(optional)</span></legend>${pills("rv-path", paths, pathPick, { type: "radio" })}
    <p class="rv-muted rv-tight">${minor ? "Not sure? Leave it: the moderator will set it." : "Earn path is for learners 18 and above. Not sure? Leave it: the moderator will set it."}</p></fieldset>
  <div class="rv-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="rv-actions"><button type="submit" class="rv-btn rv-btn-primary">Submit Idea</button></div>
  <div class="rv-msg" data-msg></div>
</form>`;
  const form = $(body, "form");
  const kind = () => (checkedValues(form, "rv-kind")[0] || NEW_IDEA);
  const refers = () => $(form, 'input[name="rv-refers"]').checked;
  const updateKind = () => {
    $(form, "[data-refers-row]").hidden = kind() !== NEW_IDEA;
    $(form, "[data-refbox]").hidden = !R.showsResource(kind(), refers());
  };
  const updateId = () => { $(form, "#rv-f-rid").value = R.resourceId($(form, "#rv-f-rtype").value, $(form, "#rv-f-rpath").value); };
  let robot0 = presetRobot; // only for the first fill: changing the sector starts from "Not sure" again
  const updateRobots = () => {
    const s = sectors.find((x) => x.slug === $(form, "#rv-f-sector").value);
    $(form, "#rv-f-robot").innerHTML = options([[NOT_SURE, NOT_SURE_LABEL], ...((s && s.robots) || []).map((r) => [r.slug, r.name])], robot0 || NOT_SURE);
    robot0 = "";
  };
  const addRef = () => {
    const row = document.createElement("div");
    row.className = "rv-refrow";
    row.innerHTML = `<input class="rv-ref-url" type="url" placeholder="https://" aria-label="Reference URL" maxlength="${LIMITS.url}">
      <input class="rv-ref-remark" placeholder="Remark: what this link shows" aria-label="Remark for this link" maxlength="${LIMITS.remark}">
      <button type="button" class="rv-btn rv-btn-secondary rv-rm" aria-label="Remove this link">✕</button>`;
    $(row, ".rv-rm").addEventListener("click", () => { row.remove(); if (!$(form, "[data-refs]").children.length) addRef(); });
    $(form, "[data-refs]").appendChild(row);
  };
  $$(form, 'input[name="rv-kind"]').forEach((x) => x.addEventListener("change", updateKind));
  $(form, 'input[name="rv-refers"]').addEventListener("change", updateKind);
  $(form, "#rv-f-rpath").addEventListener("input", updateId);
  $(form, "#rv-f-rtype").addEventListener("change", updateId);
  $(form, "#rv-f-sector").addEventListener("change", updateRobots);
  $(form, "[data-add-ref]").addEventListener("click", addRef);
  addRef(); updateKind(); updateId(); updateRobots();
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(form, ctx, { kind, refers, addRef, updateKind, updateId, updateRobots }); });
}

/** The page the visitor came from (return_to): a path of this site, or an http(s) address on this site or the app (`origins`); never
 *  anything else, so a link to this form cannot turn "Back to the page you came from" into a link to another website. */
export function safeBack(raw, origins = []) {
  const v = String(raw || "").trim();
  if (!v || v.length > 2048) return "";
  if (/^\/(?![/\\])/.test(v)) return v; // a path on this site (not //host or /\host)
  try { const u = new URL(v); return /^https?:$/.test(u.protocol) && origins.includes(u.origin) ? u.toString() : ""; } catch { return ""; }
}

async function fileProblem(file) {
  if (!file) return null;
  if (file.size > LIMITS.attachmentBytes) return MESSAGES.attachmentSize;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const mime = R.sniffType(head);
  return mime && R.attachmentAllowed(mime) ? null : MESSAGES.attachmentType;
}

async function submit(form, ctx, h) {
  const msg = $(form, "[data-msg]"), btn = $(form, 'button[type="submit"]');
  const data = {
    kind: h.kind(), refers: h.refers(),
    resource: { feature: $(form, "#rv-f-feature").value, type: $(form, "#rv-f-rtype").value, path: $(form, "#rv-f-rpath").value, url: $(form, "#rv-f-rurl").value, change: $(form, "#rv-f-change").value },
    references: $$(form, ".rv-refrow").map((r) => ({ url: $(r, ".rv-ref-url").value, remarks: $(r, ".rv-ref-remark").value })),
    title: $(form, "#rv-f-title").value, description: $(form, "#rv-f-desc").value,
    sector: $(form, "#rv-f-sector").value, robotType: $(form, "#rv-f-robot").value,
    categories: checkedValues(form, "rv-cat"), suitableFor: checkedValues(form, "rv-lvl"), learningPath: checkedValues(form, "rv-path")[0] || "",
    website: $(form, 'input[name="website"]').value,
  };
  const file = $(form, "#rv-f-file").files && $(form, "#rv-f-file").files[0] ? $(form, "#rv-f-file").files[0] : null;
  const { errors } = R.validateSubmission(data, { sectors: ctx.sectors, name: ctx.me.name, minor: ctx.me.minor === true });
  const back = safeBack(ctx.query.get("return_to"), ctx.origins || []);
  const fp = await fileProblem(file);
  if (fp) errors.push(fp);
  if (errors.length) {
    msg.innerHTML = notice("err", errors.map(esc).join("<br>"), "alert");
    msg.querySelector(".rv-notice").setAttribute("tabindex", "-1");
    msg.querySelector(".rv-notice").focus();
    return;
  }
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const r = await ctx.adapter.submit(data, file);
    msg.innerHTML = notice("ok", r.code
      ? `Thank you! Your ${esc(data.kind.toLowerCase())} <b>${esc(r.code)}</b> has been submitted for review. It is <b>not public</b> until an Admin publishes it.`
      : "Thank you! Your idea has been submitted for review. It is <b>not public</b> until an Admin publishes it.")
      + (back ? ` <a class="rv-back" href="${esc(back)}">Back to the page you came from</a>` : "");
    form.reset();
    $(form, "#rv-f-name").value = ctx.me.name; $(form, "#rv-f-type").value = ctx.me.type;
    $(form, "[data-refs]").innerHTML = ""; h.addRef(); h.updateKind(); h.updateId(); h.updateRobots();
  } catch (e) {
    msg.innerHTML = notice("err", String((e && e.message) || MESSAGES.failed).split("\n").map(esc).join("<br>"), "alert");
  } finally {
    btn.disabled = false; btn.textContent = "Submit Idea";
    const n = msg.querySelector(".rv-notice"); if (n) { n.setAttribute("tabindex", "-1"); n.focus(); }
  }
}
