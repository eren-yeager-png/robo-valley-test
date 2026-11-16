import { redirect } from "next/navigation";
import { requireReviewerPage } from "../../../lib/reviewerPage";
import PasswordForm from "./PasswordForm";

/** Item 4: a reviewer whose account still has its temporary password chooses their own here, before anything else in the portal. */
export default async function ChangePasswordPage() {
  const me = await requireReviewerPage({ passwordChange: true });
  if (!me.mustChangePassword) redirect("/moderation"); // nothing to do: the normal portal
  return (
    <>
      <p className="mod-crumb">Admin Portal</p>
      <h1>Choose your own password</h1>
      <p className="mod-sub">Your account was set up with a temporary password. Choose your own to open the Admin Portal.</p>
      <PasswordForm />
    </>
  );
}
