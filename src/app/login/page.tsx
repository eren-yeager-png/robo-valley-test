import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/currentUser";
import { destinationFor } from "../../lib/session";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in | RoboValley",
  description: "Sign in to your RoboValley account",
};

/** True when `url` points at the host that is serving this request (redirecting there would loop). */
function isThisHost(url: string, host: string | null): boolean {
  try { return !!host && new URL(url).host.toLowerCase() === host.toLowerCase(); } catch { return true; }
}

// A visitor who is already signed in is sent straight to the website (on the server, so the form never flashes);
// everyone else sees the sign-in form. "/" re-exports this page. If SITE_URL ever points at this very host the form is
// shown instead of redirecting, so a misconfiguration cannot create a redirect loop.
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    const to = destinationFor(user.role);
    if (!isThisHost(to, (await headers()).get("host"))) redirect(to);
  }
  return <LoginForm />;
}
