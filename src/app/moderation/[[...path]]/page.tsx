import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Moderation | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** One part of the old path, as it has to be written in the new address. Never "." or "..", so the result stays below /admin/moderation. */
function part(raw: string): string {
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { /* not a valid escape: used as it is */ }
  return s === "." || s === ".." ? "" : encodeURIComponent(s);
}

/**
 * Moderation moved to /admin/moderation. Every old address (/moderation, /moderation/12, /moderation/sector/x?tab=all,
 * /moderation/change-password) goes to the same page there, with its query. It shows nothing and checks nothing itself: the new pages
 * do, exactly as before. A temporary redirect on purpose: browsers do not remember it for good.
 */
export default async function OldModerationAddress({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const path = ((await params).path ?? []).map(part).filter(Boolean).join("/");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries((await searchParams) ?? {})) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) query.append(k, x);
  const qs = query.toString();
  redirect(`/admin/moderation${path ? "/" + path : ""}${qs ? "?" + qs : ""}`);
}
