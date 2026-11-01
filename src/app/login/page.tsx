import type { Metadata } from "next";
import { getCurrentUser } from "../../lib/currentUser";
import { destinationFor } from "../../lib/session";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in | RoboValley",
  description: "Sign in to your RoboValley account",
};

// Always renders the form. A visitor who is already signed in sees a "You are signed in" note with a link to the site and a
// Sign out button above it, so they can always reach the page and switch account. "/" re-exports this page.
export default async function LoginPage() {
  const user = await getCurrentUser();
  return <LoginForm signedIn={user ? { name: user.fullName, siteHref: destinationFor(user.role) } : null} />;
}
