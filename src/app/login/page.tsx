import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/currentUser";
import { POST_LOGIN_URL } from "../../lib/links";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in | RoboValley",
  description: "Sign in to your RoboValley account",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(POST_LOGIN_URL); // already signed in: same destination as a fresh sign-in
  return <LoginForm />;
}
