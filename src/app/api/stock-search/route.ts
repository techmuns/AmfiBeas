/**
 * Company search proxy for the Search Stocks tab.
 *
 * The upstream Muns endpoint needs a bearer token, so the browser must never
 * call it directly — this route runs on the Worker, reads MUNS_ACCESS_TOKEN from
 * the Cloudflare environment, and returns a flattened result list.
 *
 * GET /api/stock-search?q=reli
 *   → { results: [{ symbol, name, country, sector }], total }
 *
 * Status codes the client acts on:
 *   400 — query too short (the UI simply doesn't call for <2 chars)
 *   503 — no token configured; the UI falls back to its local company index so
 *         the tab still works before the secret is set
 *   502 — upstream error/timeout
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM = "https://devde.muns.io/stock/search";
/** Fixed per the API contract. */
const USER_INDEX = 124;
const TIMEOUT_MS = 8000;
const MIN_QUERY = 2;
const MAX_QUERY = 64;

/** Upstream shape: results maps SYMBOL → [country, name, sector]. */
interface UpstreamResponse {
  data?: {
    total_results?: number;
    results?: Record<string, (string | null)[]>;
  };
  message?: string;
  success?: boolean;
}

/**
 * The token is a Worker secret. On Cloudflare it arrives as a binding on the
 * Cloudflare env; under `next dev` (plain Node) it comes from process.env. Try
 * the binding first and fall back, so the same code path works in both.
 */
async function readToken(): Promise<string | null> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = await mod.getCloudflareContext({ async: true });
    const v = (ctx?.env as Record<string, unknown> | undefined)?.MUNS_ACCESS_TOKEN;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    // Not running on Workers — fall through to process.env.
  }
  const fromProcess = process.env.MUNS_ACCESS_TOKEN;
  return typeof fromProcess === "string" && fromProcess.trim() ? fromProcess.trim() : null;
}

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY) {
    return NextResponse.json(
      { error: `Query must be at least ${MIN_QUERY} characters.`, results: [] },
      { status: 400 }
    );
  }

  const token = await readToken();
  if (!token) {
    // Distinct from an upstream failure: the client falls back to local search.
    return NextResponse.json(
      { error: "Search service is not configured.", code: "no-token", results: [] },
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: q.slice(0, MAX_QUERY), user_index: USER_INDEX }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Search upstream returned ${upstream.status}.`, results: [] },
        { status: 502 }
      );
    }

    const json = (await upstream.json()) as UpstreamResponse;
    if (json.success === false) {
      return NextResponse.json(
        { error: json.message || "Search upstream reported a failure.", results: [] },
        { status: 502 }
      );
    }

    const raw = json.data?.results ?? {};
    const results = Object.entries(raw).map(([symbol, tuple]) => {
      const [country, name, sector] = Array.isArray(tuple) ? tuple : [];
      return {
        symbol,
        // Fall back to the ticker when the upstream omits a display name.
        name: (name ?? "").trim() || symbol,
        country: (country ?? "").trim(),
        sector: (sector ?? "").trim(),
      };
    });

    return NextResponse.json(
      { results, total: json.data?.total_results ?? results.length },
      {
        // Brief shared cache: type-aheads repeat the same prefixes constantly, and
        // this keeps a burst of keystrokes off the upstream.
        headers: { "cache-control": "private, max-age=30" },
      }
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "Search timed out." : "Search is unavailable.", results: [] },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
