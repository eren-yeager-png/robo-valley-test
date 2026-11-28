import { redirect } from "next/navigation";
import { requireReviewerPage } from "../../../../../../lib/reviewerPage";

type SP = { tab?: string; verified?: string };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// the old list's tabs -> Moderation's tabs (verified: the links on the admin's Sectors page)
const TAB: Record<string, string> = { new: "pending", in_review: "pending", replied: "pending", changes_requested: "pending", published: "published", unpublished: "published", rejected: "rejected", all: "all" };

/** The old address of one sector's list (/admin/moderation/sector/<slug>): Moderation now shows it in the sector's panel. */
export default async function SectorPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<SP> }) {
  await requireReviewerPage();
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const q = new URLSearchParams();
  if (slug.length <= 60 && SLUG.test(slug)) q.set("sector", slug);
  const tab = sp.verified === "1" ? "approved" : sp.verified === "0" ? "pending" : TAB[sp.tab ?? ""];
  if (tab) q.set("tab", tab);
  redirect(`/admin/moderation${q.toString() ? `?${q.toString()}` : ""}`);
}
