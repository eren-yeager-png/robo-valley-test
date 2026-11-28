// Contribution workflow: the Member portals' "Sectors" (and the demo's Visitor, Student, Teacher, Parent and Contributor sectors).
// One column: the header, the sector grid (from Sector Forms, so a new sector appears by itself) and the selected sector's panel with
// "+ Contribute to this sector" and a "Contribute" button on every field. What the panel shows depends on who is looking (opts.variant):
//   visitor / student: the sector's published ideas and its fields;
//   teacher: the same, with a view-only "Classroom pick" tag on ideas suitable for school classes;
//   parent: "Explore sectors for your family": a "Relevant to your child" chip on sectors with ideas safe for children (those first),
//     tabs Published ideas | Safe for kids | My contributions (read-only: Title, Status, Sent); no publishing, no moderation;
//   contributor: each card counts "my ideas"; the panel is "Contribute to <Sector>"; with opts.quickForm the buttons open the short form
//     (Title, Field, Description, Attachment) in a dialog, the field's button with the field filled in, and the idea goes to review.
// opts.slug draws ONE sector's full page instead (the SAME shared sector page component as the website: sector.js).
import { esc } from "./utils.js";
import { RestAdapter } from "./api.js";
import { EARN } from "./lists.js";
import { PLUS, contributeHref, headerButtonHtml, sectorPageHtml, startSectorPage } from "./sector.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { bindTabs, emptyHtml, fmtSent, noticeHtml, pageHeader, panelHtml, tabsHtml, toast } from "./portal-ui.js";
import { mount as mountMine } from "./mine.js";
import { openContribute } from "./contribute-modal.js";

const about = (s) => s.description || `Robots at work in ${s.name}: share a problem you see, an idea, or a resource that helps others.`;
/** School classes (the "Suitable for" levels a child is in). */
export const SCHOOL_LEVELS = ["K1–K5", "K6–K8", "K9–K10", "K11–K12"];
export const isClassroomPick = (r) => (r.suitableFor || []).some((l) => SCHOOL_LEVELS.includes(l));
export const isSafeForKids = (r) => isClassroomPick(r) && r.learningPath !== EARN;
export const VARIANTS = {
  visitor: { title: "Robots by Sector", desc: "Every RoboValley sector and the ideas published in it. Sign in or join to contribute.", heading: (n) => `Ideas for ${n}` },
  student: { title: "Sectors", desc: "Every RoboValley sector: the ideas published in it, and a button to contribute to the sector or to one of its fields.", heading: (n) => `Ideas for ${n}` },
  teacher: { title: "Sectors", desc: "Every RoboValley sector: published ideas (classroom picks are tagged) and a button to contribute.", heading: (n) => `Classroom ideas for ${n}` },
  parent: { title: "Explore sectors for your family", desc: "Ideas you can explore with your child, the ones safe for children, and what you have contributed.", heading: (n) => `Family ideas for ${n}` },
  contributor: { title: "Sectors", desc: "Pick a sector to contribute to it or to one of its fields. Each card shows how many ideas you have sent there.", heading: (n) => `Contribute to ${n}` },
};
const notice = (kind, text) => noticeHtml(kind, esc(text));

/** The fields of a sector page: the demo gives them; the app makes them from the sector's robot types (Sector Forms). */
export function fieldsOf(s) {
  if (Array.isArray(s.fields) && s.fields.length) return s.fields;
  return [
    { id: "about-this-sector", title: "About this sector", html: `<p>${esc(about(s))}</p>` },
    ...(s.robots || []).map((r) => ({ id: r.slug, title: r.name, html: `<p>Problems, ideas and resources about ${esc(r.name.toLowerCase())} in ${esc(s.name)}.</p>` })),
  ];
}
/** The fields a member can contribute to (the "About" card is the sector itself). */
const pickable = (s) => fieldsOf(s).filter((f) => f.id !== "about-this-sector");

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const form = opts.form || "/contribute-now/";
  const here = () => opts.returnTo || (typeof location !== "undefined" ? location.href : "");
  el.classList.add("rv-cw-root");
  let sectors;
  try { sectors = (await adapter.formConfig()).sectors || []; } catch (e) {
    el.innerHTML = notice("err", e && e.status === 503 ? "Sectors are not available yet." : "The sectors could not be loaded. Please try again.");
    return null;
  }
  if (opts.slug) { // one sector's full page (the website's layout)
    const s = sectors.find((x) => x.slug === opts.slug);
    if (!s) { el.innerHTML = notice("info", "We could not find that sector."); return null; }
    const href = contributeHref(form, { sector: s.slug, returnTo: here() });
    const suggestHref = `${contributeHref(form, { sector: s.slug, resourcePath: `Robots by Sector › ${s.name}`, returnTo: here() })}&kind=Suggestion`;
    el.innerHTML = sectorPageHtml({ sector: s, fields: fieldsOf(s), href, suggestHref, intro: opts.intro || "" });
    return startSectorPage({ sector: s.slug, sectorName: s.name, form, off: opts.off || [], header: false, returnTo: here(), root: el }, el.ownerDocument);
  }

  const variant = VARIANTS[opts.variant] ? opts.variant : "student";
  const V = VARIANTS[variant];
  el.classList.add("rv-pp");
  const st = { sector: opts.sector || "", tab: "published", ideas: [], mine: [] };
  const loadIdeas = async () => { try { st.ideas = (await adapter.publicList()).items || []; } catch { st.ideas = []; } };
  const loadMine = async () => { if (variant !== "parent" && variant !== "contributor") return; try { st.mine = (await adapter.mine()).items || []; } catch { st.mine = []; } };
  await Promise.all([loadIdeas(), loadMine()]);

  const ideasIn = (slug) => st.ideas.filter((r) => r.sector === slug);
  const kidsIn = (slug) => ideasIn(slug).filter(isSafeForKids);
  const mineIn = (slug) => st.mine.filter((i) => i.sector === slug);
  function ordered() {
    if (variant !== "parent") return sectors;
    return sectors.map((s, i) => ({ s, i, k: kidsIn(s.slug).length })).sort((a, b) => (b.k > 0) - (a.k > 0) || b.k - a.k || a.i - b.i).map((x) => x.s);
  }
  const card = (s) => {
    const n = ideasIn(s.slug).length, f = pickable(s).length;
    if (variant === "contributor") { const m = mineIn(s.slug).length; return { slug: s.slug, name: s.name, meta: `My ideas: ${m} · ${plural(f, "field")}`, count: m || undefined, countLabel: `${plural(m, "idea")} you sent` }; }
    return { slug: s.slug, name: s.name, meta: `${plural(n, "idea")} · ${plural(f, "field")}`, chip: variant === "parent" && kidsIn(s.slug).length ? "Relevant to your child" : "" };
  };
  const contributeTo = (s, field = "") => {
    if (opts.quickForm) return field ? `<button type="button" class="btn small" data-quick="${esc(field)}">Contribute</button>`
      : `<button type="button" class="rv-contribute-btn rv-contribute-btn--header" data-quick="">${PLUS}<span>Contribute to this sector</span></button>`;
    return field ? `<a class="btn small rv-field-contribute" href="${esc(contributeHref(form, { sector: s.slug, field, returnTo: here() }))}">Contribute</a>` : headerButtonHtml(contributeHref(form, { sector: s.slug, returnTo: here() }));
  };
  const ideaHtml = (r) => `<article class="rv-pp-idea"><h4 class="rv-pp-idea__t">${esc(r.title)}</h4>
    <p class="rv-pp-idea__d">${esc(String(r.description || "").slice(0, 220))}${String(r.description || "").length > 220 ? "…" : ""}</p>
    <p class="rv-pp-idea__m">${r.contributor ? `Idea by ${esc(r.contributor.name)}${r.contributor.type ? ` (${esc(r.contributor.type)})` : ""} · ` : ""}${esc(fmtSent(r.publishedAt))}</p>
    <p class="rv-pp-idea__tags">${(r.categories || []).map((c) => `<span class="rv-pp-tag">${esc(c)}</span>`).join("")}${variant === "teacher" && isClassroomPick(r) ? '<span class="rv-pp-tag rv-pp-tag--pick">Classroom pick</span>' : ""}${variant === "parent" && isSafeForKids(r) ? '<span class="rv-pp-tag rv-pp-tag--pick">Safe for kids</span>' : ""}</p></article>`;
  const ideasHtml = (list, empty) => (list.length ? `<div class="rv-pp-ideas">${list.map(ideaHtml).join("")}</div>` : emptyHtml(empty));
  const fieldsHtml = (s) => {
    const list = pickable(s);
    return list.length ? `<ul class="rv-pp-fieldcards">${list.map((f) => `<li class="rv-pp-fieldcard" data-rv-field="${esc(f.id)}"><span class="rv-pp-fieldcard__name">${esc(f.title)}</span>${contributeTo(s, f.id)}</li>`).join("")}</ul>`
      : emptyHtml("No fields yet: contribute to the sector itself.");
  };

  function render() {
    const list = ordered();
    if (!st.sector || !sectors.some((s) => s.slug === st.sector)) st.sector = (list[0] || {}).slug || "";
    const s = sectors.find((x) => x.slug === st.sector) || null;
    let body = "";
    if (s && variant === "parent") {
      body = `${tabsHtml([["published", "Published ideas", ideasIn(s.slug).length], ["kids", "Safe for kids", kidsIn(s.slug).length], ["mine", "My contributions", mineIn(s.slug).length]], st.tab, { label: "Ideas", controls: "rv-sec-tab" })}
        <div id="rv-sec-tab" role="tabpanel" aria-labelledby="rv-pp-tab-${st.tab}" data-tabpanel>${st.tab === "kids" ? ideasHtml(kidsIn(s.slug), "No ideas in this sector are marked as suitable for school classes yet.")
          : st.tab === "mine" ? '<div data-mine></div>' : ideasHtml(ideasIn(s.slug), "No ideas published in this sector yet.")}</div>
        <h3 class="rv-pp-section-title">Fields</h3>${fieldsHtml(s)}`;
    } else if (s && variant === "contributor") {
      body = `<h3 class="rv-pp-section-title">Fields</h3><p class="rv-pp-desc">Each field's button fills it in for you.</p>${fieldsHtml(s)}
        <h3 class="rv-pp-section-title">Your ideas in ${esc(s.name)}</h3><div data-mine></div>`;
    } else if (s) {
      body = `<h3 class="rv-pp-section-title">Published ideas</h3>${ideasHtml(ideasIn(s.slug), "No ideas published in this sector yet.")}
        <h3 class="rv-pp-section-title">Fields</h3>${fieldsHtml(s)}`;
    }
    el.innerHTML = `${pageHeader({ title: V.title, desc: V.desc, id: "rv-sectors-h", actions: variant === "visitor" ? "" : opts.quickForm ? "" : `<a class="btn primary" href="${esc(contributeHref(form, { returnTo: here() }))}">Share your idea</a>` })}
      ${sectors.length ? sectorGridHtml({ sectors: list.map(card), selected: st.sector, label: "Sectors" }) : notice("info", "No sectors yet.")}
      ${s ? panelHtml({
        heading: V.heading(s.name), id: "rv-sectors-panel-h", sub: about(s),
        actions: `${contributeTo(s)}${opts.onSectorPage ? '<button type="button" class="btn" data-sector-page>See the sector page</button>' : opts.basePath && variant !== "visitor" ? `<a class="btn" href="${esc(`${opts.basePath}/${encodeURIComponent(s.slug)}`)}">Open the sector page</a>` : ""}`,
        body,
      }) : ""}`;
    bindSectorGrid(el, pick);
    bindTabs(el, (k, keyboard) => { st.tab = k; render(); if (keyboard) { const t = el.querySelector(`[data-tab="${k}"]`); if (t) t.focus(); } });
    const sp = el.querySelector("[data-sector-page]");
    if (sp && s) sp.addEventListener("click", () => opts.onSectorPage(s.slug));
    const m = el.querySelector("[data-mine]");
    if (m && s) mountMine(m, { data: { items: st.mine }, onlySector: s.slug, compact: true, readOnly: true });
    el.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => openContribute({
      adapter, sector: s, fields: pickable(s), field: b.getAttribute("data-quick"), doc: el.ownerDocument, host: el,
      onDone: async (r) => { toast(el, `Thank you! "${r.title}" was sent and is pending review.`); await loadMine(); render(); },
    })));
  }
  async function pick(slug) {
    if (!slug || slug === st.sector) return;
    st.sector = slug; st.tab = "published";
    if (opts.onSector) opts.onSector(slug);
    else if (typeof history !== "undefined" && opts.basePath) history.replaceState(null, "", `${opts.basePath}?sector=${encodeURIComponent(slug)}`);
    render();
    const c = el.querySelector(`.rv-sg [data-sector="${slug}"]`); if (c) c.focus();
  }
  render();
  return null;
}
