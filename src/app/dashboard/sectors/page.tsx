import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../../lib/dashboardContext";
import { contributeReturnPath, siteUrl } from "../../../lib/session";
import { memberVariant, portalQuickForm } from "../../../lib/memberVariant";
import CwMount from "../../_cw/CwMount";
import "../../../../public/cw/sector.css";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Sectors | RoboValley" };
export const dynamic = "force-dynamic";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Every Member portal's "Sectors": the sector grid (from Sector Forms, so a new sector appears by itself) and the selected sector's
// panel, as the member's role sees it (student, teacher, parent or contributor view). The screen is the shared module
// public/cw/js/sectors.js (the demo runs the same file).
export default async function SectorsPage({ searchParams }: { searchParams?: Promise<{ sector?: string }> } = {}) {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  const raw = (await searchParams)?.sector ?? "";
  const variant = ctx.status === "ok" ? memberVariant(ctx.user.role) : "student";
  return <CwMount screen="sectors" options={{ form: siteUrl().replace(/\/+$/, "") + contributeReturnPath(), basePath: "/dashboard/sectors", sector: raw.length <= 60 && SLUG.test(raw) ? raw : "", variant, quickForm: variant === "contributor" && portalQuickForm() }} />;
}
