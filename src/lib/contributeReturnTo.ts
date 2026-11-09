// "Return to the Contribute page after sign-in". The value comes from a URL query parameter, so it is hostile input.
// Like projectsReturnTo.ts this is an allow-list, not a filter: the result is REBUILT from the configured site origin, the fixed
// Contribute path and the validated sector slugs. The caller's string is never returned, so nothing in it can survive.
//
// Accepted:   https://techytree.in/contribute-now/                              the Contribute page itself
//             https://techytree.in/contribute-now/?sector=agriculture-dairy      one sector
//             /contribute-now/?sector=agriculture-dairy,education                a path only, several sectors (comma separated)
// Everything else is rejected (null): another host, user-info, a protocol-relative URL, backslashes, encoded characters,
// javascript:/data:, control characters or spaces, a fragment, dot segments, any other or repeated query parameter, an empty "?",
// a bad slug (only a-z, 0-9 and single dashes, up to 60 characters), a repeated slug, or more than 20 sectors.
// Pure (no Node imports) so tests, server components and anything else can share it.

const MAX_LENGTH = 700;
const MAX_SECTORS = 20;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateContributeReturn(raw: unknown, siteUrl: string, contributePath: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!/^[\x21-\x7e]+$/.test(raw) || raw.includes("\\") || raw.includes("%") || raw.includes("#")) return null;

  let site: URL;
  let path: string;
  try {
    site = new URL(siteUrl);
    if (site.protocol !== "https:" && site.protocol !== "http:") return null;
    path = contributePath.endsWith("/") ? contributePath : contributePath + "/";
    if (!/^\/[A-Za-z0-9/_-]*$/.test(path) || path.includes("//")) return null;
  } catch {
    return null;
  }

  let url: URL;
  try {
    if (/^https?:\/\//i.test(raw)) url = new URL(raw);
    else if (/^\/(?![/\\])/.test(raw)) url = new URL(raw, site.origin);
    else return null;
  } catch {
    return null;
  }

  if (url.origin !== site.origin) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== path && url.pathname + "/" !== path) return null;
  if (url.hash !== "") return null;
  if (/\/\.\.?(?:[/?]|$)/.test(raw)) return null;

  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) return raw.includes("?") ? null : `${site.origin}${path}`;
  const values = url.searchParams.getAll("sector");
  if (keys.length !== 1 || keys[0] !== "sector" || values.length !== 1) return null;
  const slugs = values[0].split(",");
  if (slugs.length === 0 || slugs.length > MAX_SECTORS) return null;
  for (const s of slugs) if (s.length > 60 || !SLUG.test(s)) return null;
  if (new Set(slugs).size !== slugs.length) return null;
  return `${site.origin}${path}?sector=${slugs.join(",")}`;
}
