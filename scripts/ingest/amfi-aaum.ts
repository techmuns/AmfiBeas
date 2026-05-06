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

// All timing budgets in milliseconds. Sized so a single quarter run finishes
// well inside the overall 90 s kill timer even when most steps fail soft.
const T = {
  totalKill: 120_000,
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
      info(
        `AAUM[${quarter}]: loading settled [${label}] in ${Math.round(
          timeoutMs - (deadline - Date.now())
        )}ms`
      );
      return true;
    }
    await sleep(400);
  }
  info(
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
  info(
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
    info(`AAUM[${q.calendarQ}]: opening page ${FORM_URL}`);
    const resp = await page.goto(FORM_URL, {
      waitUntil: "domcontentloaded",
      timeout: T.pageGoto,
    });
    if (!resp || !resp.ok()) {
      warn(`  HTTP ${resp?.status() ?? "no-response"}`);
      return null;
    }
    info(`AAUM[${q.calendarQ}]: page loaded, waiting for form ready`);
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
    info(`AAUM[${q.calendarQ}]: setting Select Data → Fundwise`);
    const fData = await setMuiAutocompleteByPlaceholder(page, "Select Data", [
      "Fundwise",
      "Fund wise",
      "Fund-wise",
    ]);
    info(
      `AAUM[${q.calendarQ}]:   Data found=${fData.found} chosen=${fData.chosen ?? "—"} value="${fData.visibleValue}" options=[${fData.options.slice(0, 8).join(" | ")}]`
    );
    if (!fData.visibleValue || !/fund\s*wise/i.test(fData.visibleValue)) {
      warn(`AAUM[${q.calendarQ}]: Fundwise not visible in input — cannot proceed`);
      return null;
    }

    // Wait for dependent fields to render after Fundwise is selected.
    info(
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
    info(`AAUM[${q.calendarQ}]: setting Select Type (optional)`);
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
      info(
        `AAUM[${q.calendarQ}]:   Type found=true chosen=${fType.chosen ?? "—"} value="${fType.visibleValue}" options=[${fType.options.slice(0, 8).join(" | ")}]`
      );
    } else {
      info(`AAUM[${q.calendarQ}]:   Type not present — skipping`);
    }
    if (fType.found) await sleep(T.midSleep);

    // Step 3: Financial Year FIRST. The previous run showed Period turns
    // into a disabled "Loading..." input the moment FY is set, which means
    // FY triggers the async load that produces Period (and possibly MF)
    // options. We must drive FY before Period.
    info(`AAUM[${q.calendarQ}]: setting Select Financial Year`);
    const fFy = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Financial Year",
      q.fyCandidates
    );
    info(
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
      info(`AAUM[${q.calendarQ}]: setting Select Mutual Fund`);
      fMf = await setMuiAutocompleteByPlaceholder(
        page,
        "Select Mutual Fund",
        ["All Mutual Funds", "Select All", "All"]
      );
      info(
        `AAUM[${q.calendarQ}]:   MF found=${fMf.found} chosen=${fMf.chosen ?? "—"} value="${fMf.visibleValue}" options=[${fMf.options.slice(0, 8).join(" | ")}]`
      );
      // Debug fallback: if no "All" option, pick HDFC.
      if (fMf.found && !fMf.visibleValue && fMf.options.length > 0) {
        info(
          `AAUM[${q.calendarQ}]:   MF: no "All" option visible — falling back to HDFC Mutual Fund (debug)`
        );
        fMf = await setMuiAutocompleteByPlaceholder(
          page,
          "Select Mutual Fund",
          ["HDFC Mutual Fund"]
        );
        info(
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
      info(
        `AAUM[${q.calendarQ}]:   MF not present after FY load — proceeding directly to Period`
      );
    }

    // Step 5: Period
    info(`AAUM[${q.calendarQ}]: setting Select Period`);
    const fPeriod = await setMuiAutocompleteByPlaceholder(
      page,
      "Select Period",
      q.periodCandidates
    );
    info(
      `AAUM[${q.calendarQ}]:   Period found=${fPeriod.found} chosen=${fPeriod.chosen ?? "—"} value="${fPeriod.visibleValue}" options=[${fPeriod.options.slice(0, 8).join(" | ")}]`
    );

    // Trust the per-field FieldOutcome values (already verified by reading
    // input.value back inside the helper). The earlier `readVisibleFormValues`
    // helper kept returning empty strings for inputs that logVisiblePlaceholders
    // showed as populated — likely an MUI dual-mount + race quirk we can't
    // reliably work around. The field outcomes match the visible inputs.
    const goState = await readGoButtonState(page);
    info(
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
      info(
        `AAUM[${q.calendarQ}]: NOT clicking Go — dataOk=${dataOk} fyOk=${fyOk} periodOk=${periodOk} goEnabled=${goEnabled}`
      );
      info(
        `AAUM[${q.calendarQ}]:   FY options at fail: [${fFy.options.slice(0, 12).join(" | ")}]`
      );
      info(
        `AAUM[${q.calendarQ}]:   Period options at fail: [${fPeriod.options.slice(0, 12).join(" | ")}]`
      );
      await logVisiblePlaceholders(page, q.calendarQ, "before-Go (skipped)");
      return null;
    }

    info(`AAUM[${q.calendarQ}]: clicking Go`);
    const goClicked = await clickGoButton(page);
    info(`AAUM[${q.calendarQ}]:   Go clicked=${goClicked}`);
    if (!goClicked) {
      await logVisiblePlaceholders(page, q.calendarQ, "after Go-click failed");
      return null;
    }

    info(`AAUM[${q.calendarQ}]: waiting for results (max ${T.postGoNetworkIdle}ms)`);
    try {
      await page.waitForLoadState("networkidle", {
        timeout: T.postGoNetworkIdle,
      });
    } catch {}
    await sleep(T.postGoSettle);

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

    const extract = await captureResult(page, TARGET_AMCS);
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

    info(`AAUM[${q.calendarQ}]: parsed ${parsed.length} AMC rows`);
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
    info(
      `AAUM: starting (debug-one-quarter=${DEBUG_ONE_QUARTER ? "on" : "off"}, total budget=${T.totalKill}ms)`
    );
    browser = await chromium.launch({ headless: true });

    const allQuarters = recentQuartersFY(8);
    const quarters = DEBUG_ONE_QUARTER ? allQuarters.slice(0, 1) : allQuarters;
    info(`AAUM: will attempt ${quarters.length} quarter(s)`);

    const outRows: AmcAaumQuarterlyRow[] = [];
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
        "AAUM: no rows extracted — keeping previous snapshot. See diagnostics above."
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
          "Per-AMC quarterly AAUM extracted via the AMFI Average AUM disclosure form (MUI Autocomplete UI). Each row carries source + fetchedAt provenance.",
      },
      rows: outRows,
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
