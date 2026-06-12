/**
 * Normalize a page reference for the API. Accepts a UUID id, a slug, or a full
 * page URL (e.g. https://sharedrop.cloud/<username>/<slug>) and returns the
 * value the API resolves against: the trailing path segment for URLs, or the
 * input unchanged otherwise. The server resolves UUID-or-slug; this only
 * unwraps URLs so a pasted link works the same as a bare slug.
 */
export function normalizePageRef(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/")) {
    const path = trimmed.split(/[?#]/)[0].replace(/\/+$/, "");
    const segments = path.split("/");
    return segments[segments.length - 1] || trimmed;
  }
  return trimmed;
}
