import {
  info,
  nowIso,
  parseNumberLoose,
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
const TARGET_AMCS = [
  "HDFC Mutual Fund",
  "Nippon India Mutual Fund",
  "Aditya Birla Sun Life Mutual Fund",
  "UTI Mutual Fund",
];

interface QuarterToFetch {
  calendarQ: string;
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
    if (mo <= 0) { mo = 12; yr -= 1; }
  }
  for (let i = 0; i < n; i++) {
    const calendarQ = `${yr}-Q${Math.ceil(mo / 3)}`;
    const fyEndYear = mo <= 3 ? yr : yr + 1;
    const fyLabelLong = `${fyEndYear - 1}-${fyEndYear}`;
    const fyLabelShort = `${fyEndYear - 1}-${String(fyEndYear).slice(-2)}`;
    const periodCandidates =
      mo === 3 ? ["January - March", "January-March", "Jan-Mar", "Q4"] :
      mo === 6 ? ["April - June", "April-June", "Apr-Jun", "Q1"] :
      mo === 9 ? ["July - September", "July-September", "Jul-Sep", "Q2"] :
                 ["October - December", "October-December", "Oct-Dec", "Q3"];
    out.push({
      calendarQ,
      fyCandidates: [fyLabelLong, fyLabelShort],
      periodCandidates,
    });
    mo -= 3;
    if (mo <= 0) { mo += 12; yr -= 1; }
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
}

interface QuarterStatus {
  data: FieldOutcome;
  type: FieldOutcome;
  mutualFund: FieldOutcome;
  financialYear: FieldOutcome;
  period: FieldOutcome;
  goClicked: boolean;
  resultTableAppeared: boolean;
  downloadLinks: string[];
  amcCellsSeen: string[];
  url: string;
}

const EMPTY_FIELD: FieldOutcome = { found: false, options: [], chosen: null };

interface XhrCapture {
  method: string;
  url: string;
  status: number;
  contentType: string;
  bodyPreview?: string;
}

/**
 * Drive a MUI Autocomplete input by its visible placeholder.
 *
 *  1. Find the input[placeholder="..."]
 *  2. Click it to open the option popup (rendered in a portal)
 *  3. Read all visible options and try to match a candidate
 *     (exact → case-insensitive normalized → partial substring)
 *  4. Click the matched option
 *  5. If no candidate matches, fall back to typing the first candidate
 *     and pressing ArrowDown + Enter.
 *
 * Returns the option list seen and the chosen option (if any).
 */
async function setMuiAutocompleteByPlaceholder(
  page: Page,
  placeholder: string,
  candidates: string[]
): Promise<FieldOutcome> {
  const input = page
    .locator(`input[placeholder="${placeholder}"]`)
    .first();
  if ((await input.count()) === 0) return { ...EMPTY_FIELD };

  try {
    await input.scrollIntoViewIfNeeded();
  } catch {}
  try {
    await input.click({ timeout: 5000 });
  } catch (err) {
    warn(`  click input[placeholder="${placeholder}"] failed: ${(err as Error).message}`);
    return { found: true, options: [], chosen: null };
  }
  await page.waitForTimeout(300);

  // Wait for any of the common MUI popup containers
  try {
    await page.waitForSelector(
      'ul[role="listbox"], [role="listbox"], .MuiAutocomplete-listbox, .MuiAutocomplete-popper [role="listbox"]',
      { timeout: 4000 }
    );
  } catch {
    // No popup. Some MUI Autocompletes need an extra keystroke to open.
    try {
      await input.press("ArrowDown");
      await page.waitForTimeout(300);
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

  if (chosen) {
    const optLocators = [
      page.locator(`[role="option"]:text-is("${chosen}")`).first(),
      page
        .locator(`[role="option"]:has-text("${chosen.replace(/"/g, '\\"')}")`)
        .first(),
      page
        .locator(`.MuiAutocomplete-option:has-text("${chosen.replace(/"/g, '\\"')}")`)
        .first(),
      page
        .locator(`li[role="option"]:has-text("${chosen.replace(/"/g, '\\"')}")`)
        .first(),
    ];
    for (const opt of optLocators) {
      try {
        if ((await opt.count()) === 0) continue;
        await opt.click({ timeout: 3000 });
        return { found: true, options, chosen };
      } catch {}
    }
  }

  // Fallback: type to filter, then ArrowDown + Enter
  if (candidates.length > 0) {
    try {
      await input.fill("");
      await input.fill(candidates[0]);
      await page.waitForTimeout(400);
      await input.press("ArrowDown");
      await input.press("Enter");
      const setVal = await input.inputValue().catch(() => "");
      if (
        setVal &&
        candidates.some((c) =>
          setVal.toLowerCase().includes(c.toLowerCase().slice(0, 4))
        )
      ) {
        return { found: true, options, chosen: setVal };
      }
    } catch {}
  }

  return { found: true, options, chosen: null };
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
      await c.first().click({ timeout: 4000 });
      return true;
    } catch {}
  }
  return false;
}

async function captureResult(
  page: Page,
  targets: string[]
): Promise<{
  tables: { headers: string[]; rows: string[][] }[];
  downloadLinks: { href: string; text: string }[];
  amcCellsSeen: string[];
  bodyText: string;
  url: string;
  visibleButtons: { tag: string; text: string }[];
}> {
  return await page.evaluate((amcTargets: string[]) => {
    const tables = Array.from(document.querySelectorAll("table")).map((tbl) => {
      const headers = Array.from(
        tbl.querySelectorAll(
          "thead tr th, tr:first-child th, tr:first-child td"
        )
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
    const visibleButtons = Array.from(
      document.querySelectorAll('button, a, [role="button"]')
    )
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .slice(0, 30)
      .map((el) => ({
        tag: el.tagName,
        text: ((el as HTMLElement).textContent || "")
          .trim()
          .slice(0, 60),
      }));
    return {
      tables,
      downloadLinks,
      amcCellsSeen,
      bodyText: (document.body.innerText || "").slice(0, 3000),
      url: location.href,
      visibleButtons,
    };
  }, targets);
}

function parseAmcRowsFromTable(table: {
  headers: string[];
  rows: string[][];
}): ParsedAmcRow[] {
  const lc = table.headers.map((h) => h.toLowerCase());
  const amcIdx = lc.findIndex((h) =>
    /amc|fund\s*house|mutual\s*fund\s*name|name\s*of\s*the\s*amc/.test(h)
  );
  if (amcIdx === -1) return [];
  let aaumIdx = lc.findIndex((h) =>
    /(grand\s*total|total\s*aaum|total\s*average\s*aum)/.test(h)
  );
  if (aaumIdx === -1)
    aaumIdx = lc.findIndex((h) =>
      /aaum|average\s*aum|avg\.?\s*aum/.test(h)
    );
  if (aaumIdx === -1) return [];
  const out: ParsedAmcRow[] = [];
  for (const row of table.rows) {
    const name = (row[amcIdx] ?? "").trim();
    if (!name) continue;
    if (/^(total|grand|sub|industry|note|\*|s\.?\s*no)/i.test(name)) continue;
    const aaum = parseNumberLoose(row[aaumIdx]);
    if (aaum === null || aaum <= 0) continue;
    const slug = amfiNameToSlug(name);
    if (!slug) continue;
    out.push({ amcSlug: slug, amcNameAsReported: name, avgAum: aaum });
  }
  return out;
}

async function fetchQuarter(
  browser: Browser,
  q: QuarterToFetch,
  diagnostics: { firstQuarterLogged: boolean }
): Promise<{ rows: ParsedAmcRow[]; sourceUrl: string; status: QuarterStatus } | null> {
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

  const status: QuarterStatus = {
    data: { ...EMPTY_FIELD },
    type: { ...EMPTY_FIELD },
    mutualFund: { ...EMPTY_FIELD },
    financialYear: { ...EMPTY_FIELD },
    period: { ...EMPTY_FIELD },
    goClicked: false,
    resultTableAppeared: false,
    downloadLinks: [],
    amcCellsSeen: [],
    url: "",
  };

  try {
    info(`AAUM: GET ${FORM_URL}  [${q.calendarQ}]`);
    const resp = await page.goto(FORM_URL, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    if (!resp || !resp.ok()) {
      warn(`  HTTP ${resp?.status() ?? "no-response"}`);
      return null;
    }

    // Wait until at least one of the autocompletes is rendered.
    try {
      await page.waitForSelector(
        'input[placeholder="Select Financial Year"], input[placeholder="Select Period"]',
        { timeout: 15_000 }
      );
    } catch {
      warn(`  expected MUI placeholders never appeared`);
    }
    await page.waitForTimeout(500);

    // 1. Select Data
    status.data = await setMuiAutocompleteByPlaceholder(page, "Select Data", [
      "Average AUM",
      "AAUM",
      "AUM",
    ]);
    info(
      `AAUM:   Data found=${status.data.found} chosen=${status.data.chosen ?? "—"} options=[${status.data.options.slice(0, 8).join(" | ")}]`
    );
    await page.waitForTimeout(500);

    // 2. Select Type
    status.type = await setMuiAutocompleteByPlaceholder(page, "Select Type", [
      "AMC-wise",
      "AMC wise",
      "Mutual Fund-wise",
      "Mutual Fund wise",
      "Fund House",
      "Fund House Wise",
      "Average AUM",
    ]);
    info(
      `AAUM:   Type found=${status.type.found} chosen=${status.type.chosen ?? "—"} options=[${status.type.options.slice(0, 8).join(" | ")}]`
    );
    await page.waitForTimeout(500);

    // 3. Select Mutual Fund
    status.mutualFund = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Mutual Fund",
      ["All Mutual Funds", "Select All", "All"]
    );
    info(
      `AAUM:   MF found=${status.mutualFund.found} chosen=${status.mutualFund.chosen ?? "—"} options=[${status.mutualFund.options.slice(0, 8).join(" | ")}]`
    );
    await page.waitForTimeout(500);

    // 4. Select Financial Year
    status.financialYear = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Financial Year",
      q.fyCandidates
    );
    info(
      `AAUM:   FY found=${status.financialYear.found} chosen=${status.financialYear.chosen ?? "—"} options=[${status.financialYear.options.slice(0, 8).join(" | ")}]`
    );
    await page.waitForTimeout(500);

    // 5. Select Period
    status.period = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Period",
      q.periodCandidates
    );
    info(
      `AAUM:   Period found=${status.period.found} chosen=${status.period.chosen ?? "—"} options=[${status.period.options.slice(0, 8).join(" | ")}]`
    );
    await page.waitForTimeout(500);

    // Click Go
    status.goClicked = await clickGoButton(page);
    info(`AAUM:   Go clicked=${status.goClicked}`);
    if (!status.goClicked) {
      // Diagnostics for missing Go
      const buttonsVisible = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('button, [role="button"], input[type="submit"]')
        )
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .slice(0, 30)
          .map((el) => ({
            tag: el.tagName,
            text: ((el as HTMLElement).textContent || "")
              .trim()
              .slice(0, 60),
          }))
      );
      info(
        `AAUM:   visible buttons: ${JSON.stringify(buttonsVisible).slice(0, 1000)}`
      );
      return { rows: [], sourceUrl: page.url(), status };
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {}
    await page.waitForTimeout(2500);

    const recent = xhrCapture.slice(-25);
    info(
      `AAUM network capture (${recent.length} of ${xhrCapture.length}):\n${recent
        .map(
          (c) =>
            `    ${c.method.padEnd(4)} ${c.status} ${c.contentType.split(";")[0].padEnd(28)} ${c.url}`
        )
        .join("\n")}`
    );

    const extract = await captureResult(page, TARGET_AMCS);
    status.url = extract.url;
    status.resultTableAppeared = extract.tables.some((t) => t.rows.length > 1);
    status.downloadLinks = extract.downloadLinks.map((l) => l.href);
    status.amcCellsSeen = extract.amcCellsSeen;

    info(
      `AAUM result: ${extract.tables.length} table(s), AMC cells=${extract.amcCellsSeen.length}, downloads=${extract.downloadLinks.length}, url=${extract.url}`
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

    let parsed: ParsedAmcRow[] = [];
    for (const t of extract.tables) {
      const rows = parseAmcRowsFromTable(t);
      if (rows.length > 0) {
        parsed = rows;
        break;
      }
    }

    if (parsed.length === 0) {
      info(
        `AAUM:   no AMC rows parsed for ${q.calendarQ}. Field outcomes:\n` +
          `    Data: chosen="${status.data.chosen ?? "—"}" options=[${status.data.options.slice(0, 12).join(" | ")}]\n` +
          `    Type: chosen="${status.type.chosen ?? "—"}" options=[${status.type.options.slice(0, 12).join(" | ")}]\n` +
          `    MF:   chosen="${status.mutualFund.chosen ?? "—"}" options=[${status.mutualFund.options.slice(0, 12).join(" | ")}]\n` +
          `    FY:   chosen="${status.financialYear.chosen ?? "—"}" options=[${status.financialYear.options.slice(0, 12).join(" | ")}]\n` +
          `    Period: chosen="${status.period.chosen ?? "—"}" options=[${status.period.options.slice(0, 12).join(" | ")}]\n` +
          `    Go: ${status.goClicked}\n` +
          `    Result table appeared: ${status.resultTableAppeared}\n` +
          `    Download links: ${status.downloadLinks.length > 0 ? status.downloadLinks.slice(0, 6).join(", ") : "none"}\n` +
          `    AMC cells seen: [${status.amcCellsSeen.slice(0, 6).join(" | ")}]\n` +
          `    URL after Go: ${status.url}\n` +
          (diagnostics.firstQuarterLogged
            ? ""
            : `    Body text head:\n      ${extract.bodyText
                .split("\n")
                .slice(0, 60)
                .map((l) => l.trim())
                .filter(Boolean)
                .join("\n      ")}`)
      );
      diagnostics.firstQuarterLogged = true;
      return { rows: [], sourceUrl: extract.url, status };
    }

    info(`AAUM:   parsed ${parsed.length} AMC rows for ${q.calendarQ}`);
    return { rows: parsed, sourceUrl: extract.url, status };
  } finally {
    await ctx.close();
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
  const browser = await chromium.launch({ headless: true });

  try {
    const quarters = recentQuartersFY(8);
    const outRows: AmcAaumQuarterlyRow[] = [];
    const fetchedAt = nowIso();
    const diagnostics = { firstQuarterLogged: false };

    for (const q of quarters) {
      info(
        `AAUM: quarter ${q.calendarQ}  (FY ${q.fyCandidates[0]}, period ${q.periodCandidates[0]})`
      );
      const outcome = await fetchQuarter(browser, q, diagnostics);
      if (!outcome || outcome.rows.length === 0) continue;
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
      }
    }

    if (outRows.length === 0) {
      warn(
        "AAUM: no rows extracted from any quarter — keeping previous snapshot. See diagnostics above."
      );
      return;
    }

    const slugsCovered = new Set(outRows.map((r) => r.amcSlug));
    const quartersCovered = Array.from(
      new Set(outRows.map((r) => r.quarter))
    ).sort();
    info(
      `AAUM: ${outRows.length} rows · ${slugsCovered.size} AMCs · ${quartersCovered.length} quarters · range ${quartersCovered[0]}…${quartersCovered[quartersCovered.length - 1]}`
    );

    const snapshot: AmcAaumQuarterlySnapshot = {
      meta: {
        generatedAt: fetchedAt,
        source: FORM_URL,
        notes:
          "Per-AMC quarterly AAUM extracted via the AMFI Average AUM disclosure form (MUI Autocomplete UI: Data / Type / Mutual Fund / Financial Year / Period). Each row carries source + fetchedAt provenance.",
      },
      rows: outRows,
    };
    await writeSnapshot("amc-aaum-quarterly.json", snapshot);
    info("wrote amc-aaum-quarterly.json");
  } finally {
    await browser.close();
  }
}
