import type { Metadata } from "next";
import { resolveReturnTo } from "../../lib/session";
import JoinFlow from "./JoinFlow";

export const metadata: Metadata = {
  title: "Join the RoboValley Community",
  description: "Create your RoboValley account",
};

// ?returnTo=<Projects page address> is validated on the server (lib/projectsReturnTo.ts) and carried through the whole sign-up flow to
// the sign-in step. Without a valid value nothing changes.
export default async function JoinPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const rawReturnTo = (await searchParams)?.returnTo;
  const returnTo = resolveReturnTo(typeof rawReturnTo === "string" ? rawReturnTo : undefined);
  return <JoinFlow returnTo={returnTo ?? undefined} />;
}
