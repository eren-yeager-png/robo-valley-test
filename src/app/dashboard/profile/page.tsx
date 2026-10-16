import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../../lib/dashboardContext";
import { loadAccount } from "../../../lib/dashboardData";
import { ROLE_FIELDS } from "../../../lib/roles";
import { ErrorState, UnauthorizedState } from "../states";
import ProfileForm from "./ProfileForm";

export const metadata: Metadata = { title: "Profile & settings | RoboValley" };

export default async function ProfilePage() {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "unknown-role") return <UnauthorizedState title="Your account has no dashboard yet" body="Your account's role isn't recognised." />;

  const res = await loadAccount(ctx.user.id);
  if (!res.ok) return <ErrorState body="We couldn't load your profile. Please try again in a moment." />;
  const a = res.account;

  return (
    <>
      <header className="dhead"><span className="badge">{ctx.dash.label}</span><h1>Profile & settings</h1><p className="muted">Keep your details up to date.</p></header>
      <ProfileForm
        fields={ROLE_FIELDS[a.role] ?? []}
        initial={{ fullName: a.fullName, district: a.district ?? "", language: a.language ?? "Telugu", profile: a.profile }}
        readonly={{
          email: a.email, role: ctx.dash.label, mobile: a.mobile ?? "—",
          age: a.ageCategory === "minor" ? "Under 18" : a.ageCategory === "adult" ? "18 or older" : "—",
        }}
      />
    </>
  );
}
