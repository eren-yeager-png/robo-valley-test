// "Return to the Projects page after sign-in / sign-up". The value comes from a URL query parameter, so it is hostile input.
// This is an allow-list, not a filter: the result is always REBUILT from the configured site origin, the fixed Projects
// path and a validated project number. The caller's string is never returned, so nothing in it can survive.
//
// Accepted:   https://techytree.in/projects/?project=12      (the configured site origin; the path is the fixed one)
//             /projects/?project=12                            (a path only; resolved against the site origin)
// Everything else is rejected (null) and the caller falls back to SITE_URL: another host, a look-alike host, user-info,
// a protocol-relative URL, backslashes, encoded characters, javascript:/data:, control characters or spaces, a fragment,
// extra or repeated query parameters, or a project value that is not a positive integer.
//
// Pure (no Node imports) so tests, server components and anything else can share it.

const MAX_LENGTH = 300;
const MAX_PROJECT = 2_147_483_647;

/**
 * @param raw          the untrusted value
 * @param siteUrl      the configured site, e.g. "https://techytree.in/" (only its origin is used)
 * @param projectsPath the fixed path of the Projects page, e.g. "/projects/"
 * @returns the canonical URL, or null
 */
export function validateReturnTo(raw: unknown, siteUrl: string, projectsPath: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // Printable ASCII only: no spaces, tabs, newlines or other control characters (the URL parser would silently strip
  // some of them), no non-ASCII look-alike characters. Then no backslash (the parser treats it as a slash), no percent
  // sign (a still-encoded value means it was double-encoded) and no fragment.
  if (!/^[\x21-\x7e]+$/.test(raw) || raw.includes("\\") || raw.includes("%") || raw.includes("#")) return null;

  let site: URL;
  let path: string;
  try {
    site = new URL(siteUrl);
    if (site.protocol !== "https:" && site.protocol !== "http:") return null;
    path = projectsPath.endsWith("/") ? projectsPath : projectsPath + "/";
    if (!/^\/[A-Za-z0-9/_-]*$/.test(path) || path.includes("//")) return null;
  } catch {
    return null;
  }

  let url: URL;
  try {
    if (/^https?:\/\//i.test(raw)) url = new URL(raw);
    else if (/^\/(?![/\\])/.test(raw)) url = new URL(raw, site.origin); // a single leading slash, never "//"
    else return null; // javascript:, data:, //host, relative paths ...
  } catch {
    return null;
  }

  if (url.origin !== site.origin) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== path && url.pathname + "/" !== path) return null;
  if (url.hash !== "") return null;

  const keys = [...url.searchParams.keys()];
  const values = url.searchParams.getAll("project");
  if (keys.length !== 1 || keys[0] !== "project" || values.length !== 1) return null;
  if (!/^[1-9][0-9]{0,9}$/.test(values[0])) return null;
  if (Number(values[0]) > MAX_PROJECT) return null;

  return `${site.origin}${path}?project=${values[0]}`;
}
