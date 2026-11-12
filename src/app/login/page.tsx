import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/currentUser";
import { pool } from "../../lib/db";
import { reviewerLanding } from "../../lib/reviewerHome";
import { destinationFor, resolveReturnTo } from "../../lib/session";
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
//
// ?returnTo=<Projects page address> (set by the website's "Unlock Project Details" prompt) is validated here on the server
// (see lib/projectsReturnTo.ts: configured site origin + fixed Projects path, optionally + ?project=<positive integer>, nothing else). A valid
// value replaces SITE_URL as the place to go afterwards; anything else is ignored, so without it nothing changes.
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams?: SearchParams } = {}) {
  const rawReturnTo = (await searchParams)?.returnTo;
  const returnTo = resolveReturnTo(typeof rawReturnTo === "string" ? rawReturnTo : undefined);
  const user = await getCurrentUser();
  if (user) {
    const landing = await reviewerLanding(pool as never, Number(user.id), user.role); // a signed-in reviewer (not an administrator): the Admin Portal
    if (landing) redirect(landing);
    const to = returnTo ?? destinationFor(user.role);
    if (!isThisHost(to, (await headers()).get("host"))) redirect(to);
  }
  return <LoginForm returnTo={returnTo ?? undefined} />;
}
