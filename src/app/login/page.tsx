import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/currentUser";
// import { destinationFor } from "../../lib/session";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in | RoboValley",
  description: "Sign in to your RoboValley account",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user?.role === "admin") redirect("/admin/dashboard");
  if (user) redirect("https://techytree.in/");
  return <LoginForm />;
}
