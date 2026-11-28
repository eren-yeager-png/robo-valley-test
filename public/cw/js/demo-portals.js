// Contribution workflow: the STANDALONE DEMO's portals only (never used by the plugin or the app). One portal per role (Visitor, Student,
// Teacher, Parent, Contributor, Moderator, Admin), each with its own navigation, built from the SAME screens production uses: Sectors
// (sectors.js: the sector grid and a panel per role), the website's sector page (sector.js), My Contributions, the form, Moderation (the
// Moderator Workspace merged in), Publish Requests, Sector Forms, the Overview, Sectors, the Audit Log and Community Ideas. The Moderator's
// and the Admin's pages sit in "adm rvd-adm" containers (one column: public/cw/portal.css). Sample data everywhere.
import { esc } from "./utils.js";
import { contributeHref, startSectorPage } from "./sector.js";
import { fieldsOf } from "./sectors.js";
import { askReason } from "./dialog.js";
import { noticeHtml, openDrawer, pageHeader, panelHtml, sentHtml, statusBadge, tableHtml, toast } from "./portal-ui.js";
import { formToPortal } from "./portal-status.js";
import { createDemoPortal } from "./demo-portal.js";

const DEMO_SITE = "https://www.example.org"; // the demo's made-up website address
export const ROLES = [
  { key: "visitor", label: "Visitor", portal: "website" },
  { key: "student", label: "Student", portal: "member", variant: "student", user: { name: "Neha S.", type: "Student", minor: true }, sections: [["projects", "Projects"], ["competitions", "Competitions"]] },
  { key: "teacher", label: "Teacher", portal: "member", variant: "teacher", user: { name: "Kiran P.", type: "Teacher / lab in-charge", minor: false }, sections: [["lessons", "Lesson plans"], ["kits", "Lab kits"]] },
  { key: "parent", label: "Parent", portal: "member", variant: "parent", user: { name: "Meera K.", type: "Parent / guardian", minor: false }, sections: [["children", "My child"], ["events", "Upcoming events"]] },
  { key: "contributor", label: "Contributor", portal: "contributor", variant: "contributor", user: { name: "Dr. S. Rao", type: "Mentor / subject expert", minor: false } },
  { key: "moderator", label: "Moderator", portal: "moderator", user: { name: "Moderator User", type: "Moderator", minor: false } },
  { key: "admin", label: "Admin", portal: "admin", user: { name: "Admin User", type: "Administrator", minor: false } },
];

/** The demo's users and roles (the Admin's Users & Roles page): name, role, portal, the demo role "View as" opens. */
export const DEMO_USERS = [
  ["Admin User", "Administrator", "admin", "admin"], ["Moderator User", "Moderator (Teacher / lab in-charge)", "moderator", "moderator"], ["Neha S.", "Student (under 18)", "member", "student"],
  ["Kiran P.", "Teacher / lab in-charge", "member", "teacher"], ["Meera K.", "Parent / guardian", "member", "parent"], ["Dr. S. Rao", "Mentor / subject expert", "member", "contributor"],
  ["Asha M.", "Teacher / lab in-charge", "member", ""], ["Imran K.", "College / industry partner", "member", ""],
];

/** Ideas sent with the CURRENT form (they keep their Edit while pending), with the moderators' replies. `verified`: a reviewer approved it. */
export const DEMO_FORM_ITEMS = [
  { id: 301, user: "Neha S.", title: "Robot kit lending library at school", body: "Let students borrow robot kits for a week, like library books.", type: "improve", status: "pending_review", sector: "education", robot: "", at: -6 },
  { id: 302, user: "Neha S.", title: "Line follower race day", body: "A race day where teams bring line-following robots.", type: "resource", status: "published", sector: "education", robot: "robotic-arms", at: -40 },
  { id: 303, user: "Kiran P.", title: "Lab safety checklist for robot kits", body: "A one-page checklist for using robot kits safely in the lab.", type: "resource", status: "changes_requested", sector: "education", robot: "", at: -9, reply: "Please add the names of the kits it covers." },
  { id: 304, user: "Kiran P.", title: "Old printer parts for robot arms", body: "Reuse old printer motors to build robot arms.", type: "improve", status: "rejected", sector: "manufacturing", robot: "cobots", at: -30, reply: "We already have a guide for this; please add to it instead." },
  { id: 305, user: "Meera K.", title: "Parents' robotics evening", body: "An evening where parents try the kits their children use.", type: "improve", status: "draft", sector: "education", robot: "", at: -2 },
  { id: 306, user: "Meera K.", title: "Holiday robotics camp list", body: "A list of holiday robotics camps near the city.", type: "resource", status: "published", sector: "education", robot: "", at: -55 },
  { id: 307, user: "Dr. S. Rao", title: "Soil test kit comparison", body: "Compare three soil test kits farmers can buy.", type: "resource", status: "published", sector: "agriculture-dairy", robot: "", at: -70 },
  { id: 308, user: "Dr. S. Rao", title: "Drone pilot training centres", body: "Where farmers can train to fly crop-spraying drones.", type: "resource", status: "pending_review", sector: "agriculture-dairy", robot: "drone-sprayers", at: -4, verified: true },
  { id: 309, user: "Dr. S. Rao", title: "Cheap moisture probe from a fork", body: "A home-made soil moisture probe.", type: "improve", status: "rejected", sector: "agriculture-dairy", robot: "", at: -20, reply: "Not safe to recommend for fields with electric fencing." },
  { id: 310, user: "Moderator User", title: "Robot repair café", body: "A monthly café where volunteers fix broken robot kits.", type: "improve", status: "published", sector: "education", robot: "", at: -120 },
  { id: 311, user: "Admin User", title: "Sector page photo guidelines", body: "Rules for photos on sector pages.", type: "resource", status: "published", sector: "manufacturing", robot: "", at: -150 },
  { id: 312, user: "Kiran P.", title: "Robot club attendance sheet", body: "A printable sheet for robot club attendance.", type: "resource", status: "draft", sector: "education", robot: "", at: -1 },
  { id: 313, user: "Asha M.", title: "Rehabilitation robot visit for physiotherapy students", body: "A visit to a clinic that uses rehabilitation robots, for physiotherapy students.", type: "resource", status: "pending_review", sector: "healthcare", robot: "", at: -3 },
];

/** "Suggest a field" suggestions waiting for an administrator (Admin > Sector Forms). Approving adds the field to the sector. */
export const DEMO_SUGGESTIONS = [
  { sector: "manufacturing", id: "inspection-cameras", title: "Inspection cameras", by: "Imran K.", html: "<p>Cameras with simple AI that spot faulty parts on a production line.</p>", at: -3 },
  { sector: "healthcare", id: "rehabilitation-robots", title: "Rehabilitation robots", by: "Asha M.", html: "<p>Robots that guide patients through physiotherapy exercises.</p>", at: -5 },
];
export const DEMO_PLUGINS = { "local-dealers": "Acme Dealer Directory" };

const nav = (items, active) => `<ul>${items.map(([k, label]) => `<li><a href="#${esc(k)}" data-page="${esc(k)}" class="${k === active ? "active" : ""}"${k === active ? ' aria-current="page"' : ""}>${esc(label)}</a></li>`).join("")}</ul>`;
/** One sidebar item per page, no duplicates within a role. */
export const NAV = {
  website: [["sector", "Robots by Sector"], ["ideas", "Community Ideas"], ["form", "Share Your Idea"], ["mine", "My Contributions"]],
  contributor: [["home", "Dashboard"], ["sectors", "Sectors"], ["mine", "My Contributions"]],
  moderator: [["moderation", "Moderation"], ["mine", "My Contributions"]],
  admin: [["overview", "Overview"], ["requests", "Publish Requests"], ["sector-forms", "Sector Forms"], ["sectors-admin", "Sectors"], ["users", "Users & Roles"], ["ideas", "Community Ideas"], ["audit", "Audit Log"]],
};
export const memberNav = (role) => [["home", "Home"], ...role.sections, ["sectors", "Sectors"], ["mine", "My Contributions"], ["form", "Share Your Idea"], ["notifications", "Notifications"], ["profile", "Profile & settings"]];

/** The website's sector page as WordPress draws it (the theme's title and content); the plugin's script adds the buttons. */
function websiteSectorHtml(s) {
  const cards = fieldsOf(s).map((f) => f.source === "plugin"
    ? `<div class="e-con e-parent acme-plugin-field"><span class="rvd-src rvd-src-p">Added by a plugin</span><h2>${esc(f.title)}</h2>${f.html}</div>`
    : `<div class="rv-rt"${f.source === "suggested" ? ` data-rv-field="${esc(f.id)}"` : ""}>${f.source === "suggested" ? '<span class="rvd-src rvd-src-s">Added through "Suggest a field" (approved)</span>' : ""}<h3>${esc(f.title)}</h3>${f.html}</div>`).join("");
  return `<article class="page type-page rvd-wp-article"><header class="entry-header"><h1 class="entry-title">${esc(s.pageTitle || s.name)}</h1></header>
    <div class="entry-content"><div class="rv-fields-root" data-rv-sector="${esc(s.slug)}">${cards}</div></div></article>`;
}

/**
 * Mounts the portals into `el`. `ctx` = { mock, screens: { form, site, sectors, mine, moderation, requests, sectorForms, overview, audit,
 * sectorsAdmin }, sectors (with fields) }. The mock is shared, so a change made as one role is seen by every other role.
 */
export function mountPortals(el, ctx) {
  const st = { role: "visitor", page: {}, sector: {} };
  const data = createDemoPortal(ctx.mock, { formItems: DEMO_FORM_ITEMS, suggestions: DEMO_SUGGESTIONS, plugins: DEMO_PLUGINS, users: DEMO_USERS });
  ctx.mock.formItems = data.forms; // "My Contributions" reads the same current-form items the reviewers change
  const formUrl = "#form";
  el.innerHTML = `<div class="rvd-roles" role="tablist" aria-label="Role">${ROLES.map((r) => `<button type="button" class="rvd-role" role="tab" data-role="${r.key}" aria-selected="false">${esc(r.label)}</button>`).join("")}</div><div class="rvd-portal-host" data-host></div>`;
  const host = el.querySelector("[data-host]");
  const handles = [];
  const stop = () => { while (handles.length) { const h = handles.pop(); if (h && h.stop) h.stop(); } };
  const roleOf = () => ROLES.find((r) => r.key === st.role);

  function show(roleKey, page) {
    st.role = roleKey;
    const role = roleOf();
    const items = role.portal === "member" ? memberNav(role) : NAV[role.portal];
    st.page[roleKey] = page || st.page[roleKey] || items[0][0];
    el.querySelectorAll("[data-role]").forEach((b) => { const on = b.getAttribute("data-role") === roleKey; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    const brand = role.portal === "website" ? "RoboValley website (signed out)" : role.portal === "member" || role.portal === "contributor" ? `RoboValley Community · ${role.user.type}` : role.portal === "moderator" ? "RoboValley Admin · Moderator" : "RoboValley Admin · Administrator";
    stop();
    host.innerHTML = `<div class="rvd-portal rvd-portal--${role.portal}"><aside class="rvd-nav"><div class="rvd-brand">${esc(brand)}${role.user ? `<small>${esc(role.user.name)}</small>` : ""}</div><nav aria-label="${esc(role.label)} navigation">${nav(items, st.page[roleKey])}</nav></aside>
      <main class="rvd-main" data-main></main></div>`;
    host.querySelectorAll("[data-page]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(roleKey, a.getAttribute("data-page")); }));
    render(role, st.page[roleKey], host.querySelector("[data-main]"));
  }
  const goForm = (query) => { ctx.formQuery = query || null; show(st.role === "visitor" ? "visitor" : st.role, roleOf().portal === "contributor" ? "sectors" : "form"); };
  // every "Contribute" link in the demo opens the form of the role you are in, with the sector and field filled in
  el.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    const item = t && t.closest('a[href^="#form-item-"]');
    if (item) { e.preventDefault(); openFormItem(Number(item.getAttribute("href").replace("#form-item-", ""))); return; }
    const a = t && t.closest("a.rv-contribute-btn, a.rv-sector-suggest__link, a.rv-field-contribute, a[data-contribute]");
    if (!a || !a.getAttribute("href")) return;
    e.preventDefault();
    goForm(new URL(a.href, location.href).searchParams);
  });

  // an item sent with the current form: what it says, and the reviewer's decisions (the app has its own page for this)
  function openFormItem(id) {
    const x = data.formItem(id);
    if (!x) return;
    const role = roleOf(), reviewer = role.portal === "moderator" || role.portal === "admin";
    const adapter = data.as(role.portal === "admin" ? "admin" : "moderator");
    const can = (a) => reviewer && ({ verify: x.status === "pending_review" && !x.verified, request_changes: x.status === "pending_review", reject: x.status === "pending_review",
      approve: role.portal === "admin" && x.status === "pending_review", unpublish: role.portal === "admin" && x.status === "published", republish: role.portal === "admin" && x.status === "unpublished" })[a];
    const dr = openDrawer({ title: `C-${x.id} · ${x.title}`, doc: el.ownerDocument, host: el.querySelector("[data-main]") || el,
      body: `<p>${statusBadge(formToPortal(x.status, x.verified) || "draft")}</p><p>${esc(x.body)}</p><p class="rv-pp-muted">Sent by ${esc(x.user)} with the current form · ${sentHtml(new Date(Date.now() + x.at * 864e5).toISOString())}</p>
        ${x.reply ? noticeHtml("info", `<b>Reviewer:</b> ${esc(x.reply)}`) : ""}<p class="rv-pp-desc">Items sent with the current form are edited only by their contributor.</p><div data-msg></div>`,
      foot: [["verify", "Approve as-is", "primary"], ["approve", "Approve and publish", "primary"], ["request_changes", "Ask for changes", ""], ["reject", "Reject", "danger"], ["unpublish", "Unpublish", "danger"], ["republish", "Publish again", "primary"]]
        .filter(([a]) => can(a)).map(([a, l, c]) => `<button type="button" class="btn${c ? " " + c : ""}" data-fact="${a}">${l}</button>`).join("") || '<span class="rv-pp-muted">Nothing to decide here.</span>' });
    dr.el.querySelectorAll("[data-fact]").forEach((b) => b.addEventListener("click", async () => {
      const a = b.getAttribute("data-fact");
      const note = ["request_changes", "reject", "unpublish"].includes(a) ? await askReason({ title: b.textContent, label: "Reason (the contributor sees it)", confirmText: b.textContent }) : "";
      if (note === null) return;
      try { await adapter.formDecision(x.id, a, note || ""); dr.close(); toast(el, `${b.textContent}: "${x.title}".`); show(st.role, st.page[st.role]); }
      catch (err) { dr.body.querySelector("[data-msg]").innerHTML = noticeHtml("err", esc(err.message)); }
    }));
  }

  function render(role, page, main) {
    const sectors = ctx.sectors;
    const me = role.user || null;
    const S = ctx.screens;
    const adm = (fn) => { main.innerHTML = '<div class="rv"><div class="adm rvd-adm"><div data-mount></div></div></div>'; return Promise.resolve(fn(main.querySelector("[data-mount]"))).then((h) => { if (h) handles.push(h); }); };
    const app = (fn) => { main.innerHTML = '<div class="rv-cw-root"><div data-mount></div></div>'; return Promise.resolve(fn(main.querySelector("[data-mount]"))).then((h) => { if (h) handles.push(h); }); };
    const remember = (key) => (slug) => { st.sector[key] = slug; };
    const memberAdapter = () => ({ ...ctx.mock.asMember(me), publicList: () => ctx.mock.publicList() });

    if (page === "sector") { // the website's Robots by Sector: the sector grid, the published ideas and the fields, all signed out
      return app((m) => S.sectors.mount(m, { adapter: { formConfig: () => ctx.mock.formConfig(), publicList: () => ctx.mock.publicList(), mine: async () => ({ items: [] }) }, form: formUrl, variant: "visitor",
        sector: st.sector.visitor || "", onSector: remember("visitor"), onSectorPage: (slug) => { st.sector.visitor = slug; show("visitor", "sector-page"); } }));
    }
    if (page === "sector-page") { // the WordPress page itself, with the plugin's header button and a button on every field
      const s = sectors.find((x) => x.slug === (st.sector.visitor || sectors[0].slug)) || sectors[0];
      main.innerHTML = `<p class="rvd-back"><a href="#sector" data-back>← Robots by Sector</a> · <a class="rv-sector-suggest__link" href="${esc(contributeHref(formUrl, { sector: s.slug, resourcePath: `Robots by Sector › ${s.name}` }))}&kind=Suggestion">+ Suggest a field</a></p>
        <div class="rvd-wp" data-wp>${websiteSectorHtml(s)}</div>`;
      main.querySelector("[data-back]").addEventListener("click", (e) => { e.preventDefault(); show("visitor", "sector"); });
      handles.push(startSectorPage({ sector: s.slug, sectorName: s.name, form: formUrl, off: [], root: main.querySelector("[data-wp]") }, document));
      return;
    }
    if (page === "ideas") return role.portal === "admin" ? adm((m) => { m.innerHTML = `${pageHeader({ title: "Community Ideas", desc: "What the public sees on the Community Ideas page right now. Publish, update or unpublish a card in Publish Requests.", id: "rvd-ci-h" })}<div data-site></div>`; m.classList.add("rv-pp"); return S.site.mount(m.querySelector("[data-site]"), { adapter: ctx.mock }); })
      : app((m) => S.site.mount(m, { adapter: ctx.mock }));
    if (page === "form") {
      const q = ctx.formQuery || new URLSearchParams("");
      ctx.formQuery = null;
      if (role.portal === "website") return app((m) => S.form.mount(m, { adapter: { ...ctx.mock, me: async () => ({ signedIn: false }), formConfig: () => ctx.mock.formConfig(), loginUrl: () => "#sign-in" }, query: q }));
      return app((m) => S.form.mount(m, { adapter: ctx.mock.asMember(me), query: q, sample: !q.toString() }));
    }
    if (page === "mine") {
      if (role.portal === "website") { main.innerHTML = `<div class="rv-cw-root rv-pp">${pageHeader({ title: "My Contributions", id: "rvd-mine-h" })}${noticeHtml("info", "Please sign in with your RoboValley member account to see your contributions. You come back here after signing in.")}<p><a class="btn" href="#sign-in">Sign in</a></p></div>`; return; }
      const mine = () => ctx.mock.mine(me);
      return role.portal === "moderator" ? adm((m) => S.mine.mount(m, { adapter: { mine }, contributeUrl: formUrl })) : app((m) => S.mine.mount(m, { adapter: { mine }, contributeUrl: formUrl }));
    }
    if (page === "sectors") {
      const quick = ctx.formQuery && role.portal === "contributor" ? ctx.formQuery : null;
      if (quick) { ctx.formQuery = null; st.sector[role.key] = quick.get("sector") || st.sector[role.key]; }
      return app((m) => S.sectors.mount(m, { adapter: memberAdapter(), form: formUrl, variant: role.variant, quickForm: role.portal === "contributor", sector: st.sector[role.key] || "", onSector: remember(role.key) }));
    }
    if (page === "home") {
      return ctx.mock.mine(me).then((r) => {
        const n = (k) => r.items.filter((i) => i.status === k).length;
        const go = role.portal === "contributor" ? [["sectors", "Contribute to a sector", "primary"], ["mine", "My Contributions", ""]] : [["form", "Share your idea", "primary"], ["sectors", "Browse sectors", ""], ["mine", "My Contributions", ""]];
        main.innerHTML = `<section class="rv-pp rvd-home">${pageHeader({ title: `Welcome, ${me.name}`, desc: me.type, id: "rvd-home-h" })}
          <div class="rv-pp-stats" role="list"><div class="rv-pp-stat" role="listitem"><span class="rv-pp-stat__n">${r.items.length}</span><span class="rv-pp-stat__l">My contributions</span></div><div class="rv-pp-stat" role="listitem"><span class="rv-pp-stat__n">${n("pending") + n("approved")}</span><span class="rv-pp-stat__l">In review</span></div><div class="rv-pp-stat" role="listitem"><span class="rv-pp-stat__n">${n("published")}</span><span class="rv-pp-stat__l">Published</span></div><div class="rv-pp-stat" role="listitem"><span class="rv-pp-stat__n">${sectors.length}</span><span class="rv-pp-stat__l">Sectors</span></div></div>
          <div class="rv-pp-actions">${go.map(([k, l, c]) => `<a class="btn${c ? " " + c : ""}" href="#" data-go="${k}">${l}</a>`).join("")}</div></section>`;
        main.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(role.key, a.getAttribute("data-go")); }));
      });
    }
    if (page === "notifications") {
      main.innerHTML = `<section class="rv-pp rvd-page">${pageHeader({ title: "Notifications", id: "rvd-nt-h" })}<ul class="rvd-list"><li><b>Your idea was reviewed.</b> A Moderator is looking at your latest idea. <span class="cw-muted">today</span></li><li><b>New sector field.</b> "Soil and water sensors" was added to Agriculture &amp; Dairy after a member suggested it. <span class="cw-muted">2 days ago</span></li><li><b>Welcome to RoboValley.</b> <span class="cw-muted">last month</span></li></ul></section>`;
      return;
    }
    if (page === "profile") {
      main.innerHTML = `<section class="rv-pp rvd-page">${pageHeader({ title: "Profile & settings", id: "rvd-pr-h" })}<dl class="rv-pp-dl"><dt>Name</dt><dd>${esc(me.name)}</dd><dt>I am a</dt><dd>${esc(me.type)}${me.minor ? " (under 18)" : ""}</dd><dt>District</dt><dd>Guntur</dd><dt>Language</dt><dd>English</dd></dl></section>`;
      return;
    }
    if (role.portal === "member" && role.sections.some((x) => x[0] === page)) { // a role's own sections (placeholders in the app too)
      const label = role.sections.find((x) => x[0] === page)[1];
      main.innerHTML = `<section class="rv-pp rvd-page">${pageHeader({ title: label, id: "rvd-sec-h" })}<p class="cw-muted">This part of the ${esc(role.label)} portal is planned. Meanwhile: <a href="#" data-go="sectors">browse the sectors</a> or <a href="#" data-go="form">share an idea</a>.</p><div class="rv-pp-stats"><div class="rv-pp-stat"><span class="rv-pp-stat__n">3</span><span class="rv-pp-stat__l">Coming up</span></div><div class="rv-pp-stat"><span class="rv-pp-stat__n">2</span><span class="rv-pp-stat__l">Saved</span></div></div></section>`;
      main.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(role.key, a.getAttribute("data-go")); }));
      return;
    }
    const as = data.as(role.portal === "admin" ? "admin" : "moderator");
    if (page === "moderation") return adm((m) => S.moderation.mount(m, { adapter: as, form: formUrl, sector: st.sector.moderation || "", onSector: remember("moderation") }));
    if (page === "requests") return adm((m) => S.requests.mount(m, { adapter: as, sector: st.sector.requests || "", onSector: remember("requests") }));
    if (page === "sector-forms") return adm((m) => S.sectorForms.mount(m, { adapter: as, form: formUrl, sector: st.sector.forms || "", onSector: remember("forms") }));
    if (page === "sectors-admin") return adm((m) => S.sectorsAdmin.mount(m, { adapter: as, sector: st.sector.sectorsAdmin || "", onSector: remember("sectorsAdmin"), moderationPath: "#moderation", sectorFormsPath: "#sector-forms" }));
    if (page === "overview") return adm((m) => S.overview.mount(m, { adapter: as, onSector: (slug) => { st.sector.requests = slug; show("admin", "requests"); } }));
    if (page === "audit") return adm((m) => S.audit.mount(m, { adapter: as }));
    if (page === "users") {
      return adm((m) => {
        m.classList.add("rv-pp");
        m.innerHTML = `${pageHeader({ title: "Users & Roles", desc: "Everyone with an account, their role and their portal. \"View as\" shows what that person sees.", id: "rvd-users-h" })}
          ${panelHtml({ heading: "People", id: "rvd-users-panel-h", sub: "Assigning roles and moderators per sector come with the data update (Phase B).",
            body: tableHtml({ caption: "Users and roles", head: [["Name", "rv-pp-col-title"], ["Role"], ["Portal"], ["", "rv-pp-col-actions"]],
              rows: DEMO_USERS.map(([n, r, p, k]) => `<tr><td class="rv-pp-col-title"><b>${esc(n)}</b></td><td>${esc(r)}</td><td>${esc(p === "member" ? "Member portal" : p === "moderator" ? "Admin portal (moderator)" : "Admin portal")}</td>
                <td class="rv-pp-col-actions">${k ? `<button type="button" class="btn small" data-view-as="${esc(k)}" aria-label="${esc(`View as ${n}`)}">View as</button>` : '<span class="rv-pp-muted">—</span>'}</td></tr>`) }) })}`;
        m.querySelectorAll("[data-view-as]").forEach((b) => b.addEventListener("click", () => show(b.getAttribute("data-view-as"))));
      });
    }
    main.innerHTML = '<p class="cw-muted">Nothing here.</p>';
  }
  el.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => show(b.getAttribute("data-role"))));
  show("visitor");
  return { show, site: DEMO_SITE, data };
}
