import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// "My contributions" moved to the shared page every portal links to (emails and bookmarks of this address keep working).
export default function OldMyContributionsPage() {
  redirect("/my-contributions");
}
