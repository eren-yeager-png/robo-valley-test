// Contribution workflow: the STANDALONE DEMO's portals only (never used by the plugin or the app). One portal per role (Visitor, Student,
// Teacher, Parent, Contributor, Moderator, Admin), each with the shared navigation ("My Contributions" in every one), built from the
// SAME screens production uses: the sector page (sector.js: the header button and a button on every field), Sectors, My
// Contributions, the form, the Moderator Workspace, the Admin Approval Dashboard and Community Ideas. Sample data everywhere.
import { esc, fmtDate } from "./utils.js";
import { contributeHref, sectorHeaderHtml, startSectorPage } from "./sector.js";
import { fieldsOf } from "./sectors.js";

const DEMO_SITE = "https://www.example.org"; // the demo's made-up website address
export const ROLES = [
  { key: "visitor", label: "Visitor", portal: "website" },
  { key: "student", label: "Student", portal: "member", user: { name: "Neha S.", type: "Student", minor: true }, sections: [["projects", "Projects"], ["competitions", "Competitions"]] },
  { key: "teacher", label: "Teacher", portal: "member", user: { name: "Kiran P.", type: "Teacher / lab in-charge", minor: false }, sections: [["lessons", "Lesson plans"], ["kits", "Lab kits"]] },
  { key: "parent", label: "Parent", portal: "member", user: { name: "Meera K.", type: "Parent / guardian", minor: false }, sections: [["children", "My child"], ["events", "Upcoming events"]] },
  { key: "contributor", label: "Contributor", portal: "member", user: { name: "Dr. S. Rao", type: "Mentor / subject expert", minor: false }, sections: [["mentoring", "Mentoring"], ["sessions", "Sessions"]] },
  { key: "moderator", label: "Moderator", portal: "moderator", user: { name: "Moderator User", type: "Moderator", minor: false } },
  { key: "admin", label: "Admin", portal: "admin", user: { name: "Admin User", type: "Administrator", minor: false } },
];

/** The demo's users and roles (the Admin's Users & roles page). */
export const DEMO_USERS = [
  ["Admin User", "Administrator", "admin"], ["Moderator User", "Moderator (Teacher / lab in-charge)", "moderator"], ["Neha S.", "Student (under 18)", "member"],
  ["Kiran P.", "Teacher / lab in-charge", "member"], ["Meera K.", "Parent / guardian", "member"], ["Dr. S. Rao", "Mentor / subject expert", "member"],
  ["Asha M.", "Teacher / lab in-charge", "member"], ["Imran K.", "College / industry partner", "member"],
];

/** Ideas sent with the CURRENT form (they keep their Edit while pending), with the moderators' replies. */
export const DEMO_FORM_ITEMS = [
  { id: 301, user: "Neha S.", title: "Robot kit lending library at school", body: "Let students borrow robot kits for a week, like library books.", type: "improve", status: "pending_review", sector: "education", robot: "", at: -6 },
  { id: 302, user: "Neha S.", title: "Line follower race day", body: "A race day where teams bring line-following robots.", type: "resource", status: "published", sector: "education", robot: "robotic-arms", at: -40 },
  { id: 303, user: "Kiran P.", title: "Lab safety checklist for robot kits", body: "A one-page checklist for using robot kits safely in the lab.", type: "resource", status: "changes_requested", sector: "education", robot: "", at: -9, reply: "Please add the names of the kits it covers." },
  { id: 304, user: "Kiran P.", title: "Old printer parts for robot arms", body: "Reuse old printer motors to build robot arms.", type: "improve", status: "rejected", sector: "manufacturing", robot: "cobots", at: -30, reply: "We already have a guide for this; please add to it instead." },
  { id: 305, user: "Meera K.", title: "Parents' robotics evening", body: "An evening where parents try the kits their children use.", type: "improve", status: "draft", sector: "education", robot: "", at: -2 },
  { id: 306, user: "Meera K.", title: "Holiday robotics camp list", body: "A list of holiday robotics camps near the city.", type: "resource", status: "published", sector: "education", robot: "", at: -55 },
  { id: 307, user: "Dr. S. Rao", title: "Soil test kit comparison", body: "Compare three soil test kits farmers can buy.", type: "resource", status: "published", sector: "agriculture-dairy", robot: "", at: -70 },
  { id: 308, user: "Dr. S. Rao", title: "Drone pilot training centres", body: "Where farmers can train to fly crop-spraying drones.", type: "resource", status: "pending_review", sector: "agriculture-dairy", robot: "drone-sprayers", at: -4 },
  { id: 309, user: "Dr. S. Rao", title: "Cheap moisture probe from a fork", body: "A home-made soil moisture probe.", type: "improve", status: "rejected", sector: "agriculture-dairy", robot: "", at: -20, reply: "Not safe to recommend for fields with electric fencing." },
  { id: 310, user: "Moderator User", title: "Robot repair café", body: "A monthly café where volunteers fix broken robot kits.", type: "improve", status: "published", sector: "education", robot: "", at: -120 },
  { id: 311, user: "Admin User", title: "Sector page photo guidelines", body: "Rules for photos on sector pages.", type: "resource", status: "published", sector: "manufacturing", robot: "", at: -150 },
  { id: 312, user: "Kiran P.", title: "Robot club attendance sheet", body: "A printable sheet for robot club attendance.", type: "resource", status: "draft", sector: "education", robot: "", at: -1 },
];

/** "Suggest a field" suggestions waiting for an administrator (Admin > Sector Forms). Approving adds the field to the sector. */
export const DEMO_SUGGESTIONS = [
  { sector: "manufacturing", id: "inspection-cameras", title: "Inspection cameras", by: "Imran K.", html: "<p>Cameras with simple AI that spot faulty parts on a production line.</p>" },
  { sector: "healthcare", id: "rehabilitation-robots", title: "Rehabilitation robots", by: "Asha M.", html: "<p>Robots that guide patients through physiotherapy exercises.</p>" },
];

const nav = (items, active) => `<ul>${items.map(([k, label]) => `<li><a href="#${esc(k)}" data-page="${esc(k)}" class="${k === active ? "active" : ""}"${k === active ? ' aria-current="page"' : ""}>${esc(label)}</a></li>`).join("")}</ul>`;
const NAV = {
  website: [["sector", "Robots by Sector"], ["ideas", "Community Ideas"], ["form", "Share Your Idea"], ["mine", "My Contributions"]],
  moderator: [["moderation", "Moderation"], ["workspace", "Moderator Workspace"], ["mine", "My Contributions"]],
  admin: [["overview", "Overview"], ["sector-forms", "Sector Forms"], ["workspace", "Moderator Workspace"], ["approvals", "Admin Approval Dashboard"], ["users", "Users & roles"], ["ideas", "Community Ideas"], ["mine", "My Contributions"]],
};
const memberNav = (role) => [["home", "Home"], ...role.sections, ["sectors", "Sectors"], ["mine", "My Contributions"], ["form", "Share Your Idea"], ["notifications", "Notifications"], ["profile", "Profile & settings"]];

/** The website's sector page as WordPress draws it (the theme's title and content); the plugin's script adds the buttons. */
function websiteSectorHtml(s) {
  const cards = fieldsOf(s).map((f) => f.source === "plugin"
    ? `<div class="e-con e-parent acme-plugin-field"><span class="rvd-src rvd-src-p">Added by a plugin</span><h2>${esc(f.title)}</h2>${f.html}</div>`
    : `<div class="rv-rt"${f.source === "suggested" ? ` data-rv-field="${esc(f.id)}"` : ""}>${f.source === "suggested" ? '<span class="rvd-src rvd-src-s">Added through "Suggest a field" (approved)</span>' : ""}<h3>${esc(f.title)}</h3>${f.html}</div>`).join("");
  return `<article class="page type-page rvd-wp-article"><header class="entry-header"><h1 class="entry-title">${esc(s.pageTitle || s.name)}</h1></header>
    <div class="entry-content"><div class="rv-fields-root" data-rv-sector="${esc(s.slug)}">${cards}</div></div></article>`;
}

/**
 * Mounts the portals into `el`. `ctx` = { mock, screens: { form, moderator, admin, site, sectors, mine }, sectors (with fields) }.
 * The mock adapter is shared, so a change made as one role is seen by every other role.
 */
export function mountPortals(el, ctx) {
  const st = { role: "visitor", page: {}, sector: {}, suggestions: DEMO_SUGGESTIONS.slice() };
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
    const brand = role.portal === "website" ? "RoboValley website (signed out)" : role.portal === "member" ? `RoboValley Community · ${role.user.type}` : role.portal === "moderator" ? "RoboValley Admin · Moderator" : "RoboValley Admin · Administrator";
    stop();
    host.innerHTML = `<div class="rvd-portal rvd-portal--${role.portal}"><aside class="rvd-nav"><div class="rvd-brand">${esc(brand)}${role.user ? `<small>${esc(role.user.name)}</small>` : ""}</div><nav aria-label="${esc(role.label)} navigation">${nav(items, st.page[roleKey])}</nav></aside>
      <main class="rvd-main" data-main></main></div>`;
    host.querySelectorAll("[data-page]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(roleKey, a.getAttribute("data-page")); }));
    render(role, st.page[roleKey], host.querySelector("[data-main]"));
  }
  const goForm = (query) => { ctx.formQuery = query || null; show(st.role === "visitor" ? "visitor" : st.role, "form"); };
  // every "Contribute" button in the demo opens the form of the role you are in, with the sector and field filled in
  el.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest(".rv-contribute-btn, .rv-sector-suggest__link") : null;
    if (!a) return;
    e.preventDefault();
    goForm(new URL(a.href, location.href).searchParams);
  });

  function render(role, page, main) {
    const sectors = ctx.sectors;
    const me = role.user || null;
    const sectorSel = st.sector[role.key] || sectors[0].slug;
    const adm = (fn) => { main.innerHTML = '<div class="rv"><div class="adm rv-cw-root"><div data-mount></div></div></div>'; return fn(main.querySelector("[data-mount]")); };
    const app = (fn) => { main.innerHTML = '<div class="rv-cw-root"><div data-mount></div></div>'; return fn(main.querySelector("[data-mount]")); };
    if (page === "sector") { // the website's Robots by Sector page
      const s = sectors.find((x) => x.slug === sectorSel) || sectors[0];
      main.innerHTML = `<nav class="rvd-bar" aria-label="Robots by Sector">${sectors.map((x) => `<button type="button" class="rvd-pill${x.slug === s.slug ? " on" : ""}" data-sector="${esc(x.slug)}">${esc(x.name)}</button>`).join("")}<a class="rvd-pill rv-sector-suggest__link" href="${esc(contributeHref(formUrl, { sector: s.slug, resourcePath: `Robots by Sector › ${s.name}` }))}&kind=Suggestion">+ Suggest a field</a></nav>
        <div class="rvd-wp" data-wp>${websiteSectorHtml(s)}</div>`;
      main.querySelectorAll("[data-sector]").forEach((b) => b.addEventListener("click", () => { st.sector[role.key] = b.getAttribute("data-sector"); show(role.key, "sector"); }));
      handles.push(startSectorPage({ sector: s.slug, sectorName: s.name, form: formUrl, off: [], root: main.querySelector("[data-wp]") }, document));
      return;
    }
    if (page === "ideas") return app((m) => ctx.screens.site.mount(m, { adapter: ctx.mock }));
    if (page === "form") {
      const q = ctx.formQuery || new URLSearchParams("");
      ctx.formQuery = null;
      if (role.portal === "website") return app((m) => ctx.screens.form.mount(m, { adapter: { ...ctx.mock, me: async () => ({ signedIn: false }), formConfig: () => ctx.mock.formConfig(), loginUrl: () => "#sign-in" }, query: q }));
      return app((m) => ctx.screens.form.mount(m, { adapter: ctx.mock.asMember(me), query: q, sample: !q.toString() }));
    }
    if (page === "mine") {
      if (role.portal === "website") { main.innerHTML = `<div class="rv-cw-root"><section class="rv-mine"><h1>My Contributions</h1><div class="cw-notice cw-n-info" role="status">Please sign in with your RoboValley member account to see your contributions. You come back here after signing in.</div><p><a class="btn" href="#sign-in">Sign in</a></p></section></div>`; return; }
      return app((m) => ctx.screens.mine.mount(m, { adapter: { mine: () => ctx.mock.mine(me) }, contributeUrl: formUrl }));
    }
    if (page === "sectors") {
      const open = st.sector[role.key + ":open"];
      return app((m) => ctx.screens.sectors.mount(m, { adapter: ctx.mock, form: formUrl, slug: open || "", returnTo: `#${role.key}/sectors`, onOpen: (slug) => { st.sector[role.key + ":open"] = slug; show(role.key, "sectors"); } }).then((h) => {
        if (open) {
          const back = document.createElement("p"); back.className = "rvd-back"; back.innerHTML = '<a href="#">← All sectors</a>';
          back.querySelector("a").addEventListener("click", (e) => { e.preventDefault(); st.sector[role.key + ":open"] = ""; show(role.key, "sectors"); });
          main.querySelector("[data-mount]").prepend(back);
        }
        if (h) handles.push(h);
      }));
    }
    if (page === "home") {
      return ctx.mock.mine(me).then((r) => {
        const n = (k) => r.items.filter((i) => i.status === k).length;
        main.innerHTML = `<section class="rvd-home"><h1>Welcome, ${esc(me.name)}</h1><p class="cw-muted">${esc(me.type)}</p>
          <div class="rvd-tiles"><div class="rvd-tile"><b>${r.items.length}</b><span>My contributions</span></div><div class="rvd-tile"><b>${n("pending") + n("approved")}</b><span>In review</span></div><div class="rvd-tile"><b>${n("published")}</b><span>Published</span></div><div class="rvd-tile"><b>${sectors.length}</b><span>Sectors</span></div></div>
          <h2>Quick actions</h2><p><a class="btn primary" href="#" data-go="form">Share your idea</a> <a class="btn" href="#" data-go="sectors">Browse sectors</a> <a class="btn" href="#" data-go="mine">My Contributions</a></p></section>`;
        main.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(role.key, a.getAttribute("data-go")); }));
      });
    }
    if (page === "notifications") {
      main.innerHTML = `<section class="rvd-page"><h1>Notifications</h1><ul class="rvd-list"><li><b>Your idea was reviewed.</b> A Moderator is looking at your latest idea. <span class="cw-muted">today</span></li><li><b>New sector field.</b> "Soil and water sensors" was added to Agriculture &amp; Dairy after a member suggested it. <span class="cw-muted">2 days ago</span></li><li><b>Welcome to RoboValley.</b> <span class="cw-muted">last month</span></li></ul></section>`;
      return;
    }
    if (page === "profile") {
      main.innerHTML = `<section class="rvd-page"><h1>Profile &amp; settings</h1><dl class="rvd-dl"><dt>Name</dt><dd>${esc(me.name)}</dd><dt>I am a</dt><dd>${esc(me.type)}${me.minor ? " (under 18)" : ""}</dd><dt>District</dt><dd>Guntur</dd><dt>Language</dt><dd>English</dd></dl></section>`;
      return;
    }
    if (role.portal === "member") { // a role's own sections (placeholders in the app too)
      const label = (role.sections.find((x) => x[0] === page) || [page, page])[1];
      main.innerHTML = `<section class="rvd-page"><h1>${esc(label)}</h1><p class="cw-muted">This part of the ${esc(role.label)} portal is planned. Meanwhile: <a href="#" data-go="sectors">browse the sectors</a> or <a href="#" data-go="form">share an idea</a>.</p><div class="rvd-tiles"><div class="rvd-tile"><b>3</b><span>Coming up</span></div><div class="rvd-tile"><b>2</b><span>Saved</span></div></div></section>`;
      main.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); show(role.key, a.getAttribute("data-go")); }));
      return;
    }
    if (page === "workspace") return adm((m) => ctx.screens.moderator.mount(m, { adapter: ctx.mock.as("moderator") }));
    if (page === "approvals") return adm((m) => ctx.screens.admin.mount(m, { adapter: ctx.mock.as("admin"), demoFailToggle: ctx.mock }));
    if (page === "moderation" || page === "sector-forms") { // the reviewer screens of one sector, with the shared sector header
      const s = sectors.find((x) => x.slug === sectorSel) || sectors[0];
      const pick = `<div class="rvd-bar">${sectors.map((x) => `<button type="button" class="rvd-pill${x.slug === s.slug ? " on" : ""}" data-sector="${esc(x.slug)}">${esc(x.name)}</button>`).join("")}</div>`;
      const header = sectorHeaderHtml({ title: page === "moderation" ? `Contributors for ${s.name}` : `Sector form: ${s.name}`, href: contributeHref(formUrl, { sector: s.slug }), sub: page === "moderation" ? "Contributions sent with the current form, by status." : "The fields (robot types) members pick from, and the fields members suggested." });
      if (page === "moderation") {
        const rows = DEMO_FORM_ITEMS.filter((i) => i.sector === s.slug);
        main.innerHTML = `<div class="rv"><div class="adm rvd-adm">${pick}${header}<div class="rv-table-scroll"><table class="rvd-table"><thead><tr><th>Title</th><th>Contributor</th><th>Status</th><th>Sent</th></tr></thead><tbody>${rows.length ? rows.map((i) => `<tr><td>${esc(i.title)}</td><td>${esc(i.user)}</td><td>${esc(i.status.replace(/_/g, " "))}</td><td>${esc(fmtDate(new Date(Date.now() + i.at * 864e5).toISOString()))}</td></tr>`).join("") : '<tr><td colspan="4">Nothing in this sector yet.</td></tr>'}</tbody></table></div></div></div>`;
      } else {
        const waiting = st.suggestions.filter((x) => x.sector === s.slug);
        main.innerHTML = `<div class="rv"><div class="adm rvd-adm">${pick}${header}<h2>Fields</h2><ul class="rvd-list">${fieldsOf(s).map((f) => `<li><b>${esc(f.title)}</b> <code>${esc(f.id)}</code>${f.source ? ` <span class="rvd-src ${f.source === "plugin" ? "rvd-src-p" : "rvd-src-s"}">${f.source === "plugin" ? "added by a plugin" : "suggested by a member"}</span>` : ""}</li>`).join("")}</ul>
          <h2>Suggested fields waiting for approval</h2>${waiting.length ? `<ul class="rvd-list">${waiting.map((x) => `<li><b>${esc(x.title)}</b> · suggested by ${esc(x.by)} <button type="button" class="btn success" data-approve="${esc(x.id)}">Approve</button></li>`).join("")}</ul>` : '<p class="cw-muted">No suggestions waiting for this sector. Approved fields appear on the sector page at once, with their button.</p>'}</div></div>`;
        main.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => {
          const x = st.suggestions.find((y) => y.id === b.getAttribute("data-approve"));
          st.suggestions = st.suggestions.filter((y) => y !== x);
          s.fields = [...fieldsOf(s), { id: x.id, title: x.title, html: x.html, source: "suggested" }]; // the field is on the sector page now
          show(role.key, "sector-forms");
        }));
      }
      main.querySelectorAll("[data-sector]").forEach((b) => b.addEventListener("click", () => { st.sector[role.key] = b.getAttribute("data-sector"); show(role.key, page); }));
      return;
    }
    if (page === "overview") {
      return Promise.all([ctx.mock.list("approvals", "All"), ctx.mock.publicList()]).then(([all, pub]) => {
        const n = (s) => all.items.filter((i) => i.status === s).length;
        main.innerHTML = `<div class="rv"><div class="adm rvd-adm"><h1>Overview</h1><div class="rvd-tiles"><div class="rvd-tile"><b>${all.items.length}</b><span>Ideas in the workflow</span></div><div class="rvd-tile"><b>${all.counts.awaiting}</b><span>Awaiting you</span></div><div class="rvd-tile"><b>${pub.items.length}</b><span>Public cards</span></div><div class="rvd-tile"><b>${n("rejected")}</b><span>Rejected</span></div><div class="rvd-tile"><b>${DEMO_USERS.length}</b><span>Users</span></div><div class="rvd-tile"><b>${sectors.length}</b><span>Sectors</span></div></div></div></div>`;
      });
    }
    if (page === "users") {
      main.innerHTML = `<div class="rv"><div class="adm rvd-adm"><h1>Users &amp; roles</h1><p class="cw-muted">Switch roles with the buttons at the top to see each portal.</p><div class="rv-table-scroll"><table class="rvd-table"><thead><tr><th>Name</th><th>Role</th><th>Portal</th></tr></thead><tbody>${DEMO_USERS.map(([n, r, p]) => `<tr><td>${esc(n)}</td><td>${esc(r)}</td><td>${esc(p === "member" ? "Member portal" : p === "moderator" ? "Admin portal (moderator)" : "Admin portal")}</td></tr>`).join("")}</tbody></table></div></div></div>`;
      return;
    }
    main.innerHTML = '<p class="cw-muted">Nothing here.</p>';
  }
  el.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => show(b.getAttribute("data-role"))));
  show("visitor");
  return { show, site: DEMO_SITE };
}
