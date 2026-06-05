/**
 * Pure helpers for URL-driven dashboard tabs. The dashboard reads the
 * active tab from `?tab=<id>`; every other query parameter is treated
 * as orthogonal to the tab selection and passes through unchanged.
 */

/**
 * Coerce a raw `searchParams` value into one of an allowlist of tab
 * IDs, falling back to `fallback` when the value is missing, an array,
 * or not in the allowlist. The allowlist is the source of truth — any
 * unrecognised `?tab=` value silently falls back so old bookmarks never
 * break and no panel is left rendered with stale state.
 */
export function resolveTab<T extends string>(
  raw: string | string[] | undefined,
  tabs: readonly T[],
  fallback: T,
): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return fallback;
  return (tabs as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Like `resolveTab`, but first remaps legacy / removed tab IDs to their current
 * destination via `aliases` (e.g. a merged-away `?tab=flow-table` → the new
 * "flows" tab), so old bookmarks land on the nearest surviving tab instead of
 * silently falling back to the default. A raw value that is already a current
 * tab id — or an unknown one — is handled by `resolveTab`.
 */
export function resolveTabWithAliases<T extends string>(
  raw: string | string[] | undefined,
  tabs: readonly T[],
  aliases: Partial<Record<string, T>>,
  fallback: T,
): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === "string") {
    const aliased = aliases[v];
    if (aliased && (tabs as readonly string[]).includes(aliased)) return aliased;
  }
  return resolveTab(raw, tabs, fallback);
}

/**
 * Build a fully-qualified tab href: `<basePath>?…` with every non-`tab`
 * key in `preserved` carried over and `tab` set to `tabId`. Empty /
 * undefined values are dropped so the URL stays clean.
 *
 * The `basePath` is required so callers always produce an absolute
 * internal route (`/monthly?tab=flows`) rather than a path-less query
 * string (`?tab=flows`). Path-less hrefs work in most React Router
 * implementations but make in-app navigation fragile across the
 * Next.js App Router — explicit paths always navigate via the
 * client-side router.
 */
export function buildTabHref(
  basePath: string,
  tabId: string,
  preserved: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preserved)) {
    if (key === "tab") continue;
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string" && v.length > 0) params.append(key, v);
      }
    }
  }
  params.set("tab", tabId);
  return `${basePath}?${params.toString()}`;
}
