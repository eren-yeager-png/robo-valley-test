/**
 * The address of the Login activity page with a period and (optionally) one event type. The stat cards, the chips and the period tabs all
 * use it, on the server and in the browser (so it must not live in a "use client" file: a server page cannot call those).
 */
export function activityHref(days: number, event: string): string {
  return `/admin/login-activity?${new URLSearchParams({ ...(event ? { event } : {}), range: String(days) })}`;
}
