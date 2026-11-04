"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Make live" for a staged (previewed) dataset. It calls the existing admin-only confirm route, which switches only
 * that dataset's own category inside a transaction; the server decides everything, this button only asks.
 */
export default function ActivateButton({ datasetId, label, onDone }: { datasetId: string; label: string; onDone?: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  async function go() {
    if (state.busy) return;
    if (!window.confirm(`Make "${label}" the live data for its category? The current live file for that category will be replaced.`)) return;
    setState({ busy: true, error: "" });
    try {
      const res = await fetch("/api/services/upload/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datasetId }) });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
      if (!res.ok || !body.success) { setState({ busy: false, error: body.message ?? "Could not make this dataset live." }); return; }
      router.refresh();
      onDone?.();
    } catch {
      setState({ busy: false, error: "Network problem. Nothing was changed." });
    }
  }
  return (
    <>
      <button type="button" className="btn primary" onClick={go} disabled={state.busy}>{state.busy ? "Working…" : "Make live"}</button>
      {state.error && <div role="alert" style={{ color: "var(--red)", fontSize: ".82rem" }}>{state.error}</div>}
    </>
  );
}
