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
  const query = opts.query || new URLSearchParams(typeof location !== "undefined" ? location.search : "");
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
    const back = typeof location !== "undefined" ? location.href : "";
    body.innerHTML = notice("info", esc(MESSAGES.signIn)) + `<p><a class="rv-btn rv-btn-primary" href="${esc(adapter.loginUrl(back))}">Sign in</a></p>`;
    return;
  }
  if (me.reviewer) { body.innerHTML = notice("info", esc(MESSAGES.reviewerCannot)); return; }
  renderForm(body, { adapter, me, sectors: cfg.sectors || [], query, sample: opts.sample === true });
}

function renderForm(body, ctx) {
  const { me, sectors, query, sample } = ctx;
  const presetSector = sectors.some((s) => s.slug === query.get("sector")) ? query.get("sector") : NOT_SURE;
  const sectorOptions = [[NOT_SURE, NOT_SURE_LABEL], ...sectors.map((s) => [s.slug, s.name])];
  const path0 = query.get("resource_path") || (sample ? SAMPLE.resourcePath : "");
  const url0 = query.get("resource_url") || (sample ? SAMPLE.resourceUrl : "");
  const minor = me.minor === true;
  const paths = minor ? PATHS.filter((x) => x !== EARN) : PATHS; // the Earn (18+) path is for learners 18 and above
  const pathPick = sample && paths.includes(SAMPLE.learningPath) ? [SAMPLE.learningPath] : [];
  body.innerHTML = `<form class="rv-form" novalidate>
  <fieldset class="rv-fs"><legend class="rv-lbl">What would you like to do?</legend>${pills("rv-kind", KINDS, [NEW_IDEA], { type: "radio" })}</fieldset>
  <label class="rv-toggle" data-refers-row><input type="checkbox" name="rv-refers"> This idea refers to something already on the RoboValley website</label>
  <div class="rv-refbox" data-refbox>
    <div class="rv-ttl">RoboValley resource you are referring to</div>
    <div class="rv-grid2">
      <div><label for="rv-f-feature">Feature</label><select id="rv-f-feature">${options(FEATURES, "Robots by Sector")}</select></div>
      <div><label for="rv-f-rtype">Resource type</label><select id="rv-f-rtype">${options(Object.keys(RESOURCE_TYPES), "Robot type")}</select></div>
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
  const updateRobots = () => {
    const s = sectors.find((x) => x.slug === $(form, "#rv-f-sector").value);
    $(form, "#rv-f-robot").innerHTML = options([[NOT_SURE, NOT_SURE_LABEL], ...((s && s.robots) || []).map((r) => [r.slug, r.name])], NOT_SURE);
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
      : "Thank you! Your idea has been submitted for review. It is <b>not public</b> until an Admin publishes it.");
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
