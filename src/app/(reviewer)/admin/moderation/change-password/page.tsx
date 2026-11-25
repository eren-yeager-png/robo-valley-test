import { redirect } from "next/navigation";
import { requireReviewerPage } from "../../../../../lib/reviewerPage";
import { PageHeader } from "../../../../admin/_components/ui";
import PasswordForm from "./PasswordForm";

/** Item 4: a reviewer whose account still has its temporary password chooses their own here, before anything else in the portal. */
export default async function ChangePasswordPage() {
  const me = await requireReviewerPage({ passwordChange: true });
  if (!me.mustChangePassword) redirect("/admin/moderation"); // nothing to do: the normal portal
  return (
    <>
      <PageHeader title="Choose your own password" lead="Your account was set up with a temporary password. Choose your own to open Moderation." />
      <PasswordForm />
    </>
  );
}
