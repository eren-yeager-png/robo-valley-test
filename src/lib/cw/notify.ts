// Notifications of the contribution workflow (the hook). Called after a change has been saved; it never blocks or undoes the change.
// Phase 5 sends the emails through Resend; until then the hook records nothing and sends nothing.
export type NotifyEvent = "submitted" | "sent" | "changes" | "published" | "rejected";

/** Fire-and-forget: schedules the notice for an event on a contribution. */
export function notifyAfter(_event: NotifyEvent, _id: number): void {
  // Phase 5
}
