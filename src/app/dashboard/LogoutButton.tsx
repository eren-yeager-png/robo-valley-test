"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* cookie expires anyway */ }
    router.replace("/login");
    router.refresh();
  }
  return <button type="button" className="btn" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>;
}
