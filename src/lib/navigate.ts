// Full-page navigation (leaves the Next.js app, e.g. to the WordPress site). A separate function so tests can observe it.
export const hardNavigate = (to: string): void => window.location.replace(to);
