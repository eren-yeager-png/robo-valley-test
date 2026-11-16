import Script from "next/script";

/**
 * Where the shared header account menu goes on the app's own pages. The menu is plain JavaScript (public/rv-header-menu.js, the same
 * file techytree.in loads with one <script> tag). It fills this empty slot after the page has loaded (strategy "afterInteractive",
 * so React never sees its contents), and asks GET /api/auth/menu who is signed in. `site` is the public site's address, for the
 * "My contributions" and "Contribute" links. `tone="dark"` is for a dark bar (the moderation bar): the icon gets a white edge.
 */
export default function HeaderMenuSlot({ site, tone }: { site?: string; tone?: "dark" }) {
  return (
    <>
      <div className="rv-header-menu-slot" data-rv-header-menu="" data-site={site} data-tone={tone} style={{ display: "inline-flex", alignItems: "center", minWidth: 44, minHeight: 44 }} />
      <Script id="rv-header-menu" src="/rv-header-menu.js" strategy="afterInteractive" />
    </>
  );
}
