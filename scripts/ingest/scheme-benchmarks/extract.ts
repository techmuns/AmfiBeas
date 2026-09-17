/**
 * Benchmark extraction from a first-party AMC document.
 *
 * The problem: a monthly factsheet is one long text blob carrying every scheme
 * the AMC runs, each with a "Benchmark: <index>" field somewhere near its name.
 * We must attach each benchmark to the RIGHT scheme, and refuse rather than
 * guess when the attachment is uncertain.
 *
 * Method:
 *  1. Tokenize the document with the SAME normalizer the NAV crosswalk uses
 *     (scripts/ingest/nav-crosswalk.ts), so "Corp"→"corporate",
 *     "Aditya Birla SL"→"aditya birla sun life", "Large Cap"→"largecap" line up
 *     between our scheme names and the AMC's own wording.
 *  2. Locate every occurrence of every scheme of that AMC as a token-window hit
 *     (an "anchor"). The most SPECIFIC scheme wins an overlapping window; exact
 *     ties are discarded, because "Fund" vs "Fund - Series II" mis-attribution
 *     is exactly the failure mode this whole feature exists to remove.
 *  3. Locate every "Benchmark"/"Benchmark Index"/"Tier 1 Benchmark" label and
 *     read the index name out of the text that follows it with the registry's
 *     longest-exact-match scanner.
 *  4. Attach each benchmark to the NEAREST PRECEDING anchor, and only when no
 *     other anchor sits between the two.
 *
 * Contradiction handling: if one document yields two DIFFERENT canonical keys
 * for the same scheme, the scheme is reported as contradictory and left
 * unmapped. A wrong benchmark is worse than no benchmark.
 */

import { CRITICAL_TOKENS, normalize } from "../nav-crosswalk";
import { matchLongestBenchmark, type ResolvedBenchmark } from "../../../src/data/benchmark-registry";

/**
 * Labels that introduce a scheme's benchmark in AMC documents.
 *
 * A VALUE SEPARATOR is mandatory — a colon/dash, two or more spaces, or a line
 * break. Without it, "Nifty 10 yr Benchmark G-Sec ETF" (a scheme NAME that
 * happens to contain the word) reads as a labelled field and swallows whatever
 * text follows, which is how a G-Sec ETF ends up mapped to Nifty 100.
 */
const BENCHMARK_LABEL_RE =
  /\b(?:tier\s*[i1]{1,3}\s*)?benchmark(?:\s+index)?(?:\s*\(tier\s*[i1]{1,3}\))?(?:\s*[:\-–—]+\s*|\s{2,}|\s*\r?\n\s*)/gi;

/** SEBI scheme descriptors for passive schemes name the index being tracked —
 *  which IS that scheme's benchmark. Kept as a distinct evidence kind. */
const TRACKING_DESCRIPTOR_RE =
  /\b(?:replicat(?:ing|es)?\s*\/?\s*track(?:ing|s)?|replicat(?:ing|es)?|track(?:ing|s))\s+(?:the\s+)?/gi;

/** How far after the label we look for the index name. */
const VALUE_WINDOW = 160;
/** How far back from a benchmark label a scheme anchor may sit. */
const MAX_ANCHOR_GAP = 2000;
/** AMC-name tokens are optional inside an AMC's own document (headings often
 *  drop the house name), so they never count as REQUIRED tokens. */
const OPTIONAL_TOKEN_MIN_SCHEMES = 1;
/** How close a house token must sit to corroborate a weakly-named scheme. */
const HOUSE_RADIUS = 10;

export interface SchemeAnchorSpec {
  /** Caller's identity for the scheme (we hand it straight back). */
  id: string;
  /** Names to look for — the display name and any AMFI spelling. */
  names: string[];
}

interface Anchor {
  id: string;
  /** Character offset in the ORIGINAL text. */
  charStart: number;
  charEnd: number;
  /** How many of the scheme's tokens the window matched (specificity). */
  score: number;
}

export interface BenchmarkHit {
  schemeId: string;
  resolved: ResolvedBenchmark | null;
  /** Verbatim text the name was read from (kept even when unresolved). */
  rawText: string;
  evidenceKind: "labelled-benchmark-field" | "tracked-index-descriptor";
  charOffset: number;
}

export interface ExtractOptions {
  /** How a benchmark mention is attached to a scheme.
   *   "nearest-preceding" (default) — free-flowing documents (factsheet PDFs).
   *   "same-line" — one scheme per line (a scheme-name list), where crossing a
   *   line is always a mis-attribution. */
  anchorMode?: "nearest-preceding" | "same-line";
  /** Which scans to run. Default: both. A scheme-name list has no labelled
   *  benchmark fields, so it runs the descriptor scan only. */
  scans?: Array<"label" | "descriptor">;
}

export interface ExtractionResult {
  hits: BenchmarkHit[];
  /** Schemes with ≥2 different canonical keys in this document. */
  contradictory: string[];
  anchorCount: number;
  labelCount: number;
}

interface DocToken {
  t: string;
  /** Offset of this token in the ORIGINAL text. */
  start: number;
  end: number;
}

/**
 * Tokenize the document the same way scheme names are tokenized, keeping each
 * token's offset in the original text so anchors can be reported in raw-text
 * coordinates. `normalize` is applied per raw word-run so alias/expansion rules
 * (corp→corporate, "large cap"→largecap) apply identically on both sides.
 */
function tokenizeDoc(text: string): DocToken[] {
  const words: Array<{ w: string; start: number; end: number }> = [];
  const re = /[A-Za-z0-9&]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) words.push({ w: m[0], start: m.index, end: m.index + m[0].length });

  const out: DocToken[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    const soloA = normalize(a.w).tokens;
    if (b) {
      // Some two-word phrases FUSE in the crosswalk normalizer ("Large Cap" →
      // largecap, "Index Fund" → indexfund, "Exchange Traded" → etf). Detect
      // that by asking whether the pair yields a token neither word yields
      // alone; if so, take the pair and skip ahead.
      const pair = normalize(`${a.w} ${b.w}`).tokens;
      const solo = new Set([...soloA, ...normalize(b.w).tokens]);
      if (pair.some((t) => !solo.has(t))) {
        for (const t of pair) out.push({ t, start: a.start, end: b.end });
        i += 1;
        continue;
      }
    }
    for (const t of soloA) out.push({ t, start: a.start, end: a.end });
  }
  return out;
}

/** AMC-house tokens seen in most of an AMC's scheme names — matched when
 *  present but never required, since headings often omit the house name. */
function houseTokens(specs: SchemeAnchorSpec[], tokenSets: Map<string, string[]>): Set<string> {
  const counts = new Map<string, number>();
  for (const s of specs) {
    for (const t of new Set(tokenSets.get(s.id) ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const threshold = Math.max(OPTIONAL_TOKEN_MIN_SCHEMES, Math.ceil(specs.length * 0.6));
  const out = new Set<string>();
  for (const [t, c] of counts) if (c >= threshold) out.add(t);
  return out;
}

/**
 * Find every scheme anchor in the document. Overlapping anchors resolve to the
 * highest-scoring (most specific) scheme; exact ties are dropped.
 */
export function findAnchors(text: string, specs: SchemeAnchorSpec[]): Anchor[] {
  const docTokens = tokenizeDoc(text);
  if (docTokens.length === 0 || specs.length === 0) return [];

  const positions = new Map<string, number[]>();
  for (let i = 0; i < docTokens.length; i++) {
    const arr = positions.get(docTokens[i].t);
    if (arr) arr.push(i);
    else positions.set(docTokens[i].t, [i]);
  }

  const tokenSets = new Map<string, string[]>();
  for (const s of specs) {
    const merged = new Set<string>();
    for (const n of s.names) for (const t of normalize(n).tokens) merged.add(t);
    tokenSets.set(s.id, [...merged]);
  }
  const house = houseTokens(specs, tokenSets);

  const candidates: Anchor[] = [];
  for (const s of specs) {
    const toks = tokenSets.get(s.id) ?? [];
    const required = toks.filter((t) => !house.has(t));
    if (required.length === 0) continue; // nothing distinguishing — never anchor
    // Pivot on the rarest required token to keep this linear-ish.
    let pivot = required[0];
    let pivotCount = positions.get(pivot)?.length ?? 0;
    for (const t of required) {
      const c = positions.get(t)?.length ?? 0;
      if (c === 0) { pivot = t; pivotCount = 0; break; }
      if (c < pivotCount || pivotCount === 0) { pivot = t; pivotCount = c; }
    }
    const pivotPositions = positions.get(pivot);
    if (!pivotPositions || pivotPositions.length === 0) continue;

    const span = Math.max(toks.length + 6, 12);
    for (const p of pivotPositions) {
      const lo = Math.max(0, p - span);
      const hi = Math.min(docTokens.length - 1, p + span);
      // Nearest occurrence of each token inside the window, so the anchor's
      // char span is the tight phrase rather than the whole window.
      const at = new Map<string, number>();
      for (let i = lo; i <= hi; i++) {
        const t = docTokens[i].t;
        const prev = at.get(t);
        if (prev === undefined || Math.abs(i - p) < Math.abs(prev - p)) at.set(t, i);
      }
      if (!required.every((t) => at.has(t))) continue;
      // A single distinguishing token is too weak to anchor on its own (every
      // "mid cap stocks" sentence would match a Mid Cap Fund) — demand a house
      // token in the immediate neighbourhood as corroboration.
      const houseNear = toks.some((t) => house.has(t) && at.has(t) && Math.abs((at.get(t) as number) - p) <= HOUSE_RADIUS);
      if (required.length < 2 && !houseNear) continue;
      // The anchor SPAN covers only the distinguishing tokens. House tokens can
      // sit a dozen tokens away (a heading above a paragraph), and stretching
      // the span to reach them would swallow the NEXT scheme's heading — which
      // is precisely how a benchmark ends up on the wrong fund.
      const reqIdx = required.map((t) => at.get(t) as number);
      const loIdx = Math.min(...reqIdx);
      const hiIdx = Math.max(...reqIdx);
      // CRITICAL-TOKEN GUARD, the same reject-don't-downgrade rule the NAV
      // crosswalk applies: if the matched phrase contains a distinguishing
      // token (or a digit) the scheme does NOT have, this is a different
      // scheme. "HDFC NIFTY Bank ETF" must not anchor inside "HDFC NIFTY PSU
      // BANK ETF" just because its tokens are a subset.
      const own = new Set(toks);
      let intruder = false;
      for (let i = loIdx; i <= hiIdx; i++) {
        const t = docTokens[i].t;
        if (own.has(t)) continue;
        if (CRITICAL_TOKENS.has(t) || /^\d+$/.test(t)) { intruder = true; break; }
      }
      if (intruder) continue;
      candidates.push({
        id: s.id,
        charStart: docTokens[loIdx].start,
        charEnd: docTokens[hiIdx].end,
        // Specificity counts EVERY scheme token found in the window, so the
        // more precisely-named scheme wins an overlap.
        score: toks.filter((t) => at.has(t)).length,
      });
    }
  }

  // Resolve overlaps: best score wins, ties are ambiguous and dropped.
  candidates.sort((a, b) => a.charStart - b.charStart || b.score - a.score);
  const kept: Anchor[] = [];
  for (const c of candidates) {
    const last = kept[kept.length - 1];
    if (last && c.charStart <= last.charEnd) {
      if (c.score > last.score) kept[kept.length - 1] = c;
      else if (c.score === last.score && c.id !== last.id) kept[kept.length - 1] = { ...last, id: "" }; // ambiguous
      continue;
    }
    kept.push(c);
  }
  return kept.filter((a) => a.id !== "");
}

/** Anchor that sits on the SAME LINE as `offset`. Used for documents that are a
 *  list of scheme names, where a benchmark can only belong to its own line. */
function sameLineAnchor(text: string, anchors: Anchor[], offset: number): Anchor | null {
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  let lineEnd = text.indexOf("\n", offset);
  if (lineEnd < 0) lineEnd = text.length;
  let best: Anchor | null = null;
  for (const a of anchors) {
    if (a.charStart >= lineStart && a.charEnd <= lineEnd && a.charStart <= offset) best = a;
    if (a.charStart > offset) break;
  }
  return best;
}

/** Nearest preceding anchor, with nothing in between. */
function anchorFor(anchors: Anchor[], offset: number): Anchor | null {
  let best: Anchor | null = null;
  for (const a of anchors) {
    if (a.charStart > offset) break;
    best = a;
  }
  if (!best) return null;
  if (offset - best.charEnd > MAX_ANCHOR_GAP) return null;
  return best;
}

/**
 * Extract scheme → benchmark hits from one document's plain text.
 * `specs` must be scoped to the AMC that published the document.
 */
export function extractBenchmarks(
  text: string,
  specs: SchemeAnchorSpec[],
  options: ExtractOptions = {}
): ExtractionResult {
  const anchorMode = options.anchorMode ?? "nearest-preceding";
  const scans = options.scans ?? ["label", "descriptor"];
  const anchors = findAnchors(text, specs);
  const hits: BenchmarkHit[] = [];
  let labelCount = 0;

  const scan = (
    re: RegExp,
    evidenceKind: BenchmarkHit["evidenceKind"]
  ) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      labelCount += 1;
      const valueStart = m.index + m[0].length;
      const rawWindow = text.slice(valueStart, valueStart + VALUE_WINDOW);
      // NEVER cross a hard break. A factsheet line carries one field; a window
      // that bleeds past the line end reads the NEXT scheme's text.
      const brk = rawWindow.search(/[\r\n|]/);
      const window = brk >= 0 ? rawWindow.slice(0, brk) : rawWindow;
      const anchor = anchorMode === "same-line" ? sameLineAnchor(text, anchors, m.index) : anchorFor(anchors, m.index);
      if (!anchor) continue;
      const resolved = matchLongestBenchmark(window);
      hits.push({
        schemeId: anchor.id,
        resolved,
        rawText: window.split(/[\r\n|]/)[0].trim().slice(0, 120),
        evidenceKind,
        charOffset: m.index,
      });
      if (labelCount > 20000) break;
    }
  };

  if (scans.includes("label")) scan(BENCHMARK_LABEL_RE, "labelled-benchmark-field");
  if (scans.includes("descriptor")) scan(TRACKING_DESCRIPTOR_RE, "tracked-index-descriptor");

  // Contradiction detection: two different canonical keys for one scheme in the
  // SAME document means our attachment is unreliable → leave the scheme out.
  const keysBySchemeId = new Map<string, Set<string>>();
  for (const h of hits) {
    if (!h.resolved) continue;
    const set = keysBySchemeId.get(h.schemeId) ?? new Set<string>();
    set.add(h.resolved.canonical.key);
    keysBySchemeId.set(h.schemeId, set);
  }
  const contradictory = [...keysBySchemeId.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);

  return { hits, contradictory, anchorCount: anchors.length, labelCount };
}
