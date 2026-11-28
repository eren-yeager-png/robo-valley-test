import { redirect } from "next/navigation";
import { requireReviewerPage } from "../../../../lib/reviewerPage";

export const dynamic = "force-dynamic";

// The Moderator Workspace is merged into Moderation: the same review opens there (Edit & approve, View) for every idea sent with
// Share Your Idea. The old address keeps working and goes to Moderation.
export default async function WorkspacePage() {
  await requireReviewerPage({ passwordChange: true });
  redirect("/admin/moderation");
}
