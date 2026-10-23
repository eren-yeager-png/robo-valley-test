// The root URL shows the existing login page. This re-exports it (page + metadata) instead of
// copying it, so "/" and "/login" always behave identically: a signed-in visitor is redirected to
// the dashboard by that page, and everyone else sees the login form. No redirect happens here,
// so there is no way to create a redirect loop.
export { default, metadata } from "./login/page";
