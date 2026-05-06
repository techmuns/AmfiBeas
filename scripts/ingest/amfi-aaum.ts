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

const FORM_URL = "https://www.amfiindia.com/aum-data/average-aum";

interface QuarterToFetch {
  calendarQ: string;       // e.g., "2026-Q1"
  fyLabelLong: string;     // e.g., "2025-2026"
  fyLabelShort: string;    // e.g., "2025-26"
  periodLabels: string[];  // candidate texts in the period <select>
}

function recentQuartersFY(n: number): QuarterToFetch[] {
  const out: QuarterToFetch[] = [];
  const now = new Date();
  let yr = now.getFullYear();
  let mo = now.getMonth() + 1; // 1..12
  // Walk back to the most recently completed quarter end (Mar/Jun/Sep/Dec).
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
    const fyLabelLong = `${fyEndYear - 1}-${fyEndYear}`;
    const fyLabelShort = `${fyEndYear - 1}-${String(fyEndYear).slice(-2)}`;
    const periodLabels =
      mo === 3
        ? ["January - March", "January-March", "Jan-Mar", "Q4"]
        : mo === 6
        ? ["April - June", "April-June", "Apr-Jun", "Q1"]
        : mo === 9
        ? ["July - September", "July-September", "Jul-Sep", "Q2"]
        : ["October - December", "October-December", "Oct-Dec", "Q3"];
    out.push({ calendarQ, fyLabelLong, fyLabelShort, periodLabels });
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

interface QuarterOutcome {
  rows: ParsedAmcRow[];
  sourceUrl: string;
}

const FOUR_LISTED_AMC_NAMES = [
  "HDFC Mutual Fund",
  "Nippon India Mutual Fund",
  "Aditya Birla Sun Life Mutual Fund",
  "UTI Mutual Fund",
];

async function fetchQuarterViaPlaywright(
  q: QuarterToFetch,
  diagnostics: { loggedForm: boolean; loggedNetwork: boolean }
): Promise<QuarterOutcome | null> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    warn(`playwright not available: ${(err as Error).message}`);
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    const page = await ctx.newPage();

    // Capture network requests so we can identify any backend XHR endpoint.
    const xhrCalls: { method: string; url: string; status: number; type: string }[] = [];
    page.on("response", (resp) => {
      const url = resp.url();
      // Filter to AMFI hosts and skip static asset noise
      if (!/amfiindia\.com/i.test(url)) return;
      if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf)(\?|$)/i.test(url))
        return;
      xhrCalls.push({
        method: resp.request().method(),
        url,
        status: resp.status(),
        type: resp.headers()["content-type"] ?? "",
      });
    });

    info(`AAUM: GET ${FORM_URL}  [${q.calendarQ}]`);
    const resp = await page.goto(FORM_URL, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    if (!resp || !resp.ok()) {
      warn(`  HTTP ${resp?.status() ?? "no-response"}`);
      return null;
    }
    await page.waitForTimeout(1500);

    // First run: dump form structure so we know what we're dealing with.
    if (!diagnostics.loggedForm) {
      const formInfo = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select")).map(
          (s) => ({
            id: s.id || "",
            name: s.name || "",
            optionCount: s.options.length,
            optionsSample: Array.from(s.options)
              .slice(0, 25)
              .map((o) => ({ value: o.value, text: o.text.trim() })),
          })
        );
        const buttons = Array.from(
          document.querySelectorAll(
            'button, input[type="submit"], input[type="button"]'
          )
        ).map((b) => {
          const el = b as HTMLElement;
          const ip = b as HTMLInputElement;
          return {
            tag: el.tagName,
            id: el.id || "",
            name: ip.name || "",
            text: (el.textContent || ip.value || "").trim().slice(0, 60),
          };
        });
        return { selects, buttons };
      });
      info(
        `AAUM form structure:\n${JSON.stringify(formInfo, null, 2)
          .split("\n")
          .map((l) => "    " + l)
          .join("\n")}`
      );
      diagnostics.loggedForm = true;
    }

    // Set Financial Year — match by visible option text (long/short variants).
    const fy = await page.evaluate((labels: string[]) => {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const s of selects) {
        for (const lbl of labels) {
          const opt = Array.from(s.options).find(
            (o) => o.text.trim() === lbl || o.value === lbl
          );
          if (opt) {
            s.value = opt.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            return {
              selectId: s.id || s.name,
              value: opt.value,
              text: opt.text.trim(),
            };
          }
        }
      }
      return null;
    }, [q.fyLabelLong, q.fyLabelShort]);
    if (!fy) {
      warn(
        `  could not set FinancialYear (looked for "${q.fyLabelLong}" / "${q.fyLabelShort}")`
      );
      return null;
    }
    info(`  FY set: ${fy.selectId}=${fy.value} ("${fy.text}")`);
    await page.waitForTimeout(1500);

    // Set Period (quarter).
    const period = await page.evaluate((labels: string[]) => {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const s of selects) {
        for (const lbl of labels) {
          const opt = Array.from(s.options).find(
            (o) => o.text.trim() === lbl || o.value === lbl
          );
          if (opt) {
            s.value = opt.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            return {
              selectId: s.id || s.name,
              value: opt.value,
              text: opt.text.trim(),
            };
          }
        }
      }
      return null;
    }, q.periodLabels);
    if (!period) {
      warn(
        `  could not set Period (looked for ${q.periodLabels
          .map((l) => `"${l}"`)
          .join(" / ")})`
      );
      return null;
    }
    info(`  Period set: ${period.selectId}=${period.value} ("${period.text}")`);
    await page.waitForTimeout(1500);

    // Try to set "Select All" / "All Mutual Funds" on any remaining select.
    const mf = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const s of selects) {
        const allOpt = Array.from(s.options).find((o) =>
          /select\s*all|all\s*mutual\s*fund|all\s*funds?/i.test(o.text)
        );
        if (allOpt) {
          s.value = allOpt.value;
          s.dispatchEvent(new Event("change", { bubbles: true }));
          return {
            selectId: s.id || s.name,
            value: allOpt.value,
            text: allOpt.text.trim(),
          };
        }
      }
      return null;
    });
    if (mf) {
      info(`  MF set: ${mf.selectId}=${mf.value} ("${mf.text}")`);
    } else {
      info(`  no "Select All" option found — submitting with default MF`);
    }

    // Click submit / Go button.
    const submitted = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, input[type="submit"], input[type="button"]'
        )
      );
      const btn = candidates.find((el) => {
        const text = (
          el.textContent ||
          (el as HTMLInputElement).value ||
          ""
        )
          .trim()
          .toLowerCase();
        return /^(go|view|submit|show|fetch|search|generate)$/.test(text);
      });
      if (btn) {
        (btn as HTMLElement).click();
        return {
          tag: btn.tagName,
          text: (btn.textContent || (btn as HTMLInputElement).value || "")
            .trim()
            .slice(0, 30),
        };
      }
      return null;
    });
    if (!submitted) {
      warn("  no submit button found");
      return null;
    }
    info(`  submit clicked: ${submitted.tag} "${submitted.text}"`);

    await page.waitForTimeout(6000);

    // After submission: log any AMFI XHR/POST captured during this flow.
    if (!diagnostics.loggedNetwork && xhrCalls.length > 0) {
      const dataCalls = xhrCalls.slice(-25);
      info(
        `AAUM network capture (last ${dataCalls.length} of ${xhrCalls.length}):\n${dataCalls
          .map(
            (c) =>
              `    ${c.method.padEnd(4)} ${c.status} ${c.type.split(";")[0].padEnd(28)} ${c.url}`
          )
          .join("\n")}`
      );
      diagnostics.loggedNetwork = true;
    }

    // Inspect tables on the result page.
    const tableSummaries = await page.$$eval("table", (els) =>
      els.map((tbl) => {
        const headers = Array.from(
          tbl.querySelectorAll("thead tr th, tr:first-child th, tr:first-child td")
        ).map((c) => (c.textContent || "").trim());
        const rowCount = tbl.querySelectorAll("tbody tr, tr").length;
        return { headers, rowCount };
      })
    );
    info(
      `AAUM result page: ${tableSummaries.length} table(s)\n${tableSummaries
        .map(
          (t, i) =>
            `    table[${i}] rows=${t.rowCount} headers=[${t.headers
              .slice(0, 8)
              .join(" | ")}]`
        )
        .join("\n")}`
    );

    // Find the AMC-wise table: header row should contain something
    // that looks like AMC + AAUM/Average AUM + (typically) Total/Grand Total.
    const parsed: ParsedAmcRow[] = [];
    const sourceUrl = page.url();
    const tableRowsAll = await page.$$eval("table", (els) =>
      els.map((tbl) =>
        Array.from(tbl.querySelectorAll("tr")).map((r) =>
          Array.from(r.querySelectorAll("th, td")).map((c) =>
            (c.textContent || "").trim()
          )
        )
      )
    );

    for (let i = 0; i < tableSummaries.length; i++) {
      const tbl = tableRowsAll[i];
      const summary = tableSummaries[i];
      const lcHeaders = summary.headers.map((h) => h.toLowerCase());
      const hasAmcCol = lcHeaders.some((h) =>
        /amc|fund\s*house|mutual\s*fund/.test(h)
      );
      const hasAaumCol = lcHeaders.some((h) =>
        /aaum|average\s*aum|avg\.?\s*aum/.test(h)
      );
      if (!hasAmcCol || !hasAaumCol) continue;

      const amcIdx = lcHeaders.findIndex((h) =>
        /amc|fund\s*house|mutual\s*fund/.test(h)
      );
      let aaumIdx = lcHeaders.findIndex((h) =>
        /(grand\s*total|total\s*aaum|total\s*average\s*aum)/.test(h)
      );
      if (aaumIdx === -1)
        aaumIdx = lcHeaders.findIndex((h) =>
          /aaum|average\s*aum|avg\.?\s*aum/.test(h)
        );
      info(
        `  using table[${i}] amcIdx=${amcIdx} aaumIdx=${aaumIdx} headers=[${lcHeaders
          .slice(0, 8)
          .join(" | ")}]`
      );

      for (const row of tbl) {
        const name = (row[amcIdx] ?? "").trim();
        if (!name) continue;
        if (/^(total|grand|sub|industry|note|\*)/i.test(name)) continue;
        const aaum = parseNumberLoose(row[aaumIdx]);
        if (aaum === null || aaum <= 0) continue;
        const slug = amfiNameToSlug(name);
        if (!slug) continue;
        parsed.push({ amcSlug: slug, amcNameAsReported: name, avgAum: aaum });
      }
      if (parsed.length > 0) break;
    }

    if (parsed.length === 0) {
      // Diagnostics: list which AMC names AMFI returned (any) so we can
      // spot a name-mapping mismatch vs an outright missing source.
      const amcNamesSeen = new Set<string>();
      for (const tbl of tableRowsAll) {
        for (const row of tbl) {
          for (const cell of row) {
            for (const name of FOUR_LISTED_AMC_NAMES) {
              if (cell && cell.toLowerCase().includes(name.toLowerCase().slice(0, 12))) {
                amcNamesSeen.add(cell);
              }
            }
          }
        }
      }
      if (amcNamesSeen.size > 0) {
        info(
          `  AMC-like cells seen but no AAUM column matched:\n    ${[
            ...amcNamesSeen,
          ]
            .slice(0, 10)
            .join("\n    ")}`
        );
      } else {
        info(`  no AMC-like cells detected on result page`);
      }
      return null;
    }

    info(`  parsed ${parsed.length} AMC rows for ${q.calendarQ}`);
    return { rows: parsed, sourceUrl };
  } finally {
    await browser.close();
  }
}

export async function ingestAmfiAaum(): Promise<void> {
  const quarters = recentQuartersFY(8);
  const outRows: AmcAaumQuarterlyRow[] = [];
  const fetchedAt = nowIso();
  const diagnostics = { loggedForm: false, loggedNetwork: false };

  for (const q of quarters) {
    info(
      `AAUM: quarter ${q.calendarQ}  (FY ${q.fyLabelLong}, period ${q.periodLabels[0]})`
    );
    const outcome = await fetchQuarterViaPlaywright(q, diagnostics);
    if (!outcome) continue;
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
      "AAUM: no rows extracted — keeping previous snapshot. See diagnostics above for next step."
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
        "Per-AMC quarterly AAUM extracted via the AMFI Average AUM disclosure form. Each row carries source + fetchedAt provenance. Only AMCs with explicit AMFI_NAME_TO_SLUG mapping are retained.",
    },
    rows: outRows,
  };
  await writeSnapshot("amc-aaum-quarterly.json", snapshot);
  info("wrote amc-aaum-quarterly.json");
}
