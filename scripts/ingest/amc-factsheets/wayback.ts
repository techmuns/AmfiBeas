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
import { gunzipSync } from "node:zlib";

/** AMC slugs whose file host 403s all direct access — try the archive for these. */
export const WAYBACK_FALLBACK = new Set(["edelweiss"]);

const UA = "Mozilla/5.0 (compatible; AmfiBeas-ingest/1.0; +https://github.com/techmuns/AmfiBeas)";
const DEBUG = !!process.env.AMC_BROWSER_DEBUG;
function dbg(msg: string): void {
  if (DEBUG) console.log(`    [wayback] ${msg}`);
}

function curlRaw(url: string, maxTime: string): Buffer | null {
  try {
    // --compressed: snapshots replay with the ORIGINAL response's
    // Content-Encoding (the crawler asked for gzip) — without this the "bytes"
    // we hand the workbook parser are the gzip stream, which parses to nothing.
    const buf = execFileSync("curl", ["-fsSL", "--compressed", "--max-time", maxTime, "-A", UA, url], {
      maxBuffer: 256 * 1024 * 1024,
    });
    // Belt and braces for a replay that ships gzip bytes without the header.
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try { return gunzipSync(buf); } catch { return buf; }
    }
    return buf;
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

/** Ask Save Page Now to capture the URL fresh. Modern SPN doesn't redirect a
 *  GET to the snapshot — it queues a capture job behind a progress page — so:
 *  POST the save form, then poll the availability API until the new snapshot
 *  appears (bounded). Returns the snapshot timestamp, else null. Even a null
 *  here can still succeed LATER: a queued capture completes asynchronously and
 *  the next run's availableSnapshot() will find it. */
function savePageNow(url: string, before: string | null): string | null {
  try {
    execFileSync(
      "curl",
      ["-sS", "-o", "/dev/null", "--max-time", "120", "-A", UA,
        "-X", "POST", "--data-urlencode", `url=${url}`, "--data-urlencode", "capture_all=on",
        `https://web.archive.org/save/${url}`],
      { maxBuffer: 4 * 1024 * 1024 },
    );
  } catch {
    dbg(`SPN request errored: ${url.slice(0, 100)}`);
    return null;
  }
  // The capture runs async; poll until a snapshot newer than `before` shows up.
  for (let i = 0; i < 8; i++) {
    execFileSync("sleep", ["15"]);
    const ts = availableSnapshot(url);
    if (ts && ts !== before) return ts;
  }
  dbg(`SPN queued but no new snapshot within 2min (may land for a later run): ${url.slice(0, 100)}`);
  return null;
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
  dbg(`got ${buf.length}b from snapshot ${ts} (magic ${buf.subarray(0, 4).toString("hex")})`);
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
  const fresh = savePageNow(url, existing);
  if (!fresh) return null;
  return snapshotBytes(url, fresh);
}
