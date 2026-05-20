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
 * Build a `?…` query string for a tab link. The active tab is encoded
 * as `?tab=<id>` and every other key in `preserved` is appended if its
 * value is a non-empty string. Array-valued params are flattened in
 * insertion order. Empty / undefined values are dropped so the URL
 * stays clean.
 */
export function buildTabHref(
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
  return `?${params.toString()}`;
}
