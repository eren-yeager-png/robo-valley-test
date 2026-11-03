// The root URL shows the existing login page. This re-exports it (page + metadata) instead of
// copying it, so "/" and "/login" always behave identically: a signed-in visitor is redirected to
// the website by that page (on the server), and everyone else sees the login form. No redirect
// happens here, and that page never redirects to its own host, so there is no redirect loop.
export { default, metadata } from "./login/page";
