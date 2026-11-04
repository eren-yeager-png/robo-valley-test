"use client";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="adm-note error" role="alert">
      <strong>This page could not be loaded.</strong>
      <div>Something went wrong while reading the data. Nothing was changed.</div>
      <button type="button" className="btn" onClick={reset}>Try again</button>
    </div>
  );
}
