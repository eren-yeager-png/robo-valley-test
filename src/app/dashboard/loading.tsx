// Shown while a dashboard page loads (Suspense boundary for the route segment).
export default function Loading() {
  return (
    <div className="state" role="status" aria-live="polite" aria-busy="true">
      <span className="badge mute">Loading</span>
      <p className="muted">Loading your dashboard…</p>
    </div>
  );
}
