// Cache policy for the PUBLIC Find a Service reads (search and categories), successful answers only.
// The shared cache (Vercel's CDN) may keep an answer for 60 seconds and may serve a stale one for up to 30 more while it fetches a fresh one.
// Each full URL (query string included) is its own cache entry. Errors (400, 429, 500) never use this: json() sends them as no-store.
// Trade-off: after an admin confirms an upload, the new data can take about a minute to show for visitors (see NEW_DATA_DELAY_NOTE).
export const SERVICE_CACHE_SECONDS = 60;
export const SERVICE_STALE_SECONDS = 30;
export const SERVICE_CACHE_CONTROL = `public, s-maxage=${SERVICE_CACHE_SECONDS}, stale-while-revalidate=${SERVICE_STALE_SECONDS}`;
export const NEW_DATA_DELAY_NOTE = "It may take about a minute to appear on the website.";
