import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../../../lib/dashboardContext";
import { contributeReturnPath, siteUrl } from "../../../../lib/session";
import CwMount from "../../../_cw/CwMount";
import "../../../../../public/cw/sector.css";
import "../../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Sector | RoboValley" };
export const dynamic = "force-dynamic";

// One sector, drawn with the SAME shared sector page component as the website (public/cw/js/sector.js through sectors.js): the title
// with "+ Contribute to this sector", the fields in cards with their buttons, and "+ Suggest a field". Read-only.
export default async function SectorDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  const { slug } = await params;
  const clean = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 60 ? slug : "";
  return <CwMount screen="sectors" options={{ form: siteUrl().replace(/\/+$/, "") + contributeReturnPath(), basePath: "/dashboard/sectors", slug: clean || "-" }} />;
}
