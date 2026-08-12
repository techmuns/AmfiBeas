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

const TOKEN_KEY = "MUNS_ACCESS_TOKEN";

/** Where a candidate env came from, for the ?diag report. */
interface EnvProbe {
  source: string;
  ok: boolean;
  /** Binding NAMES only — never values. */
  keys?: string[];
  hasToken?: boolean;
  error?: string;
}

/** Every place a Worker secret can surface, tried in order. */
async function probeEnvs(): Promise<{ envs: Record<string, unknown>[]; probes: EnvProbe[] }> {
  const envs: Record<string, unknown>[] = [];
  const probes: EnvProbe[] = [];
  const add = (source: string, env: unknown, error?: string) => {
    if (error || !env || typeof env !== "object") {
      probes.push({ source, ok: false, error });
      return;
    }
    const rec = env as Record<string, unknown>;
    envs.push(rec);
    probes.push({
      source,
      ok: true,
      keys: Object.keys(rec).sort(),
      hasToken: typeof rec[TOKEN_KEY] === "string" && !!(rec[TOKEN_KEY] as string).trim(),
    });
  };

  try {
    const mod = await import("@opennextjs/cloudflare");
    try {
      add("cf-context-async", (await mod.getCloudflareContext({ async: true }))?.env);
    } catch (e) {
      add("cf-context-async", null, (e as Error).message.slice(0, 120));
    }
    try {
      add("cf-context-sync", mod.getCloudflareContext()?.env);
    } catch (e) {
      add("cf-context-sync", null, (e as Error).message.slice(0, 120));
    }
  } catch (e) {
    add("opennext-import", null, (e as Error).message.slice(0, 120));
  }
  add("process-env", process.env as unknown);
  return { envs, probes };
}

/**
 * The token is a Worker secret, so on Cloudflare it arrives as a binding on the
 * Cloudflare env; under `next dev` (plain Node) it comes from process.env. Every
 * surface is tried rather than just one, because which of them carries a
 * dashboard-set secret depends on the adapter version.
 */
async function readToken(): Promise<string | null> {
  const { envs } = await probeEnvs();
  for (const env of envs) {
    const v = env[TOKEN_KEY];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Wiring check for "the secret is set but the Worker says it isn't": reports
  // which env surfaces exist and what binding NAMES each carries. Never returns
  // a value, and never reveals the token itself.
  if (url.searchParams.get("diag") === "1") {
    const { probes } = await probeEnvs();
    return NextResponse.json(
      {
        tokenKey: TOKEN_KEY,
        found: probes.some((p) => p.hasToken),
        probes: probes.map((p) => ({
          ...p,
          // process.env on Workers carries the whole Node shim; only the names
          // that could plausibly be our binding are useful here.
          keys: p.source === "process-env" ? p.keys?.filter((k) => /MUNS|TOKEN|SECRET/i.test(k)) : p.keys,
        })),
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const q = (url.searchParams.get("q") ?? "").trim();
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
