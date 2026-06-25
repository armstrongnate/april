/** Lowercase, hyphenate, and truncate text at a word boundary for use in names. */
export function slugify(text: string, maxLen = 40, fallback = "issue"): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  // Truncate at a word boundary
  if (slug.length > maxLen) {
    slug = slug.substring(0, maxLen);
    const lastHyphen = slug.lastIndexOf("-");
    if (lastHyphen > 0) {
      slug = slug.substring(0, lastHyphen);
    }
    slug = slug.replace(/-+$/, "");
  }

  return slug.length === 0 ? fallback : slug;
}

export function makeSlug(issueNumber: number, title: string): string {
  return `gh-${issueNumber}-${slugify(title)}`;
}
