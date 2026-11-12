/*!
 * RoboValley header account menu - rv-header-menu.js (served by the app: https://app.techytree.in/rv-header-menu.js)
 * Plain JavaScript and the Bootstrap 5 dropdown (JavaScript only; the page's own Bootstrap is reused when it has one).
 * Styles: rv-header-menu.css, every rule scoped under .rv-header-menu.
 *
 * On techytree.in it needs one tag:  <script src="https://app.techytree.in/rv-header-menu.js" defer></script>
 *   It puts the icon where the theme's old account corner (.rv-account-corner) is, and in the phone header next to the menu button,
 *   hides that old corner and the Contribute page's own Sign Out button (#rv-c2 #sign-out): Sign Out lives in this menu.
 * On the app's pages it fills every <div data-rv-header-menu data-site="https://techytree.in/"></div>.
 *
 * Who is signed in, and their role, come from the app's server (GET /api/auth/menu, which re-reads the account): never from the page.
 * Hiding a link is not security: every admin and moderation page and API checks the role again on the server.
 */
(function () {
  "use strict";
  if (window.RVHeaderMenu && window.RVHeaderMenu.version) return; // the tag was added twice: the first copy does the work

  var VERSION = "1.0.0";
  var BOOTSTRAP_FILE = "vendor/bootstrap-5.3.3/bootstrap.bundle.min.js";

  // The menu, in one list. role: who sees the item. base: "app" (the app) or "site" (techytree.in). count: the number from
  // /api/auth/menu shown next to it. enabled: false keeps an item ready but hidden; PR3 switches "Moderator dashboard" on here.
  var MENU = [
    { label: "My profile", role: "member", base: "app", path: "/dashboard/profile", enabled: true },
    { label: "My contributions", role: "member", base: "site", path: "/contribute-now/#history-title", enabled: true, count: "myContributions" },
    { label: "Contribute", role: "member", base: "site", path: "/contribute-now/", enabled: true },
    { label: "Moderator dashboard", role: "moderator", base: "app", path: "/moderation/dashboard", enabled: false },
    { label: "Review queue", role: "moderator", base: "app", path: "/moderation", enabled: true, count: "reviewQueue" },
    { label: "Admin portal", role: "admin", base: "app", path: "/admin/dashboard", enabled: true },
    { label: "Contributions by sector", role: "admin", base: "app", path: "/admin/sectors", enabled: true },
    { label: "Review queue", role: "admin", base: "app", path: "/moderation", enabled: true, count: "reviewQueue" },
    { label: "Users & moderators", role: "admin", base: "app", path: "/admin/users", enabled: true },
    { label: "Site settings", role: "admin", base: "app", path: "/admin/settings", enabled: true }
  ];

  var LOOK = {
    member: { color: "#2f7d1f", ring: "rgba(47,125,31,0.35)", subtitle: "Registered member" },
    moderator: { color: "#1f4d3f", ring: "rgba(31,77,63,0.35)", subtitle: "Moderator" },
    admin: { color: "#1e3a5f", ring: "rgba(30,58,95,0.35)", subtitle: "Administrator · full access" }
  };
  var COUNT_WORDS = { myContributions: ["contribution", "contributions"], reviewQueue: ["item waiting", "items waiting"] };

  var script = document.currentScript;
  var src = script && script.src ? script.src : "";
  var appOrigin = trimSlash(attr(script, "data-app") || originOf(src) || location.origin);
  var assetBase = src ? src.replace(/[^/?#]*([?#].*)?$/, "") : appOrigin + "/";
  var onApp = location.origin === appOrigin;
  var NS = "http://www.w3.org/2000/svg";
  var seq = 0;
  var answer = null; // the last answer from /api/auth/menu
  var pending = null;
  var bootstrapPromise = null;

  function attr(el, name) { return el && el.getAttribute ? el.getAttribute(name) : null; }
  function trimSlash(s) { return String(s || "").replace(/\/+$/, ""); }
  function originOf(url) {
    try { var o = new URL(url, location.href).origin; return o && o !== "null" ? o : ""; } catch (e) { return ""; }
  }
  function siteOrigin() {
    var slot = document.querySelector("[data-rv-header-menu][data-site]");
    var s = attr(slot, "data-site") || attr(script, "data-site");
    return trimSlash(s || (onApp ? "https://techytree.in" : location.origin));
  }
  function urlFor(item) { return (item.base === "site" ? siteOrigin() : appOrigin) + item.path; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ---------- the avatars (drawn like profile-icon-final.png; the initial is text, never markup) ---------- */
  function avatar(role, initial, size) {
    var s = svg("svg", { viewBox: "0 0 48 48", width: size, height: size, "aria-hidden": "true", focusable: "false", "class": "rv-hm-avatar" });
    var c = role === "admin" ? { cx: 22, cy: 22, r: 19, tx: 20.5, ty: 28.3, fs: 18 } : role === "moderator" ? { cx: 24, cy: 22, r: 20, tx: 22.4, ty: 28.6, fs: 19 } : { cx: 24, cy: 24, r: 22, tx: 24, ty: 31.3, fs: 21 };
    s.appendChild(svg("circle", { cx: c.cx, cy: c.cy, r: c.r, fill: LOOK[role].color }));
    var t = svg("text", { x: c.tx, y: c.ty, "font-size": c.fs, "font-weight": "700", fill: "#fff", "text-anchor": "middle", "font-family": "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" });
    t.textContent = initial || "?";
    s.appendChild(t);
    if (role === "moderator") { // gold shield with a check, bottom right
      var g = svg("g", { transform: "translate(39.6,36.4) scale(0.91)" });
      g.appendChild(svg("path", { d: "M0,-9 L8,-6 L8,1 C8,6 4,9 0,11 C-4,9 -8,6 -8,1 L-8,-6 Z", fill: "#f2b705", stroke: "#fff", "stroke-width": "1.5" }));
      g.appendChild(svg("path", { d: "M-3.5,1 L-1,3.5 L4,-2", fill: "none", stroke: "#1f4d3f", "stroke-width": "1.8", "stroke-linecap": "round" }));
      s.appendChild(g);
    } else if (role === "admin") { // orange star, bottom right
      s.appendChild(svg("circle", { cx: 36.8, cy: 35.7, r: 8, fill: "#e8590c", stroke: "#fff", "stroke-width": "1.5" }));
      s.appendChild(svg("polygon", { points: "36.8,30.7 35.5,33.9 32.1,34.2 34.7,36.4 33.9,39.7 36.8,37.9 39.7,39.7 38.9,36.4 41.5,34.2 38.1,33.9", fill: "#fff" }));
    }
    return s;
  }
  function personIcon() { // Bootstrap Icons "person" (MIT), inline: no icon font is downloaded
    var s = svg("svg", { viewBox: "0 0 16 16", width: 22, height: 22, fill: "currentColor", "aria-hidden": "true", focusable: "false" });
    s.appendChild(svg("path", { d: "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z" }));
    return s;
  }

  /* ---------- drawing one menu ---------- */
  function drawSignedOut(root) {
    var a = el("a", "rv-hm-signin");
    var back = onApp ? "" : "?returnTo=" + encodeURIComponent(location.origin + location.pathname);
    a.href = appOrigin + "/login" + back;
    a.title = "Sign in / Join";
    a.setAttribute("aria-label", "Sign in to RoboValley");
    a.appendChild(personIcon());
    root.setAttribute("data-rv-role", "visitor");
    root.appendChild(a);
  }

  function drawSignedIn(root, d, bootstrapOk) {
    var role = LOOK[d.role] ? d.role : "member";
    var name = d.firstName || "your account";
    var id = "rv-hm-" + ++seq;
    root.setAttribute("data-rv-role", role);
    root.style.setProperty("--rv-hm-ring", LOOK[role].ring);

    var btn = el("button", "rv-hm-toggle");
    btn.type = "button";
    btn.id = id + "-button";
    btn.setAttribute("data-bs-toggle", "dropdown");
    btn.setAttribute("data-bs-display", "static");
    btn.setAttribute("data-bs-auto-close", "true");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id + "-menu");
    btn.setAttribute("aria-label", "Account menu for " + name);
    btn.appendChild(avatar(role, d.initial, 40));

    var menu = el("div", "dropdown-menu dropdown-menu-end rv-hm-menu");
    menu.id = id + "-menu";
    var head = el("div", "rv-hm-head");
    head.appendChild(avatar(role, d.initial, 40));
    var who = el("div", "rv-hm-who");
    who.appendChild(el("span", "rv-hm-name", name));
    var sub = LOOK[role].subtitle + (role === "member" && d.stakeholder ? " · " + d.stakeholder : "");
    who.appendChild(el("span", "rv-hm-sub", sub));
    head.appendChild(who);
    menu.appendChild(head);

    var list = el("ul", "rv-hm-list");
    list.setAttribute("role", "menu");
    list.setAttribute("aria-labelledby", btn.id);
    MENU.forEach(function (item) {
      if (!item.enabled || item.role !== role) return;
      var li = el("li");
      li.setAttribute("role", "none");
      var a = el("a", "dropdown-item rv-hm-item");
      a.setAttribute("role", "menuitem");
      a.href = urlFor(item);
      a.appendChild(el("span", "rv-hm-label", item.label));
      var n = item.count && d.counts ? d.counts[item.count] : undefined;
      if (typeof n === "number" && isFinite(n) && n >= 0) {
        var badge = el("span", "rv-hm-count", n > 99 ? "99+" : String(n));
        badge.setAttribute("aria-hidden", "true");
        a.appendChild(badge);
        var w = COUNT_WORDS[item.count];
        a.setAttribute("aria-label", item.label + ", " + n + " " + (n === 1 ? w[0] : w[1]));
      }
      li.appendChild(a);
      list.appendChild(li);
    });
    var sep = el("li", "rv-hm-divider");
    sep.setAttribute("role", "separator");
    list.appendChild(sep);
    var outLi = el("li");
    outLi.setAttribute("role", "none");
    var out = el("button", "dropdown-item rv-hm-item rv-hm-signout", "Sign Out");
    out.type = "button";
    out.setAttribute("role", "menuitem");
    out.addEventListener("click", function () { signOut(out); });
    outLi.appendChild(out);
    list.appendChild(outLi);
    menu.appendChild(list);

    root.appendChild(btn);
    root.appendChild(menu);
    btn.addEventListener("show.bs.dropdown", function () { placeForPhone(root, menu); });
    if (!bootstrapOk) fallbackDropdown(root, btn, menu);
  }

  // Phones: the menu opens full width under the header (rv-header-menu.css uses --rv-hm-top below 641 px).
  function placeForPhone(root, menu) {
    var bar = root.closest("header, .site-header, #ast-mobile-header, .main-header-bar, .adm-top, .dtop, .mod-bar") || root.parentNode;
    var r = bar && bar.getBoundingClientRect ? bar.getBoundingClientRect() : null;
    menu.style.setProperty("--rv-hm-top", Math.max(0, Math.round(r ? r.bottom : 56)) + "px");
  }

  function signOut(button) {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Signing out…";
    fetch(appOrigin + "/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("logout " + r.status);
        if (onApp) location.assign(appOrigin + "/login"); else location.reload();
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = "Sign out failed – try again";
      });
  }

  /* ---------- Bootstrap: reuse the page's copy, else load the app's own copy (JavaScript only) ---------- */
  function bootstrapReady() {
    var b = window.bootstrap;
    return !!(b && b.Dropdown && typeof b.Dropdown.getOrCreateInstance === "function");
  }
  function loadBootstrap() {
    if (bootstrapReady()) return Promise.resolve(true);
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = new Promise(function (resolve) {
      var s = document.createElement("script");
      var done = function (ok) { clearTimeout(t); resolve(ok); };
      var t = setTimeout(function () { done(bootstrapReady()); }, 6000); // never wait for ever: the fallback below takes over
      s.src = assetBase + BOOTSTRAP_FILE;
      s.async = true;
      s.setAttribute("data-rv-hm-bootstrap", "1"); // not data-rv-header-menu: that attribute marks a slot
      s.onload = function () { done(bootstrapReady()); };
      s.onerror = function () { done(false); };
      (document.head || document.documentElement).appendChild(s);
    });
    return bootstrapPromise;
  }
  // Only when Bootstrap could not be loaded: the same behaviour (click, Escape, outside click, arrow keys), so the header never breaks.
  function fallbackDropdown(root, btn, menu) {
    if (btn.getAttribute("data-rv-fallback")) return;
    btn.setAttribute("data-rv-fallback", "1");
    // Drop Bootstrap's markers, so a copy of Bootstrap that arrives later cannot also act on this menu.
    btn.removeAttribute("data-bs-toggle");
    menu.classList.remove("dropdown-menu");
    Array.prototype.forEach.call(menu.querySelectorAll(".dropdown-item"), function (i) { i.classList.remove("dropdown-item"); });
    var items = function () { return Array.prototype.slice.call(menu.querySelectorAll(".rv-hm-item:not(:disabled)")); };
    var setOpen = function (open) {
      if (open) placeForPhone(root, menu);
      menu.classList.toggle("show", open);
      btn.classList.toggle("show", open);
      btn.setAttribute("aria-expanded", String(open));
    };
    btn.addEventListener("click", function () { setOpen(!menu.classList.contains("show")); });
    document.addEventListener("click", function (e) { if (!root.contains(e.target)) setOpen(false); });
    root.addEventListener("keydown", function (e) {
      var list = items(), i = list.indexOf(document.activeElement);
      if (e.key === "Escape") { setOpen(false); btn.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!menu.classList.contains("show")) setOpen(true);
        var next = e.key === "ArrowDown" ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
        if (list[next]) list[next].focus();
      }
    });
  }

  /* ---------- where the menu goes ---------- */
  function newRoot() {
    var root = el("div", "rv-header-menu");
    root.appendChild(el("span", "rv-hm-placeholder")).setAttribute("aria-hidden", "true");
    return root;
  }
  function findRoots() {
    var roots = [];
    Array.prototype.forEach.call(document.querySelectorAll("[data-rv-header-menu]:not([data-rv-hm-done])"), function (slot) {
      slot.setAttribute("data-rv-hm-done", "1");
      var r = newRoot();
      slot.appendChild(r);
      roots.push(r);
    });
    if (!onApp) {
      // techytree.in (Astra): where the old account corner is ...
      Array.prototype.forEach.call(document.querySelectorAll(".rv-account-corner:not([data-rv-hm-done])"), function (old) {
        old.setAttribute("data-rv-hm-done", "1");
        var r = newRoot();
        r.classList.add("rv-header-menu--site");
        old.parentNode.insertBefore(r, old);
        roots.push(r);
      });
      // ... and the phone header, just before its menu button
      var trigger = document.querySelector("#ast-mobile-header [data-section='section-header-mobile-trigger']:not([data-rv-hm-done])");
      if (trigger) {
        trigger.setAttribute("data-rv-hm-done", "1");
        var r = newRoot();
        r.classList.add("rv-header-menu--site", "rv-header-menu--phone");
        trigger.parentNode.insertBefore(r, trigger);
        roots.push(r);
      }
    }
    return roots;
  }
  function hideOldControls() {
    if (onApp || document.getElementById("rv-header-menu-hide")) return;
    var st = el("style");
    st.id = "rv-header-menu-hide";
    // The theme's old account corner, and the Contribute page's own Sign Out button (the "<Name> · Registered member" text stays).
    st.textContent = ".rv-account-corner{display:none!important}#rv-c2 #sign-out{display:none!important}";
    (document.head || document.documentElement).appendChild(st);
  }
  function addStylesheet() {
    if (document.getElementById("rv-header-menu-css")) return;
    var l = el("link");
    l.id = "rv-header-menu-css";
    l.rel = "stylesheet";
    l.href = assetBase + "rv-header-menu.css";
    (document.head || document.documentElement).appendChild(l);
  }

  /* ---------- who is signed in ---------- */
  function ask() {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(appOrigin + "/api/auth/menu", { credentials: "include", cache: "no-store", headers: { Accept: "application/json" }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : { authenticated: false }; })
      .catch(function () { return { authenticated: false }; }) // the app could not be reached: show the Sign In icon, never a broken header
      .then(function (d) { if (timer) clearTimeout(timer); return d && typeof d === "object" ? d : { authenticated: false }; });
  }
  var signedIn = function (d) { return !!(d && d.authenticated === true && typeof d.role === "string"); };
  function draw(root, d, bootstrapOk) {
    root.textContent = "";
    root.removeAttribute("data-rv-role");
    if (signedIn(d)) drawSignedIn(root, d, bootstrapOk); else drawSignedOut(root);
  }
  // Signed in: draw once Bootstrap is ready (or known to be missing), so the first click always opens the menu.
  function ready() {
    if (!pending && !answer) pending = ask().then(function (d) { answer = d; pending = null; return d; });
    return (answer ? Promise.resolve(answer) : pending).then(function (d) {
      return signedIn(d) ? loadBootstrap().then(function (ok) { return { d: d, ok: ok }; }) : { d: d, ok: true };
    });
  }
  function fill(roots) {
    if (!roots.length) return;
    ready().then(function (x) { roots.forEach(function (r) { draw(r, x.d, x.ok); }); });
  }
  function all() { return Array.prototype.slice.call(document.querySelectorAll(".rv-header-menu")); }

  // Only these, when added to the page later, need a menu (never this script's own menus).
  var WATCH = "[data-rv-header-menu], .rv-account-corner, [data-section='section-header-mobile-trigger']";
  function needsMenu(records) {
    for (var i = 0; i < records.length; i++) {
      for (var j = 0; j < records[i].addedNodes.length; j++) {
        var n = records[i].addedNodes[j];
        if (n.nodeType !== 1 || n.classList.contains("rv-header-menu") || n.closest(".rv-header-menu")) continue;
        if (n.matches(WATCH) || n.querySelector(WATCH)) return true;
      }
    }
    return false;
  }
  function start() {
    addStylesheet();
    hideOldControls();
    fill(findRoots());
    // The app swaps page layouts without reloading: fill slots that appear later.
    if (typeof MutationObserver === "function" && document.body) {
      var queued = false;
      var watcher = new MutationObserver(function (records) {
        if (window.RVHeaderMenu !== api) { watcher.disconnect(); return; } // another copy of this script has taken over
        if (queued || !needsMenu(records)) return;
        queued = true;
        setTimeout(function () { queued = false; fill(findRoots()); }, 50);
      });
      watcher.observe(document.body, { childList: true, subtree: true });
    }
  }

  var api = {
    version: VERSION,
    menu: MENU,
    /** Ask the app again and redraw every menu on the page (e.g. after signing in without a reload). */
    refresh: function () { answer = null; pending = null; fill(all()); }
  };
  window.RVHeaderMenu = api;

  // Ask and load Bootstrap straight away; draw once the page's header exists.
  pending = ask().then(function (d) { answer = d; pending = null; return d; });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
