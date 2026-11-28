import { redirect } from "next/navigation";
import { requireReviewerPage } from "../../../../lib/reviewerPage";
import { contributeReturnPath, siteUrl } from "../../../../lib/session";
import CwMount from "../../../_cw/CwMount";
import "../../../_cw/cw-portal.css";
import "../../../../../public/cw/sector.css";
import "../../../../../public/cw/portal.css";

export const dynamic = "force-dynamic";
type SP = { item?: string; sector?: string; tab?: string };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MODERATION_TAB_KEYS = ["all", "pending", "approved", "rejected", "published"];

// Moderation (administrators and moderators): ONE page with the Moderator Workspace merged in. The sector grid, the selected sector's
// panel with status tabs, and one table for both kinds of contributions (Share Your Idea and the current form). The screen is the plain
// JavaScript module public/cw/js/moderation.js (the same file the standalone demo runs); every API behind it checks again.
export default async function ModerationPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  await requireReviewerPage();
  const sp = (await searchParams) ?? {};
  if (/^[1-9]\d{0,9}$/.test(sp.item ?? "")) redirect(`/admin/moderation/${sp.item}`); // older links (/admin/moderation?item=12) open the detail page
  const sector = (sp.sector ?? "").length <= 60 && SLUG.test(sp.sector ?? "") ? sp.sector : "";
  const tab = MODERATION_TAB_KEYS.includes(sp.tab ?? "") ? sp.tab : "";
  return <CwMount screen="moderation" options={{ sector, tab, basePath: "/admin/moderation", form: siteUrl().replace(/\/+$/, "") + contributeReturnPath() }} />;
}
