// The shared sector header on the app's own sector screens (Moderation by sector, Sector forms): the title on the left and
// "+ Contribute to this sector" on the right, sticky at the top. The markup is the SAME function the website and the demo use
// (public/cw/js/sector.js: sectorHeaderHtml), rendered here on the server: there is no second copy of it.
import { contributeHref, sectorHeaderHtml } from "../../../public/cw/js/sector.js";
import { appBaseUrl } from "../../lib/passwordReset";
import { contributeReturnPath, siteUrl } from "../../lib/session";

export default function SectorHeader({ title, sub = "", sector, returnPath }: { title: string; sub?: string; sector: string; returnPath: string }) {
  const form = siteUrl().replace(/\/+$/, "") + contributeReturnPath();
  const back = (appBaseUrl() ?? "").replace(/\/+$/, "") + returnPath;
  const html = sectorHeaderHtml({ title, sub, href: contributeHref(form, { sector, returnTo: back }) });
  return <div className="rv-sector-header-host" dangerouslySetInnerHTML={{ __html: html }} />;
}
