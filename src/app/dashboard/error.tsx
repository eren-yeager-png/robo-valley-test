"use client";

// Error boundary for unexpected failures. Never shows the error message or stack to the user.
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="state block" role="alert">
      <span className="badge warn">Error</span>
      <h2>Something went wrong</h2>
      <p>We couldn't show this page. Please try again.</p>
      <button type="button" className="btn primary" onClick={reset}>Try again</button>
    </section>
  );
}
