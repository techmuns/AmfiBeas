import {
  info,
  mergeBySlugQuarter,
  nowIso,
  parseNumberLoose,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";
import {
  AMCS,
  amfiNameToSlug,
  isLikelyAmcName,
  slugifyAmfiName,
} from "../../src/data/amcs";
import type {
  AmcAaumQuarterlyRow,
  AmcAaumQuarterlySnapshot,
} from "../../src/data/snapshots/types";
import type { Page, Browser } from "playwright";

const FORM_URL = "https://www.amfiindia.com/aum-data/average-aum";

/**
 * Direct backend endpoint discovered in the network capture of a successful
 * Playwright run:
 *   GET https://www.amfiindia.com/api/average-aum-fundwise?fyId=1&periodId=1
 * Returns the same Fundwise AAUM JSON the form populates the table from.
 *
 * TODO: once we have a stable mapping from (calendar quarter) → (fyId,
 * periodId) we can replace the Playwright form-driving with a direct
 * fetch — much faster and more reliable. For now we keep Playwright
 * because the id mapping isn't documented and AMFI may rotate ids.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _DISCOVERED_API_BASE =
  "https://www.amfiindia.com/api/average-aum-fundwise";

const TARGET_AMCS = [
  "HDFC Mutual Fund",
  "Nippon India Mutual Fund",
  "Aditya Birla Sun Life Mutual Fund",
  "UTI Mutual Fund",
];

// All timing budgets in milliseconds. Sized so a single quarter finishes in
// ~60s worst case, leaving the overall kill timer comfortably above 8×60s
// while staying under the 20-minute workflow timeout.
const T = {
  totalKill: 900_000,
  pageGoto: 25_000,
  waitForFormReady: 12_000,
  waitForDependentFields: 8_000,
  waitForLoadingDone: 12_000,
  waitForOptionsListbox: 2_500,
  clickInput: 3_000,
  clickOption: 1_500,
  fillInput: 1_500,
  goButton: 4_000,
  postGoNetworkIdle: 15_000,
  postGoSettle: 2_500,
  shortSleep: 250,
  midSleep: 500,
};

const DEBUG_ONE_QUARTER = process.env.AAUM_DEBUG_ONE_QUARTER === "1";

// Verbose log: emits only in debug mode. Use for chatty per-step traces that
// are valuable when triaging a single quarter but spam logs across 8 quarters.
function vinfo(msg: string) {
  if (DEBUG_ONE_QUARTER) info(msg);
}

interface QuarterToFetch {
  calendarQ: string;
  fyEndYear: number;
  fyCandidates: string[];
  periodCandidates: string[];
}

function recentQuartersFY(n: number): QuarterToFetch[] {
  const out: QuarterToFetch[] = [];
  const now = new Date();
  let yr = now.getFullYear();
  let mo = now.getMonth() + 1;
  while (![3, 6, 9, 12].includes(mo)) {
    mo -= 1;
    if (mo <= 0) {
      mo = 12;
      yr -= 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const calendarQ = `${yr}-Q${Math.ceil(mo / 3)}`;
    const fyEndYear = mo <= 3 ? yr : yr + 1;
    // AMFI displays FY as "April YYYY - March YYYY+1". Put that first;
    // keep the older "YYYY-YYYY" / "YYYY-YY" forms as fallback aliases.
    const fyCandidates = [
      `April ${fyEndYear - 1} - March ${fyEndYear}`,
      `April ${fyEndYear - 1}-March ${fyEndYear}`,
      `Apr ${fyEndYear - 1} - Mar ${fyEndYear}`,
      `${fyEndYear - 1}-${fyEndYear}`,
      `${fyEndYear - 1}-${String(fyEndYear).slice(-2)}`,
    ];
    // AMFI displays period as "January - March 2026" etc. (year suffix
    // matches the period END calendar year). Lead with that form; keep
    // older year-less forms as fallbacks.
    const periodCandidates =
      mo === 3
        ? [
            `January - March ${yr}`,
            `January-March ${yr}`,
            `Jan - Mar ${yr}`,
            "January - March",
            "January-March",
            "Jan-Mar",
            "Q4",
          ]
        : mo === 6
        ? [
            `April - June ${yr}`,
            `April-June ${yr}`,
            `Apr - Jun ${yr}`,
            "April - June",
            "April-June",
            "Apr-Jun",
            "Q1",
          ]
        : mo === 9
        ? [
            `July - September ${yr}`,
            `July-September ${yr}`,
            `Jul - Sep ${yr}`,
            "July - September",
            "July-September",
            "Jul-Sep",
            "Q2",
          ]
        : [
            `October - December ${yr}`,
            `October-December ${yr}`,
            `Oct - Dec ${yr}`,
            "October - December",
            "October-December",
            "Oct-Dec",
            "Q3",
          ];
    out.push({ calendarQ, fyEndYear, fyCandidates, periodCandidates });
    mo -= 3;
    if (mo <= 0) {
      mo += 12;
      yr -= 1;
    }
  }
  return out;
}

interface ParsedAmcRow {
  amcSlug: string;
  amcNameAsReported: string;
  avgAum: number;
  /** How `amcSlug` was resolved — "mapped" if the AMFI name matched
   *  the curated AMFI_NAME_TO_SLUG map, "auto_slug" if derived
   *  deterministically from the AMFI name. The extractor never
   *  returns "unmapped" today (all rows produce a slug); the field
   *  is on the schema for forward compatibility. */
  mappingStatus: "mapped" | "auto_slug";
  /** Display label — curated short name (e.g. "HDFC AMC") when
   *  mapped, AMFI name with the trailing "Mutual Fund"/"Asset
   *  Management" suffix stripped otherwise. */
  displayName: string;
}

/** Resolve the slug + mappingStatus + displayName for an AMFI name.
 *  Curated mappings always win so HDFC stays "hdfc" and ICICI Pru
 *  stays "icici-pru" — never collides with the auto-slugifier. */
function resolveAmcIdentity(name: string): {
  slug: string;
  mappingStatus: "mapped" | "auto_slug";
  displayName: string;
} {
  const curated = amfiNameToSlug(name);
  if (curated) {
    const profile = AMCS.find((a) => a.slug === curated);
    return {
      slug: curated,
      mappingStatus: "mapped",
      displayName: profile?.name ?? name.replace(/\s+Mutual\s+Fund\s*$/i, ""),
    };
  }
  const slug = slugifyAmfiName(name);
  return {
    slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
    mappingStatus: "auto_slug",
    displayName: name.replace(/\s+Mutual\s+Fund\s*$/i, "").trim(),
  };
}

interface FieldOutcome {
  found: boolean;
  options: string[];
  chosen: string | null;
  visibleValue: string;
}

const EMPTY_FIELD: FieldOutcome = {
  found: false,
  options: [],
  chosen: null,
  visibleValue: "",
};

interface XhrCapture {
  method: string;
  url: string;
  status: number;
  contentType: string;
  bodyPreview?: string;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * After a dropdown selection AMFI may swap the next dependent input to a
 * disabled "Loading..." placeholder while it fetches options. Poll until
 * that placeholder is gone (or never existed). Returns true when settled,
 * false on timeout. Cheap polling (every 400ms) so we exit fast on success.
 */
async function waitForLoadingDone(
  page: Page,
  quarter: string,
  label: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stillLoading = await page
      .evaluate(() => {
        const inputs = Array.from(
          document.querySelectorAll('input[placeholder="Loading..."]')
        );
        return inputs.some((el) => (el as HTMLElement).offsetParent !== null);
      })
      .catch(() => false);
    if (!stillLoading) {
      vinfo(
        `AAUM[${quarter}]: loading settled [${label}] in ${Math.round(
          timeoutMs - (deadline - Date.now())
        )}ms`
      );
      return true;
    }
    await sleep(400);
  }
  warn(
    `AAUM[${quarter}]: loading TIMED OUT [${label}] after ${timeoutMs}ms (Loading... still present)`
  );
  return false;
}

async function isPlaceholderVisible(
  page: Page,
  placeholder: string
): Promise<boolean> {
  return await page
    .evaluate((ph: string) => {
      const matches = Array.from(
        document.querySelectorAll(`input[placeholder="${ph}"]`)
      );
      return matches.some((el) => (el as HTMLElement).offsetParent !== null);
    }, placeholder)
    .catch(() => false);
}

async function logVisiblePlaceholders(
  page: Page,
  quarter: string,
  label: string
) {
  const data = await page
    .evaluate(() => {
      return Array.from(document.querySelectorAll("input[placeholder]"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const e = el as HTMLInputElement;
          return {
            placeholder: e.placeholder,
            value: e.value,
            disabled: e.disabled,
          };
        });
    })
    .catch(() => []);
  vinfo(
    `AAUM[${quarter}]: visible placeholders [${label}]: ${JSON.stringify(data)}`
  );
}

interface GoButtonState {
  found: boolean;
  tag: string | null;
  disabled: boolean | null;
  ariaDisabled: string | null;
  classes: string | null;
}

async function readGoButtonState(page: Page): Promise<GoButtonState> {
  const state = await page
    .evaluate(() => {
      const all = Array.from(
        document.querySelectorAll(
          'button, [role="button"], input[type="submit"], input[type="button"]'
        )
      );
      const go = all.find(
        (el) =>
          /^go$/i.test(
            (
              (el as HTMLElement).textContent ||
              (el as HTMLInputElement).value ||
              ""
            ).trim()
          )
      );
      if (!go) {
        return {
          found: false,
          tag: null,
          disabled: null,
          ariaDisabled: null,
          classes: null,
        };
      }
      const e = go as HTMLButtonElement;
      return {
        found: true,
        tag: go.tagName,
        disabled: e.disabled,
        ariaDisabled: go.getAttribute("aria-disabled"),
        classes: ((go as HTMLElement).className || "")
          .toString()
          .slice(0, 120),
      };
    })
    .catch(
      (): GoButtonState => ({
        found: false,
        tag: null,
        disabled: null,
        ariaDisabled: null,
        classes: null,
      })
    );
  return state as GoButtonState;
}

async function setMuiAutocompleteByPlaceholder(
  page: Page,
  placeholder: string,
  candidates: string[]
): Promise<FieldOutcome> {
  // Prefer a visible input. MUI sometimes mounts a hidden duplicate that
  // .first() would pick up otherwise. :visible is a Playwright pseudo.
  let input = page.locator(`input[placeholder="${placeholder}"]:visible`).first();
  if ((await input.count()) === 0) {
    input = page.locator(`input[placeholder="${placeholder}"]`).first();
  }
  if ((await input.count()) === 0) return { ...EMPTY_FIELD };

  try {
    await input.scrollIntoViewIfNeeded({ timeout: T.clickInput });
  } catch {}

  try {
    await input.click({ timeout: T.clickInput });
  } catch (err) {
    warn(`  click input[placeholder="${placeholder}"] failed: ${(err as Error).message}`);
    return { found: true, options: [], chosen: null, visibleValue: "" };
  }
  await sleep(T.shortSleep);

  // Wait briefly for popup; if none, send ArrowDown once and look again.
  let popped = false;
  try {
    await page.waitForSelector(
      'ul[role="listbox"], [role="listbox"], .MuiAutocomplete-listbox, .MuiAutocomplete-popper',
      { timeout: T.waitForOptionsListbox }
    );
    popped = true;
  } catch {}
  if (!popped) {
    try {
      await input.press("ArrowDown", { timeout: T.shortSleep });
    } catch {}
    try {
      await page.waitForSelector(
        'ul[role="listbox"], [role="listbox"], .MuiAutocomplete-listbox, .MuiAutocomplete-popper',
        { timeout: T.waitForOptionsListbox }
      );
    } catch {}
  }

  const options = await page.evaluate(() => {
    const root =
      document.querySelector('[role="listbox"]') ||
      document.querySelector(".MuiAutocomplete-listbox") ||
      document.querySelector(".MuiAutocomplete-popper");
    if (!root) return [];
    const items = root.querySelectorAll(
      '[role="option"], .MuiAutocomplete-option, li'
    );
    return Array.from(items)
      .map((el) => (el.textContent || "").trim())
      .filter((t) => t.length > 0);
  });

  const tryMatch = (mode: "exact" | "ci" | "partial"): string | null => {
    for (const cand of candidates) {
      const target = cand.toLowerCase().trim();
      const found = options.find((o) => {
        if (mode === "exact") return o === cand;
        const n = o.toLowerCase().trim();
        if (mode === "ci") return n === target;
        return n.includes(target);
      });
      if (found) return found;
    }
    return null;
  };

  const chosen = tryMatch("exact") ?? tryMatch("ci") ?? tryMatch("partial");

  // Helper: read the visible value back from the placeholder input.
  const readVisible = async (): Promise<string> => {
    await sleep(T.shortSleep);
    return (await input.inputValue().catch(() => "")) ?? "";
  };

  if (chosen) {
    const safeChosen = chosen.replace(/"/g, '\\"');
    const optLocators = [
      page.locator(`[role="option"]:has-text("${safeChosen}")`).first(),
      page.locator(`.MuiAutocomplete-option:has-text("${safeChosen}")`).first(),
      page.locator(`li[role="option"]:has-text("${safeChosen}")`).first(),
    ];
    for (const opt of optLocators) {
      try {
        if ((await opt.count()) === 0) continue;
        await opt.click({ timeout: T.clickOption });
        const visibleValue = await readVisible();
        if (visibleValue && visibleValue.trim().length > 0) {
          return { found: true, options, chosen, visibleValue };
        }
        // Click registered but the input value didn't change — try the next selector.
      } catch {}
    }
  }

  // Fallback: type filter + ArrowDown + Enter (single attempt)
  if (candidates.length > 0) {
    try {
      await input.fill("", { timeout: T.fillInput });
      await input.fill(candidates[0], { timeout: T.fillInput });
      await sleep(T.shortSleep);
      await input.press("ArrowDown", { timeout: T.shortSleep });
      await input.press("Enter", { timeout: T.shortSleep });
      const visibleValue = await readVisible();
      if (visibleValue && visibleValue.trim().length > 0) {
        return { found: true, options, chosen: visibleValue, visibleValue };
      }
    } catch {}
  }

  return { found: true, options, chosen: null, visibleValue: "" };
}

async function clickGoButton(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("button", { name: /^go$/i }).first(),
    page.locator('button:has-text("Go")').first(),
    page.locator('input[type="button"][value="Go"]').first(),
    page.locator('input[type="submit"][value="Go"]').first(),
  ];
  for (const c of candidates) {
    try {
      if ((await c.count()) === 0) continue;
      await c.first().click({ timeout: T.goButton });
      return true;
    } catch {}
  }
  return false;
}

async function captureResult(page: Page, targets: string[]) {
  return await page.evaluate((amcTargets: string[]) => {
    const tables = Array.from(document.querySelectorAll("table")).map((tbl) => {
      const headers = Array.from(
        tbl.querySelectorAll("thead tr th, tr:first-child th, tr:first-child td")
      ).map((c) => (c.textContent || "").trim());
      const rows = Array.from(tbl.querySelectorAll("tr"))
        .map((r) =>
          Array.from(r.querySelectorAll("th, td")).map((c) =>
            (c.textContent || "").trim()
          )
        )
        .filter((r) => r.length > 0);
      return { headers, rows };
    });
    const downloadLinks = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const e = a as HTMLAnchorElement;
        return { href: e.href, text: (e.textContent || "").trim() };
      })
      .filter((l) => /\.(xlsx|xls|csv|pdf)(\?|$)/i.test(l.href))
      .slice(0, 30);
    const amcCellsSeen: string[] = [];
    const seen = new Set<string>();
    for (const tbl of tables) {
      for (const row of tbl.rows) {
        for (const cell of row) {
          for (const name of amcTargets) {
            if (
              cell.toLowerCase().includes(name.toLowerCase().slice(0, 12)) &&
              !seen.has(cell)
            ) {
              seen.add(cell);
              amcCellsSeen.push(cell);
            }
          }
        }
      }
    }
    return {
      tables,
      downloadLinks,
      amcCellsSeen,
      bodyText: (document.body.innerText || "").slice(0, 3000),
      url: location.href,
    };
  }, targets);
}

/**
 * Two-strategy parser for the AMFI Fundwise AAUM table.
 *
 * Header-based:
 *   Walk all rows looking for one whose cells contain "Mutual Fund Name"
 *   (or AMC / Fund House) AND "Average AUM" / "AAUM". Use that row's
 *   indices to read AMC name + AAUM from subsequent rows.
 *
 * Row-based fallback:
 *   For each row, scan cells for any of the 4 target AMC names. If found,
 *   sum the numeric cells AFTER the name cell (Sr No is before, so it's
 *   excluded). Numeric threshold > 100 ignores Sr No-style ints.
 *
 * Unit conversion:
 *   AMFI publishes Average AUM in Rs Lakhs ("(Rs in Lakhs)" appears in
 *   the title row). Dashboard convention is ₹ Cr, so divide by 100.
 */
function parseAmcRowsFromTable(table: {
  headers: string[];
  rows: string[][];
}): ParsedAmcRow[] {
  const headerBased = parseHeaderBased(table);
  if (headerBased.length > 0) return headerBased;
  return parseRowBased(table);
}

function parseHeaderBased(table: {
  headers: string[];
  rows: string[][];
}): ParsedAmcRow[] {
  // 1. Initial check on the captured headers (single-row pattern).
  let headerRowIdx = -1;
  let amcIdx = -1;
  let aaumIdx = -1;
  let aaumIdxAlt = -1;

  const tryLocate = (cells: string[]) => {
    const lc = cells.map((h) => h.toLowerCase());
    const a = lc.findIndex((h) =>
      /mutual\s*fund\s*name|fund\s*house|amc|name\s*of\s*the\s*amc/.test(h)
    );
    let b = lc.findIndex((h) =>
      /(grand\s*total|total\s*aaum|total\s*average\s*aum)/.test(h)
    );
    if (b === -1)
      b = lc.findIndex((h) =>
        /aaum|average\s*aum|avg\.?\s*aum/.test(h)
      );
    // Also note any "Fund of Funds - Domestic" sibling column to add.
    const c = lc.findIndex((h) => /fund\s*of\s*funds.*domestic/.test(h));
    return { a, b, c };
  };

  // Try the captured headers first.
  let r = tryLocate(table.headers);
  if (r.a !== -1 && r.b !== -1) {
    amcIdx = r.a;
    aaumIdx = r.b;
    aaumIdxAlt = r.c;
  } else {
    // Walk into the body rows; AMFI's first row is often a title.
    for (let i = 0; i < Math.min(table.rows.length, 6); i++) {
      r = tryLocate(table.rows[i]);
      if (r.a !== -1 && r.b !== -1) {
        headerRowIdx = i;
        amcIdx = r.a;
        aaumIdx = r.b;
        aaumIdxAlt = r.c;
        break;
      }
    }
  }
  if (amcIdx === -1 || aaumIdx === -1) return [];

  const out: ParsedAmcRow[] = [];
  const startIdx = headerRowIdx === -1 ? 0 : headerRowIdx + 1;
  for (let i = startIdx; i < table.rows.length; i++) {
    const row = table.rows[i];
    const name = (row[amcIdx] ?? "").trim();
    if (!name) continue;
    // Positive AMC-name guard. Without this, the parser would accept
    // any non-empty cell with a positive AAUM, which is how 50+
    // garbage rows per quarter (numeric-string footnote cells like
    // "1,379,300.81") landed in the snapshot after PR #72 dropped
    // the implicit curated-map filter. isLikelyAmcName rejects:
    //   - numeric / placeholder cells
    //   - Total / Grand Total / Sub Total / Industry / footnote markers
    //   - any string without a "Mutual Fund / Asset Management / MF /
    //     AMC / Investment Managers" suffix unless it's in the curated
    //     AMFI_NAME_TO_SLUG map.
    if (!isLikelyAmcName(name)) continue;
    const aaumA = parseNumberLoose(row[aaumIdx]);
    if (aaumA === null || aaumA <= 0) continue;
    const aaumB =
      aaumIdxAlt !== -1 ? parseNumberLoose(row[aaumIdxAlt]) ?? 0 : 0;
    // Keep ALL valid AMC rows, not just the dashboard's curated peer
    // list. Auto-derive a slug for unmapped AMCs so they round-trip
    // through the snapshot and surface in /AMCs / peer-universe.
    const id = resolveAmcIdentity(name);
    // Lakhs → Crores. Sum (Excl FoF Domestic) + FoF Domestic if both columns
    // exist so the value reflects total AAUM.
    const totalLakhs = aaumA + aaumB;
    out.push({
      amcSlug: id.slug,
      amcNameAsReported: name,
      mappingStatus: id.mappingStatus,
      displayName: id.displayName,
      avgAum: Math.round((totalLakhs / 100) * 100) / 100, // Cr, 2dp
    });
  }
  return out;
}

function parseRowBased(table: {
  headers: string[];
  rows: string[][];
}): ParsedAmcRow[] {
  const out: ParsedAmcRow[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    // 1. Locate AMC name cell. Same positive-validation rule as
    //    parseColBased — accept the first cell that passes
    //    isLikelyAmcName (curated map, or a string with a
    //    "Mutual Fund / Asset Management / MF / AMC / Investment
    //    Managers" suffix). Numeric / placeholder cells are rejected.
    let nameIdx = -1;
    let nameRaw = "";
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] ?? "").trim();
      if (!cell) continue;
      if (isLikelyAmcName(cell)) {
        nameIdx = i;
        nameRaw = cell;
        break;
      }
    }
    if (nameIdx === -1) continue;

    // 2. Sum numeric cells after the name; threshold filters out Sr No.
    let sumLakhs = 0;
    for (let i = nameIdx + 1; i < row.length; i++) {
      const num = parseNumberLoose(row[i]);
      if (num !== null && num > 100) sumLakhs += num;
    }
    if (sumLakhs <= 0) continue;

    const id = resolveAmcIdentity(nameRaw);
    if (seen.has(id.slug)) continue;
    seen.add(id.slug);

    out.push({
      amcSlug: id.slug,
      amcNameAsReported: nameRaw,
      mappingStatus: id.mappingStatus,
      displayName: id.displayName,
      avgAum: Math.round((sumLakhs / 100) * 100) / 100, // Lakhs → Cr, 2dp
    });
  }
  return out;
}

/** Walks the page DOM + collected XHR log and produces a JSON-safe
 *  snapshot of the form's state at failure time. Called from audit
 *  mode only; the snapshot is written to a sibling
 *  `<slug>-<quarter>-debug.json` next to the audit JSON so the user
 *  can triage AMFI form drift without re-running.
 *
 *  Inputs are deliberately tolerant — when a step fails before some
 *  fields were populated, the corresponding FieldOutcome is
 *  `EMPTY_FIELD` and we just record that. */
async function capturePageDiagnostics(
  page: Page,
  reason: string,
  fieldOutcomes: {
    fData: FieldOutcome;
    fType: FieldOutcome;
    fFy: FieldOutcome;
    fMf: FieldOutcome;
    fPeriod: FieldOutcome;
    goState: GoButtonState;
  },
  xhrCapture: XhrCapture[]
): Promise<AuditDiagnostics> {
  let url: string | undefined;
  try {
    url = page.url();
  } catch {}

  // Walk visible inputs / buttons + grab a body-text snippet via a
  // single page.evaluate so we serialise everything in one round-trip.
  let pageScrape: {
    inputs: { placeholder: string; value: string; disabled: boolean }[];
    buttons: { text: string; disabled: boolean }[];
    bodyTextSnippet: string;
  } = { inputs: [], buttons: [], bodyTextSnippet: "" };
  try {
    pageScrape = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input")).map((i) => {
        const el = i as HTMLInputElement;
        return {
          placeholder: el.placeholder ?? "",
          value: el.value ?? "",
          disabled: !!el.disabled,
        };
      });
      const buttons = Array.from(document.querySelectorAll("button")).map((b) => {
        const el = b as HTMLButtonElement;
        return {
          text: (el.textContent || "").trim().slice(0, 80),
          disabled: !!el.disabled,
        };
      });
      const bodyTextSnippet = (document.body.innerText || "")
        .replace(/\s+/g, " ")
        .slice(0, 1500);
      return { inputs, buttons, bodyTextSnippet };
    });
  } catch {}

  // Truncate long screenshots so the debug JSON stays parseable. PNG
  // base64 of a 1280×720 viewport ≈ 200-400KB; we cap at 600KB.
  let screenshotBase64: string | undefined;
  try {
    const buf = await page.screenshot({ fullPage: false });
    const b64 = buf.toString("base64");
    screenshotBase64 = b64.length > 600_000 ? b64.slice(0, 600_000) : b64;
  } catch {}

  return {
    url,
    reason,
    fields: {
      Data: {
        visible: fieldOutcomes.fData.found,
        value: fieldOutcomes.fData.visibleValue,
        options: fieldOutcomes.fData.options.slice(0, 30),
      },
      Type: {
        visible: fieldOutcomes.fType.found,
        value: fieldOutcomes.fType.visibleValue,
        options: fieldOutcomes.fType.options.slice(0, 30),
      },
      FY: {
        visible: fieldOutcomes.fFy.found,
        value: fieldOutcomes.fFy.visibleValue,
        options: fieldOutcomes.fFy.options.slice(0, 30),
      },
      MF: {
        visible: fieldOutcomes.fMf.found,
        value: fieldOutcomes.fMf.visibleValue,
        options: fieldOutcomes.fMf.options.slice(0, 30),
      },
      Period: {
        visible: fieldOutcomes.fPeriod.found,
        value: fieldOutcomes.fPeriod.visibleValue,
        options: fieldOutcomes.fPeriod.options.slice(0, 30),
      },
    },
    goButton: {
      found: fieldOutcomes.goState.found,
      disabled: fieldOutcomes.goState.disabled,
      ariaDisabled: fieldOutcomes.goState.ariaDisabled,
    },
    visibleInputs: pageScrape.inputs,
    visibleButtons: pageScrape.buttons,
    bodyTextSnippet: pageScrape.bodyTextSnippet,
    xhrSummary: xhrCapture.slice(-30).map((x) => ({
      method: x.method,
      status: x.status,
      url: x.url,
    })),
    screenshotBase64,
  };
}

/** Audit-mode diagnostic dump captured when fetchQuarter fails to
 *  reach the Go-click step (or fails after). Written to a sibling
 *  `<slug>-<quarter>-debug.json` next to the audit JSON so the user
 *  can triage AMFI form drift without re-running. */
export interface AuditDiagnostics {
  url?: string;
  reason: string;
  fields: {
    Data?: { visible: boolean; value: string; options: string[] };
    Type?: { visible: boolean; value: string; options: string[] };
    FY?: { visible: boolean; value: string; options: string[] };
    MF?: { visible: boolean; value: string; options: string[] };
    Period?: { visible: boolean; value: string; options: string[] };
  };
  goButton?: {
    found: boolean;
    disabled: boolean | null;
    ariaDisabled: string | null;
    text?: string;
  };
  visibleInputs?: { placeholder: string; value: string; disabled: boolean }[];
  visibleButtons?: { text: string; disabled: boolean }[];
  bodyTextSnippet?: string;
  xhrSummary?: { method: string; status: number; url: string }[];
  /** Base64 PNG of a viewport screenshot. Truncated to first ~600KB
   *  (post-base64 ≈ 450KB raw) to keep the JSON parseable. */
  screenshotBase64?: string;
}

async function fetchQuarter(
  browser: Browser,
  q: QuarterToFetch,
  opts: {
    auditAmc?: string;
    returnRawTables?: boolean;
    /** When set + audit mode failed, fetchQuarter populates
     *  `diagnosticsOut.current` with a snapshot of page state so the
     *  caller can write a sibling debug JSON. Never populated in
     *  normal full-ingest runs. */
    diagnosticsOut?: { current?: AuditDiagnostics };
  } = {}
): Promise<{
  rows: ParsedAmcRow[];
  sourceUrl: string;
  /** Raw tables captured from the result page. Populated only when
   *  `opts.returnRawTables` is true (audit mode). Each table has
   *  `headers` + `rows` arrays of cell strings. */
  rawTables?: { headers: string[]; rows: string[][] }[];
} | null> {
  // Audit-mode timing overrides. The original 8s / 12s budgets in T
  // are sized for warm sequential ingest runs; the cold single-quarter
  // audit run on a GitHub Actions runner needed roughly 30s for AMFI's
  // post-Fundwise JS to populate the FY / Period dropdowns. Triple the
  // critical waits when an auditAmc is set; normal full-ingest runs
  // continue to use T verbatim so we don't slow down the working path.
  const auditMode = !!opts.auditAmc;
  const tFormReady = auditMode ? 30_000 : T.waitForFormReady;
  const tDependent = auditMode ? 30_000 : T.waitForDependentFields;
  const tLoadingDone = auditMode ? 30_000 : T.waitForLoadingDone;
  const tPostGo = auditMode ? 30_000 : T.postGoNetworkIdle;
  const tPostFundwiseSettle = auditMode ? 2_000 : T.midSleep;

  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const xhrCapture: XhrCapture[] = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!/amfiindia\.com/i.test(url)) return;
    if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(\?|$)/i.test(url)) return;
    const ct = resp.headers()["content-type"] ?? "";
    let preview: string | undefined;
    if (/json|xml|text\/html/i.test(ct)) {
      try {
        const body = await resp.text();
        preview = body.slice(0, 400);
      } catch {}
    }
    xhrCapture.push({
      method: resp.request().method(),
      url,
      status: resp.status(),
      contentType: ct,
      bodyPreview: preview,
    });
  });

  try {
    vinfo(`AAUM[${q.calendarQ}]: opening page ${FORM_URL}`);
    const resp = await page.goto(FORM_URL, {
      waitUntil: "domcontentloaded",
      timeout: T.pageGoto,
    });
    if (!resp || !resp.ok()) {
      warn(`  HTTP ${resp?.status() ?? "no-response"}`);
      return null;
    }
    vinfo(`AAUM[${q.calendarQ}]: page loaded, waiting for form ready`);
    try {
      await page.waitForSelector('input[placeholder="Select Data"]', {
        timeout: tFormReady,
      });
    } catch {
      warn(`AAUM[${q.calendarQ}]: Select Data placeholder never appeared`);
    }
    await sleep(T.midSleep);
    await logVisiblePlaceholders(page, q.calendarQ, "after page load");

    // Step 1: Select Data → Fundwise (gates the rest of the form)
    vinfo(`AAUM[${q.calendarQ}]: setting Select Data → Fundwise`);
    const fData = await setMuiAutocompleteByPlaceholder(page, "Select Data", [
      "Fundwise",
      "Fund wise",
      "Fund-wise",
    ]);
    vinfo(
      `AAUM[${q.calendarQ}]:   Data found=${fData.found} chosen=${fData.chosen ?? "—"} value="${fData.visibleValue}" options=[${fData.options.slice(0, 8).join(" | ")}]`
    );
    if (!fData.visibleValue || !/fund\s*wise/i.test(fData.visibleValue)) {
      warn(`AAUM[${q.calendarQ}]: Fundwise not visible in input — cannot proceed`);
      return null;
    }

    // Wait for dependent fields to render after Fundwise is selected.
    // Audit mode runs cold (one quarter, fresh runner) and AMFI's
    // post-Fundwise JS sometimes takes 15-25s to populate the FY /
    // MF dropdowns; tDependent gives it 30s in audit mode (8s for
    // the warm sequential ingest path).
    vinfo(
      `AAUM[${q.calendarQ}]: waiting up to ${tDependent}ms for dependent fields`
    );
    let dependentReady = false;
    try {
      await page.waitForSelector(
        'input[placeholder="Select Financial Year"], input[placeholder="Select Mutual Fund"]',
        { timeout: tDependent }
      );
      dependentReady = true;
    } catch {
      warn(
        `AAUM[${q.calendarQ}]: dependent fields (FY/MF) did not appear within ${tDependent}ms`
      );
    }
    // Audit mode gives AMFI's post-Fundwise XHR / option-loading code
    // an extra settle window; production stays at midSleep so the
    // 8-quarter ingest doesn't bloat its overall budget.
    await sleep(tPostFundwiseSettle);
    await logVisiblePlaceholders(
      page,
      q.calendarQ,
      `after Fundwise (dependentReady=${dependentReady})`
    );

    // Step 2: Select Type — optional. Don't fail if it isn't present.
    vinfo(`AAUM[${q.calendarQ}]: setting Select Type (optional)`);
    const fType = await setMuiAutocompleteByPlaceholder(page, "Select Type", [
      "AMC-wise",
      "AMC wise",
      "Mutual Fund-wise",
      "Mutual Fund wise",
      "Fund House",
      "Fund House Wise",
      "Average AUM",
    ]);
    if (fType.found) {
      vinfo(
        `AAUM[${q.calendarQ}]:   Type found=true chosen=${fType.chosen ?? "—"} value="${fType.visibleValue}" options=[${fType.options.slice(0, 8).join(" | ")}]`
      );
    } else {
      vinfo(`AAUM[${q.calendarQ}]:   Type not present — skipping`);
    }
    if (fType.found) await sleep(T.midSleep);

    // Step 3: Financial Year FIRST. The previous run showed Period turns
    // into a disabled "Loading..." input the moment FY is set, which means
    // FY triggers the async load that produces Period (and possibly MF)
    // options. We must drive FY before Period.
    vinfo(`AAUM[${q.calendarQ}]: setting Select Financial Year`);
    const fFy = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Financial Year",
      q.fyCandidates
    );
    vinfo(
      `AAUM[${q.calendarQ}]:   FY found=${fFy.found} chosen=${fFy.chosen ?? "—"} value="${fFy.visibleValue}" options=[${fFy.options.slice(0, 8).join(" | ")}]`
    );

    // Wait for the async load (Loading... placeholder) to settle.
    await waitForLoadingDone(
      page,
      q.calendarQ,
      "post-FY",
      tLoadingDone
    );
    await logVisiblePlaceholders(page, q.calendarQ, "post-FY-load");

    // Step 4: Mutual Fund — only if it actually rendered after FY's load.
    // Tolerate absence: if MF isn't visible, the form just doesn't gate
    // Period on MF in this Fundwise mode.
    let fMf = { ...EMPTY_FIELD };
    const mfPresent = await isPlaceholderVisible(page, "Select Mutual Fund");
    if (mfPresent) {
      // Audit mode: select a SPECIFIC AMC (e.g. "HDFC Mutual Fund") so
      // the result table breaks that AMC's AAUM down by scheme
      // category — needed for AMC × Active Equity AAUM. Normal mode
      // selects "All Mutual Funds" so the table returns one row per
      // AMC at industry level. Driven by the optional `opts.auditAmc`.
      const mfCandidates = opts.auditAmc
        ? [opts.auditAmc]
        : ["All Mutual Funds", "Select All", "All"];
      vinfo(
        `AAUM[${q.calendarQ}]: setting Select Mutual Fund (${opts.auditAmc ? `audit=${opts.auditAmc}` : "All Mutual Funds"})`
      );
      fMf = await setMuiAutocompleteByPlaceholder(
        page,
        "Select Mutual Fund",
        mfCandidates
      );
      vinfo(
        `AAUM[${q.calendarQ}]:   MF found=${fMf.found} chosen=${fMf.chosen ?? "—"} value="${fMf.visibleValue}" options=[${fMf.options.slice(0, 8).join(" | ")}]`
      );
      // Debug fallback for normal mode: if no "All" option, pick HDFC
      // so the form still submits and we get *some* rows. Suppressed
      // in audit mode — caller wants the requested AMC or nothing.
      if (
        !opts.auditAmc &&
        fMf.found &&
        !fMf.visibleValue &&
        fMf.options.length > 0
      ) {
        vinfo(
          `AAUM[${q.calendarQ}]:   MF: no "All" option visible — falling back to HDFC Mutual Fund (debug)`
        );
        fMf = await setMuiAutocompleteByPlaceholder(
          page,
          "Select Mutual Fund",
          ["HDFC Mutual Fund"]
        );
        vinfo(
          `AAUM[${q.calendarQ}]:   MF (HDFC fallback) chosen=${fMf.chosen ?? "—"} value="${fMf.visibleValue}"`
        );
      }
      // Wait for the second async load that MF selection may trigger.
      await waitForLoadingDone(
        page,
        q.calendarQ,
        "post-MF",
        tLoadingDone
      );
      await logVisiblePlaceholders(page, q.calendarQ, "post-MF-load");
    } else {
      vinfo(
        `AAUM[${q.calendarQ}]:   MF not present after FY load — proceeding directly to Period`
      );
    }

    // Step 5: Period
    vinfo(`AAUM[${q.calendarQ}]: setting Select Period`);
    const fPeriod = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Period",
      q.periodCandidates
    );
    vinfo(
      `AAUM[${q.calendarQ}]:   Period found=${fPeriod.found} chosen=${fPeriod.chosen ?? "—"} value="${fPeriod.visibleValue}" options=[${fPeriod.options.slice(0, 8).join(" | ")}]`
    );

    // Trust the per-field FieldOutcome values (already verified by reading
    // input.value back inside the helper). The earlier `readVisibleFormValues`
    // helper kept returning empty strings for inputs that logVisiblePlaceholders
    // showed as populated — likely an MUI dual-mount + race quirk we can't
    // reliably work around. The field outcomes match the visible inputs.
    const goState = await readGoButtonState(page);
    vinfo(
      `AAUM[${q.calendarQ}]: pre-Go field outcomes: Data="${fData.visibleValue}" FY="${fFy.visibleValue}" Period="${fPeriod.visibleValue}"   Go: ${JSON.stringify(goState)}`
    );

    const dataOk = /fund\s*wise/i.test(fData.visibleValue);
    const fyOk = (fFy.visibleValue || "").trim().length > 0;
    const periodOk = (fPeriod.visibleValue || "").trim().length > 0;
    const goEnabled =
      goState.found &&
      goState.disabled === false &&
      goState.ariaDisabled !== "true";

    if (!dataOk || !fyOk || !periodOk || !goEnabled) {
      warn(
        `AAUM[${q.calendarQ}]: NOT clicking Go — dataOk=${dataOk} fyOk=${fyOk} periodOk=${periodOk} goEnabled=${goEnabled}`
      );
      warn(
        `AAUM[${q.calendarQ}]:   FY options at fail: [${fFy.options.slice(0, 12).join(" | ")}]`
      );
      warn(
        `AAUM[${q.calendarQ}]:   Period options at fail: [${fPeriod.options.slice(0, 12).join(" | ")}]`
      );
      await logVisiblePlaceholders(page, q.calendarQ, "before-Go (skipped)");
      if (auditMode && opts.diagnosticsOut) {
        opts.diagnosticsOut.current = await capturePageDiagnostics(
          page,
          `pre-Go failure: dataOk=${dataOk} fyOk=${fyOk} periodOk=${periodOk} goEnabled=${goEnabled}`,
          { fData, fType, fFy, fMf, fPeriod, goState },
          xhrCapture
        );
      }
      return null;
    }

    vinfo(`AAUM[${q.calendarQ}]: clicking Go`);
    const goClicked = await clickGoButton(page);
    vinfo(`AAUM[${q.calendarQ}]:   Go clicked=${goClicked}`);
    if (!goClicked) {
      await logVisiblePlaceholders(page, q.calendarQ, "after Go-click failed");
      return null;
    }

    vinfo(`AAUM[${q.calendarQ}]: waiting for results (max ${tPostGo}ms)`);
    try {
      await page.waitForLoadState("networkidle", {
        timeout: tPostGo,
      });
    } catch {}
    await sleep(T.postGoSettle);

    if (DEBUG_ONE_QUARTER) {
      info(`AAUM[${q.calendarQ}]: inspecting results`);
      const recent = xhrCapture.slice(-25);
      info(
        `AAUM[${q.calendarQ}] network capture (${recent.length} of ${xhrCapture.length}):\n${recent
          .map(
            (c) =>
              `    ${c.method.padEnd(4)} ${c.status} ${c.contentType.split(";")[0].padEnd(28)} ${c.url}`
          )
          .join("\n")}`
      );
    }

    const extract = await captureResult(page, TARGET_AMCS);
    if (DEBUG_ONE_QUARTER) {
      info(
        `AAUM[${q.calendarQ}] result: ${extract.tables.length} table(s), AMC cells=${extract.amcCellsSeen.length}, downloads=${extract.downloadLinks.length}, url=${extract.url}`
      );
      extract.tables.forEach((t, i) => {
        info(
          `   table[${i}] rows=${t.rows.length} headers=[${t.headers.slice(0, 8).join(" | ")}]`
        );
      });
      if (extract.downloadLinks.length > 0) {
        info(
          `   download links:\n      ${extract.downloadLinks
            .map((l) => `${l.href}  «${l.text.slice(0, 40)}»`)
            .join("\n      ")}`
        );
      }
    }

    let parsed: ParsedAmcRow[] = [];
    for (let ti = 0; ti < extract.tables.length; ti++) {
      const t = extract.tables[ti];
      if (DEBUG_ONE_QUARTER) {
        const sample = t.rows
          .slice(0, 5)
          .map((r, i) => `      row[${i}]: ${JSON.stringify(r).slice(0, 220)}`)
          .join("\n");
        info(
          `AAUM[${q.calendarQ}]:   table[${ti}] preview (first 5 rows):\n${sample}`
        );
      }
      const rows = parseAmcRowsFromTable(t);
      if (DEBUG_ONE_QUARTER) {
        info(
          `AAUM[${q.calendarQ}]:   table[${ti}] parsed ${rows.length} mapped AMC rows`
        );
        for (const r of rows) {
          info(
            `       ${r.amcSlug.padEnd(8)} ${r.amcNameAsReported}  →  ${r.avgAum.toFixed(2)} Cr (from Lakhs in source)`
          );
        }
      }
      if (rows.length > 0) {
        parsed = rows;
        break;
      }
    }

    if (parsed.length === 0) {
      info(
        `AAUM[${q.calendarQ}]: no AMC rows parsed. Field outcomes:\n` +
          `    Data:   chosen="${fData.chosen ?? "—"}" options=[${fData.options.slice(0, 12).join(" | ")}]\n` +
          `    Type:   chosen="${fType.chosen ?? "—"}" options=[${fType.options.slice(0, 12).join(" | ")}]\n` +
          `    MF:     chosen="${fMf.chosen ?? "—"}" options=[${fMf.options.slice(0, 12).join(" | ")}]\n` +
          `    FY:     chosen="${fFy.chosen ?? "—"}" options=[${fFy.options.slice(0, 12).join(" | ")}]\n` +
          `    Period: chosen="${fPeriod.chosen ?? "—"}" options=[${fPeriod.options.slice(0, 12).join(" | ")}]\n` +
          `    Go: ${goClicked}\n` +
          `    Tables visible: ${extract.tables.length} (rows>1: ${extract.tables.filter((t) => t.rows.length > 1).length})\n` +
          `    Download links: ${extract.downloadLinks.length}\n` +
          `    AMC cells seen: [${extract.amcCellsSeen.slice(0, 6).join(" | ")}]\n` +
          `    URL after Go: ${extract.url}`
      );
      if (auditMode && opts.diagnosticsOut) {
        opts.diagnosticsOut.current = await capturePageDiagnostics(
          page,
          `post-Go: 0 rows parsed (Go clicked=${goClicked}, ${extract.tables.length} table(s) visible)`,
          { fData, fType, fFy, fMf, fPeriod, goState },
          xhrCapture
        );
      }
      return null;
    }

    const slugs = Array.from(new Set(parsed.map((r) => r.amcSlug))).sort();
    info(
      `AAUM[${q.calendarQ}]: ok · FY="${fFy.visibleValue}" period="${fPeriod.visibleValue}" rows=${parsed.length} amcs=${slugs.length} [${slugs.slice(0, 6).join(", ")}${slugs.length > 6 ? ", …" : ""}]`
    );
    return {
      rows: parsed,
      sourceUrl: extract.url,
      ...(opts.returnRawTables ? { rawTables: extract.tables } : {}),
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function ingestAmfiAaum(): Promise<void> {
  // Audit-mode dispatch — when AAUM_AUDIT_AMC is set, run the
  // single-AMC × category audit instead of the full-universe ingest.
  // The audit writes to manual-data/audit/ and never touches the
  // production amc-aaum-quarterly.json snapshot. AUDIT_QUARTER /
  // AUDIT_WRITE are honoured (see ingestAmfiAaumCategoryAudit).
  if (AUDIT_AMC) {
    await ingestAmfiAaumCategoryAudit(AUDIT_AMC, AUDIT_QUARTER, AUDIT_WRITE);
    return;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    warn(`playwright not available: ${(err as Error).message}`);
    return;
  }

  const fetchedAt = nowIso();
  let browser: Browser | null = null;
  let killed = false;
  const killTimer = setTimeout(() => {
    killed = true;
    warn(
      `AAUM: total timeout (${T.totalKill}ms) — force-closing browser. Keeping previous snapshot.`
    );
    if (browser) browser.close().catch(() => {});
  }, T.totalKill);

  try {
    info("=== amfi-aaum ===");
    info(
      `AAUM: starting (debug-one-quarter=${DEBUG_ONE_QUARTER ? "on" : "off"}, total budget=${T.totalKill}ms)`
    );
    browser = await chromium.launch({ headless: true });

    const allQuarters = recentQuartersFY(8);
    const quarters = DEBUG_ONE_QUARTER ? allQuarters.slice(0, 1) : allQuarters;
    info(
      `AAUM: rolling fetch window = ${quarters.length} quarter(s) (${quarters[quarters.length - 1].calendarQ}…${quarters[0].calendarQ})`
    );

    const outRows: AmcAaumQuarterlyRow[] = [];
    const succeededQuarters: string[] = [];
    const failedQuarters: string[] = [];
    for (const q of quarters) {
      if (killed) break;
      info(
        `AAUM: quarter ${q.calendarQ} (FY ${q.fyCandidates[0]}, period ${q.periodCandidates[0]})`
      );
      let outcome: { rows: ParsedAmcRow[]; sourceUrl: string } | null = null;
      try {
        outcome = await fetchQuarter(browser, q);
      } catch (err) {
        warn(`AAUM[${q.calendarQ}]: ${(err as Error).message}`);
      }
      if (!outcome || outcome.rows.length === 0) {
        failedQuarters.push(q.calendarQ);
        continue;
      }
      let added = 0;
      for (const r of outcome.rows) {
        if (!Number.isFinite(r.avgAum) || r.avgAum <= 0) continue;
        if (!r.amcSlug) continue;
        // Persist mappingStatus + displayName so consumers don't have
        // to reconstruct them. PR #72 added these on ParsedAmcRow but
        // the original write step here dropped them on the way out,
        // making every row default to mappingStatus="mapped" once
        // the snapshot was loaded back. That's now fixed.
        outRows.push({
          amcSlug: r.amcSlug,
          amcNameAsReported: r.amcNameAsReported,
          mappingStatus: r.mappingStatus,
          displayName: r.displayName,
          quarter: q.calendarQ,
          avgAum: r.avgAum,
          source: outcome.sourceUrl,
          fetchedAt,
          status: "ok",
        });
        added += 1;
      }
      if (added > 0) succeededQuarters.push(q.calendarQ);
      else failedQuarters.push(q.calendarQ);
    }

    // Merge into prior snapshot — quarters that failed this run keep their
    // historical rows; refetched (slug, quarter) pairs are replaced in place.
    const prior =
      (await readSnapshot<AmcAaumQuarterlySnapshot>(
        "amc-aaum-quarterly.json"
      ))?.rows ?? [];

    if (outRows.length === 0) {
      warn(
        "AAUM: no rows extracted — keeping previous snapshot. See diagnostics above."
      );
      return;
    }

    const { rows: merged, stats } = mergeBySlugQuarter(prior, outRows);
    const fetchedQuarters = Array.from(
      new Set(outRows.map((r) => r.quarter))
    ).sort();
    const allQuartersOut = Array.from(
      new Set(merged.map((r) => r.quarter))
    ).sort();
    const allSlugs = Array.from(new Set(merged.map((r) => r.amcSlug)));
    info(
      `AAUM: quarters fetched=${succeededQuarters.length} failed=[${failedQuarters.join(", ")}]`
    );
    info(
      `AAUM: this run ${outRows.length} rows across ${fetchedQuarters.length} quarter(s) (${fetchedQuarters[0]}…${fetchedQuarters[fetchedQuarters.length - 1]})`
    );
    info(
      `AAUM: merge — added=${stats.added} updated=${stats.updated} preserved=${stats.preserved} total=${stats.total}`
    );
    info(
      `AAUM: snapshot range ${allQuartersOut[0]}…${allQuartersOut[allQuartersOut.length - 1]} · ${allSlugs.length} AMCs`
    );

    const snapshot: AmcAaumQuarterlySnapshot = {
      meta: {
        generatedAt: fetchedAt,
        source: FORM_URL,
        notes: [
          "Per-AMC quarterly MF QAAUM (mutual-fund-only Average AUM) extracted via the AMFI Average AUM disclosure form (MUI Autocomplete UI). MF-only by construction — AMFI does not publish PMS / AIF / offshore / advisory / alternates here.",
          "unitOriginal=Rs Lakhs · unitStored=Rs Crore · conversion=lakhs_to_crore_divide_by_100.",
          "Backend endpoint discovered: /api/average-aum-fundwise?fyId=N&periodId=N (not yet used directly).",
          "Per-row provenance: source URL + fetchedAt.",
          `lastSuccessfulFetchAt=${fetchedAt} · fetchWindow=${quarters.length} · quartersThisRun=[${succeededQuarters.join(", ")}] · failedThisRun=[${failedQuarters.join(", ")}].`,
          `quartersCovered=${allQuartersOut.length} (${allQuartersOut[0]}…${allQuartersOut[allQuartersOut.length - 1]}) · rowCount=${stats.total}.`,
        ].join(" "),
      },
      rows: merged,
    };
    await writeSnapshot("amc-aaum-quarterly.json", snapshot);
    info("AAUM: wrote amc-aaum-quarterly.json");
  } catch (err) {
    warn(`AAUM: aborted — ${(err as Error).message}`);
  } finally {
    clearTimeout(killTimer);
    if (browser && !killed) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

// =====================================================================
// Audit mode: AMC × category AAUM
// =====================================================================
//
// Entry point: invoke `ingestAmfiAaum` with the env vars
//   AAUM_AUDIT_AMC="HDFC Mutual Fund"
//   AAUM_AUDIT_QUARTER="2026-Q1"   (optional, default = latest available)
//   AAUM_AUDIT_WRITE="1"           (optional, set to skip the file write)
// or call `ingestAmfiAaumCategoryAudit(amcName, quarterId, writeFile)`
// directly.
//
// Drives the AMFI Fundwise form with `Select Mutual Fund=<amcName>`
// (instead of "All Mutual Funds") for ONE quarter; the result table
// then contains one row per AMFI category (Multi Cap Fund, Large Cap
// Fund, …) instead of one row per AMC. We match each row to the
// existing `AmfiMonthlyCategorySlug` enum, sum the IIFL active-equity
// envelope, and write a JSON dump to `manual-data/audit/`.
//
// This is AUDIT-ONLY:
//   - no production snapshot write
//   - no dashboard wiring
//   - safe to commit the audit JSON as a verification artifact

import fs from "node:fs/promises";
import path from "node:path";

const AUDIT_AMC = process.env.AAUM_AUDIT_AMC;
const AUDIT_QUARTER = process.env.AAUM_AUDIT_QUARTER;
const AUDIT_WRITE = process.env.AAUM_AUDIT_WRITE !== "0";

/** Major-category bucket — mirrors `AmfiMonthlyMajorCategorySlug`
 *  from the schema. Inlined here so the audit script doesn't need
 *  to touch the (locked-down) PDF extractor module exports. */
type AuditMajorCategorySlug =
  | "income-debt"
  | "growth-equity"
  | "hybrid"
  | "solution"
  | "other-schemes";

const AUDIT_MAJOR_CATEGORY_LABELS: Record<AuditMajorCategorySlug, string> = {
  "income-debt": "Income/Debt Oriented Schemes",
  "growth-equity": "Growth/Equity Oriented Schemes",
  hybrid: "Hybrid Schemes",
  solution: "Solution Oriented Schemes",
  "other-schemes": "Other Schemes",
};

/** Same closed set of (slug, label, regex) entries the AMFI monthly /
 *  quarterly PDF extractors use. Inlined here because the user spec
 *  forbids touching the PDF extractors to add an export — the small
 *  duplication is intentional, audit-scoped, and matches the
 *  AmfiMonthlyCategorySlug enum exactly. */
const AUDIT_CATEGORY_SPECS: {
  slug: string;
  label: string;
  majorCategorySlug: AuditMajorCategorySlug;
  re: RegExp;
}[] = [
  // Sub I — Income/Debt Oriented (16 rows). Negative lookbehinds
  // disambiguate near-substring matches (Short Duration vs Ultra
  // Short Duration, Long Duration vs Medium to Long Duration, Gilt
  // Fund vs Gilt Fund with 10 year constant duration).
  { slug: "overnight", label: "Overnight Fund", majorCategorySlug: "income-debt", re: /\bOvernight\s+Fund\b/i },
  { slug: "liquid", label: "Liquid Fund", majorCategorySlug: "income-debt", re: /\bLiquid\s+Fund\b/i },
  { slug: "ultra-short-duration", label: "Ultra Short Duration Fund", majorCategorySlug: "income-debt", re: /\bUltra\s+Short\s+Duration\s+Fund\b/i },
  { slug: "low-duration", label: "Low Duration Fund", majorCategorySlug: "income-debt", re: /\bLow\s+Duration\s+Fund\b/i },
  { slug: "money-market", label: "Money Market Fund", majorCategorySlug: "income-debt", re: /\bMoney\s+Market\s+Fund\b/i },
  { slug: "short-duration", label: "Short Duration Fund", majorCategorySlug: "income-debt", re: /(?<!Ultra\s)\bShort\s+Duration\s+Fund\b/i },
  { slug: "medium-duration", label: "Medium Duration Fund", majorCategorySlug: "income-debt", re: /\bMedium\s+Duration\s+Fund\b/i },
  { slug: "medium-to-long-duration", label: "Medium to Long Duration Fund", majorCategorySlug: "income-debt", re: /\bMedium\s+to\s+Long\s+Duration\s+Fund\b/i },
  { slug: "long-duration", label: "Long Duration Fund", majorCategorySlug: "income-debt", re: /(?<!to\s)\bLong\s+Duration\s+Fund\b/i },
  { slug: "dynamic-bond", label: "Dynamic Bond Fund", majorCategorySlug: "income-debt", re: /\bDynamic\s+Bond\s+Fund\b/i },
  { slug: "corporate-bond", label: "Corporate Bond Fund", majorCategorySlug: "income-debt", re: /\bCorporate\s+Bond\s+Fund\b/i },
  { slug: "credit-risk", label: "Credit Risk Fund", majorCategorySlug: "income-debt", re: /\bCredit\s+Risk\s+Fund\b/i },
  { slug: "banking-psu", label: "Banking and PSU Fund", majorCategorySlug: "income-debt", re: /\bBanking\s+and\s+PSU\s+Fund\b/i },
  { slug: "gilt", label: "Gilt Fund", majorCategorySlug: "income-debt", re: /\bGilt\s+Fund\b(?!\s+with)/i },
  { slug: "gilt-10y-constant", label: "Gilt Fund with 10 year constant duration", majorCategorySlug: "income-debt", re: /\bGilt\s+Fund\s+with\s+10\s+year\s+constant\s+duration\b/i },
  { slug: "floater", label: "Floater Fund", majorCategorySlug: "income-debt", re: /\bFloater\s+Fund\b/i },
  // Sub II — Growth/Equity Oriented (11 rows).
  { slug: "multi-cap", label: "Multi Cap Fund", majorCategorySlug: "growth-equity", re: /\bMulti\s+Cap\s+Fund\b/i },
  { slug: "large-cap", label: "Large Cap Fund", majorCategorySlug: "growth-equity", re: /\bLarge\s+Cap\s+Fund\b/i },
  { slug: "large-mid-cap", label: "Large & Mid Cap Fund", majorCategorySlug: "growth-equity", re: /\bLarge\s*&\s*Mid\s+Cap\s+Fund\b/i },
  { slug: "mid-cap", label: "Mid Cap Fund", majorCategorySlug: "growth-equity", re: /(?<!&\s)\bMid\s+Cap\s+Fund\b/i },
  { slug: "small-cap", label: "Small Cap Fund", majorCategorySlug: "growth-equity", re: /\bSmall\s+Cap\s+Fund\b/i },
  { slug: "dividend-yield", label: "Dividend Yield Fund", majorCategorySlug: "growth-equity", re: /\bDividend\s+Yield\s+Fund\b/i },
  { slug: "value-contra", label: "Value Fund/Contra Fund", majorCategorySlug: "growth-equity", re: /\bValue\s+Fund\s*\/\s*Contra\s+Fund\b/i },
  { slug: "focused", label: "Focused Fund", majorCategorySlug: "growth-equity", re: /\bFocused\s+Fund\b/i },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds", majorCategorySlug: "growth-equity", re: /\bSectoral\s*[/\-]\s*Thematic\s+Funds?\b/i },
  { slug: "elss", label: "ELSS", majorCategorySlug: "growth-equity", re: /\bELSS\b/i },
  { slug: "flexi-cap", label: "Flexi Cap Fund", majorCategorySlug: "growth-equity", re: /\bFlexi\s+Cap\s+Fund\b/i },
  // Sub III — Hybrid (6 rows).
  { slug: "conservative-hybrid", label: "Conservative Hybrid Fund", majorCategorySlug: "hybrid", re: /\bConservative\s+Hybrid\s+Fund\b/i },
  { slug: "balanced-aggressive-hybrid", label: "Balanced Hybrid Fund/Aggressive Hybrid Fund", majorCategorySlug: "hybrid", re: /\bBalanced\s+Hybrid\s+Fund\s*\/\s*Aggressive\s+Hybrid\s+Fund\b/i },
  { slug: "baf-daa", label: "Dynamic Asset Allocation/Balanced Advantage Fund", majorCategorySlug: "hybrid", re: /\bDynamic\s+Asset\s+Allocation\s*\/\s*Balanced\s+Advantage\s+Fund\b/i },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund", majorCategorySlug: "hybrid", re: /\bMulti[\s-]+Asset[\s-]+Allocation\s+Fund\b/i },
  { slug: "arbitrage", label: "Arbitrage Fund", majorCategorySlug: "hybrid", re: /\bArbitrage\s+Fund\b/i },
  { slug: "equity-savings", label: "Equity Savings Fund", majorCategorySlug: "hybrid", re: /\bEquity\s+Savings\s+Fund\b/i },
  // Sub IV — Solution Oriented (2 rows).
  { slug: "retirement", label: "Retirement Fund", majorCategorySlug: "solution", re: /\bRetirement\s+Fund\b/i },
  { slug: "childrens", label: "Childrens Fund", majorCategorySlug: "solution", re: /\bChildren'?s\s+Fund\b/i },
  // Sub V — Other Schemes (4 rows).
  { slug: "index-funds", label: "Index Funds", majorCategorySlug: "other-schemes", re: /\bIndex\s+Funds?\b/i },
  { slug: "gold-etf", label: "GOLD ETF", majorCategorySlug: "other-schemes", re: /\bGOLD\s+ETF\b/i },
  { slug: "other-etfs", label: "Other ETFs", majorCategorySlug: "other-schemes", re: /\bOther\s+ETFs?\b/i },
  { slug: "fof-overseas", label: "Fund of funds investing overseas", majorCategorySlug: "other-schemes", re: /\bFund\s+of\s+funds\s+investing\s+overseas\b/i },
];

/** IIFL active-equity envelope category slugs — Sub II + Sub III ex-
 *  Arbitrage + Sub IV. 18 categories. Same definition the IIFL
 *  Figure 19 cards use. */
const AUDIT_ACTIVE_EQUITY_INCLUDE = new Set([
  // Sub II — Growth/Equity (all 11)
  "multi-cap", "large-cap", "large-mid-cap", "mid-cap", "small-cap",
  "dividend-yield", "value-contra", "focused", "sectoral-thematic",
  "elss", "flexi-cap",
  // Sub III — Hybrid EX-ARBITRAGE (5)
  "conservative-hybrid", "balanced-aggressive-hybrid",
  "baf-daa", "multi-asset", "equity-savings",
  // Sub IV — Solution (both)
  "retirement", "childrens",
]);

/** Calendar quarter "YYYY-Qn" → fiscal display label, mirrors the
 *  helper in src/data/amc-peer-universe.ts. */
function fiscalLabelFromCalendarQuarterAudit(quarter: string): string {
  const [yStr, qStr] = quarter.split("-");
  const y = Number(yStr);
  if (!Number.isFinite(y) || !qStr) return quarter;
  let fyYear: number;
  let fyQ: number;
  switch (qStr) {
    case "Q1": fyYear = y; fyQ = 4; break;
    case "Q2": fyYear = y + 1; fyQ = 1; break;
    case "Q3": fyYear = y + 1; fyQ = 2; break;
    case "Q4": fyYear = y + 1; fyQ = 3; break;
    default: return quarter;
  }
  return `${fyQ}QFY${String(fyYear).slice(-2)}`;
}

interface AuditParsedRow {
  categoryLabel: string;
  categorySlug: string;
  majorCategorySlug: AuditMajorCategorySlug;
  majorCategoryLabel: string;
  avgAum: number;
  rawValues: (number | null)[];
}

interface AuditOutput {
  source: "AMFI Fundwise AAUM disclosure";
  sourceUrl: string;
  auditAmc: string;
  quarter: string;
  quarterLabel: string;
  fetchedAt: string;
  rawHeaders: string[];
  rawRowsSample: string[][];
  parsedRows: AuditParsedRow[];
  subtotals: {
    debt: number | null;
    growthEquity: number | null;
    hybrid: number | null;
    solution: number | null;
    otherSchemes: number | null;
    grandTotal: number | null;
  };
  activeEquityAaum: number | null;
  status: "ok" | "failed";
  notes: string[];
}

/** Walk every cell of every captured table; for each non-empty row,
 *  match its first text-like cell against AUDIT_CATEGORY_SPECS and,
 *  if matched, extract the largest numeric value as the category's
 *  AAUM (in lakhs). Returns the full set of parsed category rows
 *  (one per slug; first match wins) plus the captured subtotals
 *  (Sub Total - I/II/III/IV/V + Grand Total). */
function parseCategoryRowsFromTables(
  tables: { headers: string[]; rows: string[][] }[]
): {
  parsedRows: AuditParsedRow[];
  subtotals: AuditOutput["subtotals"];
  rawHeaders: string[];
  rawRowsSample: string[][];
  notes: string[];
} {
  const notes: string[] = [];
  const parsedRows: AuditParsedRow[] = [];
  const seen = new Set<string>();
  const subtotals: AuditOutput["subtotals"] = {
    debt: null,
    growthEquity: null,
    hybrid: null,
    solution: null,
    otherSchemes: null,
    grandTotal: null,
  };

  // Pick the table with the most rows — usually the result table.
  // The header row of that table is captured for the audit JSON so
  // the user can confirm column ordering matches expectations.
  const table = tables.reduce<{
    headers: string[];
    rows: string[][];
  } | null>((best, t) => {
    if (!best || t.rows.length > best.rows.length) return t;
    return best;
  }, null);
  if (!table || table.rows.length === 0) {
    notes.push("No result table captured.");
    return { parsedRows, subtotals, rawHeaders: [], rawRowsSample: [], notes };
  }
  const rawHeaders = table.headers ?? [];
  const rawRowsSample = table.rows.slice(0, 12);

  // Helper: extract the LARGEST positive numeric token from a row's
  // cells (in lakhs). Many AMFI table layouts have multiple AAUM
  // columns (Excl FoF Domestic + FoF Domestic + a Total); the
  // "Total AAUM" column is consistently the largest.
  const extractAaumLakhs = (row: string[]): { aaum: number | null; rawValues: (number | null)[] } => {
    const rawValues = row.map((c) => parseNumberLoose(c));
    const positives = rawValues.filter(
      (v): v is number => typeof v === "number" && v > 0
    );
    if (positives.length === 0) return { aaum: null, rawValues };
    return { aaum: Math.max(...positives), rawValues };
  };

  for (const row of table.rows) {
    if (row.every((c) => !c || !c.trim())) continue;
    const text = row.join(" ").trim();

    // Subtotal / grand-total rows. These are checked FIRST because the
    // category regex set might also partially match the subtotal label
    // (e.g. "Sub Total - I" doesn't trip any category, but defensive).
    const isSubtotal = /^\s*Sub\s*Total\s*-\s*[IV]+\b/i.test(text);
    const isGrandTotal = /^\s*Grand\s*Total\b/i.test(text);
    if (isSubtotal || isGrandTotal) {
      const { aaum: rowAaum } = extractAaumLakhs(row);
      if (rowAaum === null) continue;
      const aaumCr = Math.round((rowAaum / 100) * 100) / 100;
      if (isGrandTotal) {
        subtotals.grandTotal = aaumCr;
      } else if (/Sub\s*Total\s*-\s*I\b(?!\s*[IV])/i.test(text)) {
        subtotals.debt = aaumCr;
      } else if (/Sub\s*Total\s*-\s*II\b(?!\s*[IV])/i.test(text)) {
        subtotals.growthEquity = aaumCr;
      } else if (/Sub\s*Total\s*-\s*III\b/i.test(text)) {
        subtotals.hybrid = aaumCr;
      } else if (/Sub\s*Total\s*-\s*IV\b/i.test(text)) {
        subtotals.solution = aaumCr;
      } else if (/Sub\s*Total\s*-\s*V\b/i.test(text)) {
        subtotals.otherSchemes = aaumCr;
      }
      continue;
    }

    // Category match — scan all specs, take the FIRST match per row
    // and the FIRST row per slug (so close-ended duplicate rows like
    // "ELSS" under Sub B-II don't overwrite the open-ended Sub II
    // value when both appear in the same table).
    for (const spec of AUDIT_CATEGORY_SPECS) {
      if (!spec.re.test(text)) continue;
      if (seen.has(spec.slug)) break; // already captured
      const { aaum: rowAaum, rawValues } = extractAaumLakhs(row);
      if (rowAaum === null) {
        notes.push(`No AAUM column matched for row "${spec.label}".`);
        break;
      }
      parsedRows.push({
        categoryLabel: spec.label,
        categorySlug: spec.slug,
        majorCategorySlug: spec.majorCategorySlug,
        majorCategoryLabel: AUDIT_MAJOR_CATEGORY_LABELS[spec.majorCategorySlug],
        avgAum: Math.round((rowAaum / 100) * 100) / 100, // Lakhs → Cr, 2dp
        rawValues,
      });
      seen.add(spec.slug);
      break;
    }
  }

  return { parsedRows, subtotals, rawHeaders, rawRowsSample, notes };
}

/** Resolve which calendar quarter the audit should target. If the
 *  caller supplied AAUM_AUDIT_QUARTER, use that. Otherwise pick the
 *  most recent quarter from the existing snapshot — that's "latest
 *  available" without needing a fresh fetch. */
function resolveAuditQuarter(quarterId: string | undefined): QuarterToFetch {
  // recentQuartersFY(8) returns the 8 most recent fiscal quarters in
  // descending chronological order (newest first). Default to the
  // first entry; otherwise pick the matching calendarQ.
  const candidates = recentQuartersFY(8);
  if (!quarterId) return candidates[0];
  const m = candidates.find((q) => q.calendarQ === quarterId);
  if (m) return m;
  warn(
    `AAUM-AUDIT: requested quarter "${quarterId}" not in the recent 8-quarter window — falling back to latest (${candidates[0].calendarQ}).`
  );
  return candidates[0];
}

/** Slug used in the audit output filename. Re-uses the curated map +
 *  slugifyAmfiName so e.g. "HDFC Mutual Fund" → "hdfc". */
function auditFilenameSlug(amcName: string): string {
  const curated = amfiNameToSlug(amcName);
  if (curated) return curated;
  const auto = slugifyAmfiName(amcName);
  return auto || amcName.toLowerCase().replace(/\s+/g, "-");
}

/** Top-level audit entry. Drives the AMFI form for one (amcName,
 *  quarter), parses category rows + subtotals, computes the IIFL
 *  active-equity AAUM, writes a JSON dump under
 *  manual-data/audit/. */
export async function ingestAmfiAaumCategoryAudit(
  amcName: string,
  quarterIdOpt?: string,
  writeFile = true
): Promise<AuditOutput | null> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    warn(`AAUM-AUDIT: playwright not available: ${(err as Error).message}`);
    return null;
  }

  const fetchedAt = nowIso();
  const q = resolveAuditQuarter(quarterIdOpt);
  const quarterLabel = fiscalLabelFromCalendarQuarterAudit(q.calendarQ);

  info("=== amfi-aaum-audit ===");
  info(
    `AAUM-AUDIT: amc="${amcName}", quarter=${q.calendarQ} (${quarterLabel}), write=${writeFile}`
  );

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    // Audit-mode diagnostics carrier — fetchQuarter populates
    // `current` with a snapshot of page state if it bails out before
    // the Go-click step (or after with zero rows). We then write a
    // sibling debug JSON next to the audit JSON so the user can
    // triage AMFI form drift without re-running.
    const diagnosticsOut: { current?: AuditDiagnostics } = {};
    const outcome = await fetchQuarter(browser, q, {
      auditAmc: amcName,
      returnRawTables: true,
      diagnosticsOut,
    });
    if (!outcome) {
      warn(`AAUM-AUDIT: form submission failed for ${amcName} ${q.calendarQ}`);
      const failed: AuditOutput = {
        source: "AMFI Fundwise AAUM disclosure",
        sourceUrl: FORM_URL,
        auditAmc: amcName,
        quarter: q.calendarQ,
        quarterLabel,
        fetchedAt,
        rawHeaders: [],
        rawRowsSample: [],
        parsedRows: [],
        subtotals: {
          debt: null,
          growthEquity: null,
          hybrid: null,
          solution: null,
          otherSchemes: null,
          grandTotal: null,
        },
        activeEquityAaum: null,
        status: "failed",
        notes: [
          "Form submission returned null — see ingest log for details.",
          ...(diagnosticsOut.current
            ? [
                `Diagnostics captured: ${diagnosticsOut.current.reason}`,
                `Debug JSON: manual-data/audit/amfi-aaum-category-${auditFilenameSlug(amcName)}-${q.calendarQ.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-debug.json`,
              ]
            : ["No diagnostics captured (failure preceded form load)."]),
        ],
      };
      if (writeFile) {
        await writeAuditFile(failed);
        if (diagnosticsOut.current) {
          await writeAuditDebugFile(amcName, q.calendarQ, diagnosticsOut.current);
        }
      }
      return failed;
    }

    const tables = outcome.rawTables ?? [];
    const { parsedRows, subtotals, rawHeaders, rawRowsSample, notes } =
      parseCategoryRowsFromTables(tables);

    // Active-equity AAUM = sum of categoryAaum across the IIFL
    // 18-slug envelope. Computed only when at least one envelope
    // category matched; otherwise null.
    const aeRows = parsedRows.filter((r) =>
      AUDIT_ACTIVE_EQUITY_INCLUDE.has(r.categorySlug)
    );
    const activeEquityAaum =
      aeRows.length > 0
        ? Math.round(aeRows.reduce((s, r) => s + r.avgAum, 0) * 100) / 100
        : null;

    // Identify missing envelope categories so the user can spot any
    // AMC that doesn't run a particular fund (versus a parsing miss).
    const expectedEnvelope = Array.from(AUDIT_ACTIVE_EQUITY_INCLUDE);
    const present = new Set(parsedRows.map((r) => r.categorySlug));
    const missing = expectedEnvelope.filter((s) => !present.has(s));
    if (missing.length > 0) {
      notes.push(
        `Missing active-equity envelope categories (AMC may not run them): ${missing.join(", ")}`
      );
    }

    // Reconciliation diagnostic.
    if (subtotals.grandTotal !== null) {
      const sumParsed =
        Math.round(parsedRows.reduce((s, r) => s + r.avgAum, 0) * 100) / 100;
      const diff = Math.round((subtotals.grandTotal - sumParsed) * 100) / 100;
      notes.push(
        `Reconciliation: parsedSum=₹${sumParsed.toLocaleString("en-IN")} Cr · grandTotal=₹${subtotals.grandTotal.toLocaleString("en-IN")} Cr · diff=₹${diff.toLocaleString("en-IN")} Cr`
      );
    }

    info(
      `AAUM-AUDIT: parsed ${parsedRows.length} category row(s); activeEquityAaum=${activeEquityAaum !== null ? "₹" + activeEquityAaum.toLocaleString("en-IN") + " Cr" : "n/a"}`
    );

    const out: AuditOutput = {
      source: "AMFI Fundwise AAUM disclosure",
      sourceUrl: outcome.sourceUrl,
      auditAmc: amcName,
      quarter: q.calendarQ,
      quarterLabel,
      fetchedAt,
      rawHeaders,
      rawRowsSample,
      parsedRows,
      subtotals,
      activeEquityAaum,
      status: parsedRows.length > 0 ? "ok" : "failed",
      notes,
    };
    if (writeFile) await writeAuditFile(out);
    return out;
  } catch (err) {
    warn(`AAUM-AUDIT: ${(err as Error).message}`);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

async function writeAuditFile(out: AuditOutput): Promise<void> {
  const dir = path.resolve(process.cwd(), "manual-data/audit");
  await fs.mkdir(dir, { recursive: true });
  const slug = auditFilenameSlug(out.auditAmc);
  const qLc = out.quarter.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const file = path.join(dir, `amfi-aaum-category-${slug}-${qLc}.json`);
  await fs.writeFile(file, JSON.stringify(out, null, 2) + "\n", "utf8");
  info(`AAUM-AUDIT: wrote ${file}`);
}

/** Sibling debug JSON that captures the page state when the audit
 *  failed before reaching Go-click (or after with zero rows). Lets
 *  the user triage AMFI form drift without re-running. The file is
 *  written next to the audit JSON with the same slug + quarter
 *  prefix and a `-debug.json` suffix. */
async function writeAuditDebugFile(
  amcName: string,
  quarterCal: string,
  diag: AuditDiagnostics
): Promise<void> {
  const dir = path.resolve(process.cwd(), "manual-data/audit");
  await fs.mkdir(dir, { recursive: true });
  const slug = auditFilenameSlug(amcName);
  const qLc = quarterCal.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const file = path.join(
    dir,
    `amfi-aaum-category-${slug}-${qLc}-debug.json`
  );
  await fs.writeFile(file, JSON.stringify(diag, null, 2) + "\n", "utf8");
  info(`AAUM-AUDIT: wrote debug ${file}`);
}

// ---- Self-invocation when AAUM_AUDIT_AMC env var is set -------------
//
// AUDIT_AMC / AUDIT_QUARTER / AUDIT_WRITE are read from process.env
// at module load. The early-return branch added at the top of
// `ingestAmfiAaum` short-circuits the normal full-universe ingest
// and dispatches to `ingestAmfiAaumCategoryAudit` instead. Both the
// orchestrated `npm run ingest` and the dedicated
// `npm run audit:amfi-aaum-category` script honour the same env
// vars; the dedicated script is preferred so the intent is visible
// at the command line.
