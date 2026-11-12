import type { Metadata } from "next";
import ResetForm from "./ResetForm";

// The link's token is in the URL fragment (#token=...), which is never sent to a server; the page also sends no Referer anywhere.
export const metadata: Metadata = { title: "Choose a new password | RoboValley", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return <ResetForm />;
}
