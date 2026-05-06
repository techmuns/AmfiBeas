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
  fyLabelLong: string;
  fyLabelShort: string;
  periodLabels: string[];
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
    const periodLabels =
      mo === 3 ? ["January - March", "January-March", "Jan - Mar", "Jan-Mar", "Q4"] :
      mo === 6 ? ["April - June", "April-June", "Apr - Jun", "Apr-Jun", "Q1"] :
      mo === 9 ? ["July - September", "July-September", "Jul - Sep", "Jul-Sep", "Q2"] :
                 ["October - December", "October-December", "Oct - Dec", "Oct-Dec", "Q3"];
    out.push({ calendarQ, fyLabelLong, fyLabelShort, periodLabels });
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

interface StepStatus {
  fyControlFound: boolean;
  fyValueSet: boolean;
  periodControlFound: boolean;
  periodValueSet: boolean;
  mfControlFound: boolean;
  mfValueSet: boolean;
  goClicked: boolean;
  resultTableAppeared: boolean;
  targetAmcsSeen: string[];
}

interface XhrCapture {
  method: string;
  url: string;
  status: number;
  contentType: string;
  bodyPreview?: string;
}

async function dumpDomDiagnostics(page: Page, label: string) {
  const data = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map((el) => ({
      type: el.type,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      value: el.value,
      classes: (el.className || "").toString().slice(0, 120),
    }));
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')
    )
      .slice(0, 40)
      .map((el) => {
        const e = el as HTMLElement;
        const inp = el as HTMLInputElement;
        return {
          tag: el.tagName,
          role: el.getAttribute("role") || "",
          id: el.id || "",
          classes: (e.className || "").toString().slice(0, 80),
          text: ((e.textContent || inp.value || "").trim()).slice(0, 80),
        };
      });
    const aria = Array.from(
      document.querySelectorAll('[role="combobox"], [role="listbox"], [role="option"], [role="tab"]')
    )
      .slice(0, 40)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        id: el.id || "",
        classes: ((el as HTMLElement).className || "").toString().slice(0, 80),
        text: ((el as HTMLElement).textContent || "").trim().slice(0, 80),
      }));
    const dropdownish = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const cl = ((el as HTMLElement).className || "").toString();
        const id = el.id || "";
        const name = (el as HTMLInputElement).name || "";
        return /dropdown|select(2)?|year|period|mutual|fund|scheme|aum/i.test(
          cl + " " + id + " " + name
        );
      })
      .slice(0, 30)
      .map((el) => ({
        tag: el.tagName,
        id: el.id || "",
        classes: ((el as HTMLElement).className || "").toString().slice(0, 80),
        text: ((el as HTMLElement).textContent || "").trim().slice(0, 60),
      }));
    const scriptSrcs = Array.from(document.querySelectorAll("script[src]"))
      .map((s) => (s as HTMLScriptElement).src)
      .slice(0, 30);
    const inlineSnippets = Array.from(document.querySelectorAll("script:not([src])"))
      .map((s) => (s.textContent || "").trim())
      .filter((t) => /AverageAUM|AUM|FinancialYear|Period|MutualFund|Fund/i.test(t))
      .slice(0, 5)
      .map((t) => t.slice(0, 240));
    const visibleLinks = Array.from(document.querySelectorAll("a"))
      .filter((a) => (a as HTMLAnchorElement).offsetParent !== null)
      .slice(0, 30)
      .map((a) => {
        const e = a as HTMLAnchorElement;
        return { href: e.href, text: (e.textContent || "").trim().slice(0, 60) };
      });
    const bodyText = (document.body.innerText || "").slice(0, 3000);
    return {
      inputs,
      buttons,
      aria,
      dropdownish,
      scriptSrcs,
      inlineSnippets,
      visibleLinks,
      bodyTextHead: bodyText,
    };
  });
  info(
    `AAUM diagnostics [${label}]:\n${JSON.stringify(data, null, 2)
      .split("\n")
      .map((l) => "    " + l)
      .join("\n")}`
  );
}

async function clickMfTab(page: Page): Promise<boolean> {
  // AMFI's average-aum page now exposes MF and SIF tabs. Ensure MF is active.
  const candidates = [
    page.getByRole("tab", { name: /^MF$/i }),
    page.locator('button:has-text("MF")').first(),
    page.locator('a:has-text("MF")').first(),
  ];
  for (const loc of candidates) {
    try {
      const count = await loc.count();
      if (count === 0) continue;
      await loc.first().click({ timeout: 3000 });
      info(`AAUM: clicked MF tab via ${loc}`);
      await page.waitForTimeout(800);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

/**
 * Find a control associated with a label-text and try to set it to one of
 * `optionTexts`. Returns whether the control was found and whether a value
 * was set. Works for native <select>, [role=combobox], button-driven menus,
 * and select2/Bootstrap-style dropdowns.
 */
async function setControlByLabel(
  page: Page,
  labelText: string,
  optionTexts: string[]
): Promise<{ found: boolean; set: boolean }> {
  // Try native <select> labelled by exact text first.
  const labelEl = page.locator(`label:has-text("${labelText}")`).first();
  if ((await labelEl.count()) > 0) {
    const forAttr = await labelEl.getAttribute("for").catch(() => null);
    if (forAttr) {
      const target = page.locator(`#${cssEscape(forAttr)}`).first();
      if ((await target.count()) > 0) {
        const tag = await target.evaluate((e) => e.tagName.toLowerCase());
        if (tag === "select") {
          for (const t of optionTexts) {
            try {
              await target.selectOption({ label: t });
              return { found: true, set: true };
            } catch {
              // try next label
            }
          }
        }
      }
    }
  }

  // Generic text-anchor approach: find any element containing the label text,
  // open the closest-following clickable control, then click an option.
  const anchor = page.locator(`text=/^\\s*${escapeRe(labelText)}\\s*$/i`).first();
  let usedAnchor = anchor;
  if ((await anchor.count()) === 0) {
    // Looser match
    const loose = page.getByText(labelText, { exact: false }).first();
    if ((await loose.count()) === 0) return { found: false, set: false };
    usedAnchor = loose;
  }
  try {
    await usedAnchor.scrollIntoViewIfNeeded();
  } catch {}

  const candidates = [
    usedAnchor.locator(
      'xpath=following::*[self::button or self::select or @role="combobox" or @role="button" or contains(@class,"dropdown") or contains(@class,"select2")][1]'
    ),
    usedAnchor.locator(
      'xpath=ancestor::*[self::div or self::form or self::section][1]//*[self::button or self::select or @role="combobox" or contains(@class,"dropdown") or contains(@class,"select2")][1]'
    ),
    usedAnchor.locator('xpath=following::input[@type="text"][1]'),
  ];

  let opened = false;
  for (const c of candidates) {
    try {
      if ((await c.count()) === 0) continue;
      const handle = c.first();
      const tag = await handle.evaluate((e) => e.tagName.toLowerCase());
      if (tag === "select") {
        for (const t of optionTexts) {
          try {
            await handle.selectOption({ label: t });
            return { found: true, set: true };
          } catch {
            // try next
          }
        }
        return { found: true, set: false };
      }
      await handle.click({ timeout: 4000 });
      opened = true;
      break;
    } catch {
      // try next
    }
  }
  if (!opened) return { found: false, set: false };

  // Wait briefly for option list to render in any portal/popup
  await page.waitForTimeout(400);

  for (const t of optionTexts) {
    const optionMatchers = [
      page.locator(`[role="option"]:has-text("${t}")`).first(),
      page.locator(`li:has-text("${t}")`).first(),
      page.locator(`a:has-text("${t}")`).first(),
      page.locator(`button:has-text("${t}")`).first(),
      page.getByText(t, { exact: true }).first(),
    ];
    for (const opt of optionMatchers) {
      try {
        if ((await opt.count()) === 0) continue;
        await opt.click({ timeout: 4000 });
        return { found: true, set: true };
      } catch {
        // try next
      }
    }
  }
  return { found: true, set: false };
}

function cssEscape(s: string): string {
  return s.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickGoButton(page: Page): Promise<boolean> {
  const candidates = [
    page.locator('button:has-text("Go"), input[value="Go"]').first(),
    page.getByRole("button", { name: /^(go|view|submit|show|fetch)$/i }).first(),
    page.locator('button[type="submit"]').first(),
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

interface PageExtract {
  tables: { headers: string[]; rows: string[][] }[];
  amcCellsSeen: string[];
  bodyText: string;
  url: string;
  visibleButtons: { tag: string; text: string }[];
}

async function extractResultArea(page: Page): Promise<PageExtract> {
  return await page.evaluate((targets: string[]) => {
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
    const amcCellsSeen: string[] = [];
    const seenSet = new Set<string>();
    for (const tbl of tables) {
      for (const row of tbl.rows) {
        for (const cell of row) {
          for (const name of targets) {
            if (
              cell.toLowerCase().includes(name.toLowerCase().slice(0, 12)) &&
              !seenSet.has(cell)
            ) {
              seenSet.add(cell);
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
        text: ((el as HTMLElement).textContent || "").trim().slice(0, 60),
      }));
    return {
      tables,
      amcCellsSeen,
      bodyText: (document.body.innerText || "").slice(0, 3000),
      url: location.href,
      visibleButtons,
    };
  }, TARGET_AMCS);
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

async function fetchQuarterViaPlaywright(
  browser: Browser,
  q: QuarterToFetch,
  diagnostics: { logged: boolean }
): Promise<{ rows: ParsedAmcRow[]; sourceUrl: string; status: StepStatus } | null> {
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const status: StepStatus = {
    fyControlFound: false,
    fyValueSet: false,
    periodControlFound: false,
    periodValueSet: false,
    mfControlFound: false,
    mfValueSet: false,
    goClicked: false,
    resultTableAppeared: false,
    targetAmcsSeen: [],
  };

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
    info(`AAUM: GET ${FORM_URL}  [${q.calendarQ}]`);
    const resp = await page.goto(FORM_URL, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    if (!resp || !resp.ok()) {
      warn(`  HTTP ${resp?.status() ?? "no-response"}`);
      return null;
    }

    // Wait for the page text to actually mention the form labels
    try {
      await page.waitForFunction(
        () => {
          const t = document.body.innerText;
          return /Average AUM/i.test(t) && /Financial Year/i.test(t);
        },
        { timeout: 15_000 }
      );
    } catch {
      warn(`  page text never showed "Financial Year"`);
    }
    await page.waitForTimeout(800);

    if (!diagnostics.logged) {
      await dumpDomDiagnostics(page, "after page load");
    }

    // Click MF tab if present
    const mfClicked = await clickMfTab(page);
    if (mfClicked) {
      info(`AAUM: MF tab activated`);
      await page.waitForTimeout(800);
    }

    // Set Financial Year
    const fyResult = await setControlByLabel(page, "Financial Year", [
      q.fyLabelLong,
      q.fyLabelShort,
    ]);
    status.fyControlFound = fyResult.found;
    status.fyValueSet = fyResult.set;
    info(
      `AAUM:   FY [${q.fyLabelLong}] found=${fyResult.found} set=${fyResult.set}`
    );
    if (!fyResult.set) {
      if (!diagnostics.logged) {
        await dumpDomDiagnostics(page, "FY set failed");
        diagnostics.logged = true;
      }
      return { rows: [], sourceUrl: page.url(), status };
    }
    await page.waitForTimeout(600);

    // Set Period
    const periodResult = await setControlByLabel(page, "Period", q.periodLabels);
    status.periodControlFound = periodResult.found;
    status.periodValueSet = periodResult.set;
    info(
      `AAUM:   Period [${q.periodLabels[0]}] found=${periodResult.found} set=${periodResult.set}`
    );
    if (!periodResult.set) {
      if (!diagnostics.logged) {
        await dumpDomDiagnostics(page, "Period set failed");
        diagnostics.logged = true;
      }
      return { rows: [], sourceUrl: page.url(), status };
    }
    await page.waitForTimeout(600);

    // Set Mutual Fund (try "All" / "Select All"; if not, accept default)
    const mfResult = await setControlByLabel(page, "Mutual Fund", [
      "All Mutual Funds",
      "Select All",
      "All",
    ]);
    status.mfControlFound = mfResult.found;
    status.mfValueSet = mfResult.set;
    info(
      `AAUM:   MF found=${mfResult.found} set=${mfResult.set}`
    );

    diagnostics.logged = true;

    // Click Go
    const clicked = await clickGoButton(page);
    status.goClicked = clicked;
    info(`AAUM:   Go clicked=${clicked}`);
    if (!clicked) {
      await dumpDomDiagnostics(page, "Go not found");
      return { rows: [], sourceUrl: page.url(), status };
    }

    // Wait for results
    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {}
    await page.waitForTimeout(2500);

    // Capture network XHRs (last 25)
    const recent = xhrCapture.slice(-25);
    info(
      `AAUM network capture (${recent.length} of ${xhrCapture.length}):\n${recent
        .map(
          (c) =>
            `    ${c.method.padEnd(4)} ${c.status} ${c.contentType
              .split(";")[0]
              .padEnd(28)} ${c.url}`
        )
        .join("\n")}`
    );

    const extract = await extractResultArea(page);
    status.resultTableAppeared = extract.tables.some(
      (t) => t.rows.length > 1
    );
    status.targetAmcsSeen = extract.amcCellsSeen;

    info(
      `AAUM result: ${extract.tables.length} table(s), AMC cells seen=${extract.amcCellsSeen.length}, url=${extract.url}`
    );
    extract.tables.forEach((t, i) => {
      info(
        `   table[${i}] rows=${t.rows.length} headers=[${t.headers
          .slice(0, 8)
          .join(" | ")}]`
      );
    });

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
        `AAUM:   no AMC rows parsed — diagnostics:\n` +
          `    fyControlFound=${status.fyControlFound} fyValueSet=${status.fyValueSet}\n` +
          `    periodControlFound=${status.periodControlFound} periodValueSet=${status.periodValueSet}\n` +
          `    mfControlFound=${status.mfControlFound} mfValueSet=${status.mfValueSet}\n` +
          `    goClicked=${status.goClicked} resultTableAppeared=${status.resultTableAppeared}\n` +
          `    AMC cells seen on page: [${status.targetAmcsSeen.slice(0, 6).join(" | ")}]\n` +
          `    Visible buttons (top 30):\n      ${extract.visibleButtons
            .map((b) => `${b.tag} "${b.text}"`)
            .join("\n      ")}\n` +
          `    URL after Go: ${extract.url}\n` +
          `    Body text (first 3000 chars):\n      ${extract.bodyText
            .split("\n")
            .slice(0, 60)
            .map((l) => l.trim())
            .filter(Boolean)
            .join("\n      ")}`
      );
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
    const diagnostics = { logged: false };

    for (const q of quarters) {
      info(
        `AAUM: quarter ${q.calendarQ}  (FY ${q.fyLabelLong}, period ${q.periodLabels[0]})`
      );
      const outcome = await fetchQuarterViaPlaywright(browser, q, diagnostics);
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
      // If we got data for one quarter, the form interaction works — keep going.
      // If we got nothing, try the next quarter (label texts may differ).
    }

    if (outRows.length === 0) {
      warn(
        "AAUM: no rows extracted from any quarter — see diagnostics above. Keeping previous snapshot."
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
          "Per-AMC quarterly AAUM extracted via the AMFI Average AUM disclosure form (custom-dropdown UI). Each row carries source + fetchedAt provenance.",
      },
      rows: outRows,
    };
    await writeSnapshot("amc-aaum-quarterly.json", snapshot);
    info("wrote amc-aaum-quarterly.json");
  } finally {
    await browser.close();
  }
}
