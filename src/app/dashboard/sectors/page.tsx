import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../../lib/dashboardContext";
import { contributeReturnPath, siteUrl } from "../../../lib/session";
import CwMount from "../../_cw/CwMount";
import "../../../../public/cw/sector.css";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Sectors | RoboValley" };
export const dynamic = "force-dynamic";

// Every Member portal's "Sectors": a card for every sector (from Sector Forms, so a new sector appears by itself). The screen is the
// shared module public/cw/js/sectors.js (the demo runs the same file).
export default async function SectorsPage() {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  return <CwMount screen="sectors" options={{ form: siteUrl().replace(/\/+$/, "") + contributeReturnPath(), basePath: "/dashboard/sectors" }} />;
}
