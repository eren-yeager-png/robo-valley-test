import { requireReviewerPage } from "../../../../lib/reviewerPage";
import CwMount from "../../../_cw/CwMount";

export const dynamic = "force-dynamic";

// The screen itself is the plain JavaScript module public/cw/js/moderator.js (the same file the standalone demo runs).
export default async function WorkspacePage() {
  const me = await requireReviewerPage({ passwordChange: true });
  if (me.mustChangePassword) return null;
  return <CwMount screen="moderator" />;
}
