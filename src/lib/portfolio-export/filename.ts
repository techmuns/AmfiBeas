/**
 * Small filename / timestamp helpers for the Portfolio Tracker exports. Kept
 * separate so the (client-only, click-time) `new Date()` call lives in one place
 * and never runs during render.
 */

/** "30 Jun 2026" — the human label printed on the cover + in filenames' date. */
export function exportStamp(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "HDFC Flexi Cap Fund" → "hdfc-flexi-cap-fund" for a tidy download name. */
export function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "portfolio"
  );
}
