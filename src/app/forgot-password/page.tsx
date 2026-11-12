import type { Metadata } from "next";
import { headers } from "next/headers";
import { pool } from "../../lib/db";
import { resetAvailable } from "../../lib/passwordReset";
import ForgotForm from "./ForgotForm";

export const metadata: Metadata = { title: "Forgot password | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Shows the form only when reset can really work (sender configured, app address set, migration 020 applied); otherwise a plain
// "not available yet" note. Production never falls back to a test sender.
export default async function ForgotPasswordPage() {
  const host = (await headers()).get("host") ?? "localhost";
  const available = await resetAvailable(pool as never, process.env, `http://${host}/`);
  return <ForgotForm available={available.ok} />;
}
