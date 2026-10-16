import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isKnownSectionSlug, sectionOf } from "../../../lib/dashboardConfig";
import { getDashboardContext } from "../../../lib/dashboardContext";
import { EmptyState, UnauthorizedState } from "../states";

export const metadata: Metadata = { title: "Dashboard | RoboValley" };

// Authorization: the section must belong to the role stored in the database for the signed-in
// user. The role is never read from the URL, query string or client storage, and hiding a link in
// the sidebar is not what protects a page: this check is.
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "unknown-role") return <UnauthorizedState title="Your account has no dashboard yet" body="Your account's role isn't recognised." />;

  const section = sectionOf(ctx.user.role, slug);
  if (!section) {
    if (isKnownSectionSlug(slug)) return <UnauthorizedState />; // exists, but for another role
    notFound();
  }
  return (
    <>
      <header className="dhead">
        <span className="badge">{ctx.dash.label}</span>
        <h1>{section.label}</h1>
        <p className="muted">{section.description}</p>
      </header>
      <EmptyState section={section} />
    </>
  );
}
