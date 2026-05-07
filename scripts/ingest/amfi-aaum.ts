import {
  info,
  mergeBySlugQuarter,
  nowIso,
  parseNumberLoose,
  readSnapshot,
  warn,
  writeSnapshot,
} from "./utils";
import { amfiNameToSlug } from "../../src/data/amcs";
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
    if (/^(total|grand|sub|industry|note|\*|s\.?\s*no)/i.test(name)) continue;
    const aaumA = parseNumberLoose(row[aaumIdx]);
    if (aaumA === null || aaumA <= 0) continue;
    const aaumB =
      aaumIdxAlt !== -1 ? parseNumberLoose(row[aaumIdxAlt]) ?? 0 : 0;
    const slug = amfiNameToSlug(name);
    if (!slug) continue;
    // Lakhs → Crores. Sum (Excl FoF Domestic) + FoF Domestic if both columns
    // exist so the value reflects total AAUM.
    const totalLakhs = aaumA + aaumB;
    out.push({
      amcSlug: slug,
      amcNameAsReported: name,
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
  const targetLc = TARGET_AMCS.map((n) => n.toLowerCase());

  for (const row of table.rows) {
    // 1. Locate AMC name cell.
    let nameIdx = -1;
    let nameRaw = "";
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] ?? "").trim();
      if (!cell) continue;
      const slug = amfiNameToSlug(cell);
      if (slug) {
        nameIdx = i;
        nameRaw = cell;
        break;
      }
      // Looser match: target name is contained in cell text.
      const lc = cell.toLowerCase();
      const matched = targetLc.find((n) => lc.includes(n));
      if (matched) {
        nameIdx = i;
        nameRaw = TARGET_AMCS[targetLc.indexOf(matched)];
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

    const slug = amfiNameToSlug(nameRaw);
    if (!slug) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);

    out.push({
      amcSlug: slug,
      amcNameAsReported: nameRaw,
      avgAum: Math.round((sumLakhs / 100) * 100) / 100, // Lakhs → Cr, 2dp
    });
  }
  return out;
}

async function fetchQuarter(
  browser: Browser,
  q: QuarterToFetch
): Promise<{ rows: ParsedAmcRow[]; sourceUrl: string } | null> {
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
        timeout: T.waitForFormReady,
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
    vinfo(
      `AAUM[${q.calendarQ}]: waiting up to ${T.waitForDependentFields}ms for dependent fields`
    );
    let dependentReady = false;
    try {
      await page.waitForSelector(
        'input[placeholder="Select Financial Year"], input[placeholder="Select Mutual Fund"]',
        { timeout: T.waitForDependentFields }
      );
      dependentReady = true;
    } catch {
      warn(
        `AAUM[${q.calendarQ}]: dependent fields (FY/MF) did not appear within ${T.waitForDependentFields}ms`
      );
    }
    await sleep(T.midSleep);
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
      T.waitForLoadingDone
    );
    await logVisiblePlaceholders(page, q.calendarQ, "post-FY-load");

    // Step 4: Mutual Fund — only if it actually rendered after FY's load.
    // Tolerate absence: if MF isn't visible, the form just doesn't gate
    // Period on MF in this Fundwise mode.
    let fMf = { ...EMPTY_FIELD };
    const mfPresent = await isPlaceholderVisible(page, "Select Mutual Fund");
    if (mfPresent) {
      vinfo(`AAUM[${q.calendarQ}]: setting Select Mutual Fund`);
      fMf = await setMuiAutocompleteByPlaceholder(
        page,
        "Select Mutual Fund",
        ["All Mutual Funds", "Select All", "All"]
      );
      vinfo(
        `AAUM[${q.calendarQ}]:   MF found=${fMf.found} chosen=${fMf.chosen ?? "—"} value="${fMf.visibleValue}" options=[${fMf.options.slice(0, 8).join(" | ")}]`
      );
      // Debug fallback: if no "All" option, pick HDFC.
      if (fMf.found && !fMf.visibleValue && fMf.options.length > 0) {
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
        T.waitForLoadingDone
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
      return null;
    }

    vinfo(`AAUM[${q.calendarQ}]: clicking Go`);
    const goClicked = await clickGoButton(page);
    vinfo(`AAUM[${q.calendarQ}]:   Go clicked=${goClicked}`);
    if (!goClicked) {
      await logVisiblePlaceholders(page, q.calendarQ, "after Go-click failed");
      return null;
    }

    vinfo(`AAUM[${q.calendarQ}]: waiting for results (max ${T.postGoNetworkIdle}ms)`);
    try {
      await page.waitForLoadState("networkidle", {
        timeout: T.postGoNetworkIdle,
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
      return null;
    }

    const slugs = Array.from(new Set(parsed.map((r) => r.amcSlug))).sort();
    info(
      `AAUM[${q.calendarQ}]: ok · FY="${fFy.visibleValue}" period="${fPeriod.visibleValue}" rows=${parsed.length} amcs=${slugs.length} [${slugs.slice(0, 6).join(", ")}${slugs.length > 6 ? ", …" : ""}]`
    );
    return { rows: parsed, sourceUrl: extract.url };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function ingestAmfiAaum(): Promise<void> {
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
        outRows.push({
          amcSlug: r.amcSlug,
          amcNameAsReported: r.amcNameAsReported,
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
