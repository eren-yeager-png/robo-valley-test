import type { Metadata } from "next";
import { requireAdminPage } from "../../../lib/adminPage";
import CwMount from "../../_cw/CwMount";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Sectors | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Admin only. Sectors: the sector grid, the selected sector's details and numbers, and every sector's numbers (the former Sector counts
// page; each number opens that list in Moderation). The screen is public/cw/js/sectors-admin.js (the same file the demo runs); its
// data comes from /api/admin/sector-counts and the form's sectors, both checked on the server.
export default async function SectorsPage({ searchParams }: { searchParams?: Promise<{ sector?: string }> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const raw = (await searchParams)?.sector ?? "";
  return <CwMount screen="sectorsAdmin" options={{ sector: raw.length <= 60 && SLUG.test(raw) ? raw : "", basePath: "/admin/sectors" }} />;
}
