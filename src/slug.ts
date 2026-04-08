export function makeSlug(issueNumber: number, title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  // Truncate to 40 chars at word boundary
  if (slug.length > 40) {
    slug = slug.substring(0, 40);
    const lastHyphen = slug.lastIndexOf("-");
    if (lastHyphen > 0) {
      slug = slug.substring(0, lastHyphen);
    }
    slug = slug.replace(/-+$/, "");
  }

  // Fallback if empty
  if (slug.length === 0) {
    slug = "issue";
  }

  return `gh-${issueNumber}-${slug}`;
}
