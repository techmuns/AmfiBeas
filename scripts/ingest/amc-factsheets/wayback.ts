/**
 * Internet Archive fallback for Akamai-walled AMC file hosts (Edelweiss).
 *
 * Edelweiss's edge 403s EVERY direct path we have — plain curl (sandbox and CI),
 * Playwright's request client, a hardened headless Chrome, even the in-page
 * fetch — because the block is by IP reputation, not fingerprint (the page goto
 * itself returns 403 "Access Denied" / errors.edgesuite.net before any JS runs).
 * AdvisorKhoj still NAMES each month's file URL on the AMC's own host, so we ask
 * the Internet Archive — whose crawlers fetch from their own IP space — to
 * capture the file (Save Page Now), then download the ORIGINAL bytes from the
 * snapshot (`id_` URL suffix = identity, no rewriting).
 *
 * The data source remains the AMC's own URL and the bytes are the AMC's own
 * workbook; archive.org is transport, not a data vendor. Each month's filename
 * is unique (upload-timestamped), so any snapshot of the exact URL is that
 * month's authoritative file — there is no staleness dimension.
 *
 * NOTE: archive.org is unreachable from the dev sandbox (egress policy); this
 * tier only functions in CI, which is where the monthly fetch runs anyway.
 */
import { execFileSync } from "node:child_process";

/** AMC slugs whose file host 403s all direct access — try the archive for these. */
export const WAYBACK_FALLBACK = new Set(["edelweiss"]);

const UA = "Mozilla/5.0 (compatible; AmfiBeas-ingest/1.0; +https://github.com/techmuns/AmfiBeas)";
const DEBUG = !!process.env.AMC_BROWSER_DEBUG;
function dbg(msg: string): void {
  if (DEBUG) console.log(`    [wayback] ${msg}`);
}

function curlRaw(url: string, maxTime: string): Buffer | null {
  try {
    return execFileSync("curl", ["-fsSL", "--max-time", maxTime, "-A", UA, url], {
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Newest existing snapshot (14-digit timestamp) of a URL, else null. */
function availableSnapshot(url: string): string | null {
  const body = curlRaw(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, "60");
  if (!body) return null;
  try {
    const ts = (JSON.parse(body.toString("utf8")) as { archived_snapshots?: { closest?: { timestamp?: string } } })
      ?.archived_snapshots?.closest?.timestamp;
    return typeof ts === "string" ? ts : null;
  } catch {
    return null;
  }
}

/** Ask Save Page Now to capture the URL fresh; the redirect chain ends at
 *  /web/<timestamp>/<url>, which names the new snapshot. Null on failure or
 *  rate-limit (unauthenticated SPN allows a modest burst — we request at most
 *  a handful of files per run). */
function savePageNow(url: string): string | null {
  try {
    const effective = execFileSync(
      "curl",
      ["-sSL", "-o", "/dev/null", "-w", "%{url_effective}", "--max-time", "300", "-A", UA,
        `https://web.archive.org/save/${url}`],
      { maxBuffer: 1024 * 1024 },
    ).toString("utf8");
    const m = effective.match(/\/web\/(\d{14})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Original bytes of a snapshot, or null when it is missing / an HTML page
 *  (an HTML body means the archive's crawler was served the wall too). */
function snapshotBytes(url: string, ts: string): Buffer | null {
  const buf = curlRaw(`https://web.archive.org/web/${ts}id_/${url}`, "180");
  if (!buf || buf.length < 500) {
    dbg(`snapshot ${ts} unreadable (${buf?.length ?? 0}b)`);
    return null;
  }
  const head = buf.subarray(0, 128).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head")) {
    dbg(`snapshot ${ts} is an HTML page — the archive was walled too`);
    return null;
  }
  dbg(`got ${buf.length}b from snapshot ${ts}`);
  return buf;
}

/** Fetch `url`'s original bytes via the archive: newest existing snapshot
 *  first (the archive may already have crawled it), else a fresh Save Page Now
 *  capture. Null when the archive can't produce a non-HTML body either. */
export function waybackFetch(url: string): Buffer | null {
  const existing = availableSnapshot(url);
  if (existing) {
    const buf = snapshotBytes(url, existing);
    if (buf) return buf;
  } else {
    dbg(`no snapshot yet: ${url.slice(0, 110)}`);
  }
  const fresh = savePageNow(url);
  if (!fresh) {
    dbg(`Save Page Now failed: ${url.slice(0, 110)}`);
    return null;
  }
  if (fresh === existing) return null; // SPN returned the same walled capture
  return snapshotBytes(url, fresh);
}
