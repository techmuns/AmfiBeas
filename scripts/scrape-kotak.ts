/**
 * ONE-OFF throwaway scraper (not part of the ingest pipeline).
 *
 * Renders RupeeVest's Mutual Fund Portfolio Tracker in headless Chromium,
 * selects a single fund, and extracts its EQUITY HOLDINGS table:
 *   company name + per-month { % of AUM, No. of Shares, change arrow }.
 *
 * The container Claude runs in cannot reach rupeevest.com (network
 * allowlist), so this is executed on a GitHub Actions runner, which has
 * open internet. It ALWAYS dumps rich diagnostics (full page HTML, the
 * equity-table HTML, a screenshot, a step log) under ./scrape-debug so the
 * parse can be re-done locally with cheerio if the in-CI parse is imperfect.
 *
 * Runs best-effort and exits 0 even on partial failure, so the workflow
 * still commits the diagnostics.
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const FUND = process.env.FUND_NAME ?? "Kotak Arbitrage Fund(G)";
const PAGE_URL = "https://www.rupeevest.com/Mutual-Fund-Portfolio-Tracker";
const OUT_DIR = process.cwd();
const DEBUG_DIR = path.join(OUT_DIR, "scrape-debug");
const CSV_FILE = path.join(OUT_DIR, "kotak-arbitrage-fund-g-equity-holdings.csv");
const JSON_FILE = path.join(OUT_DIR, "kotak-arbitrage-fund-g-equity-holdings.json");

fs.mkdirSync(DEBUG_DIR, { recursive: true });
const logLines: string[] = [];
function L(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}
function dump(name: string, content: string) {
  fs.writeFileSync(path.join(DEBUG_DIR, name), content);
  L(`dumped scrape-debug/${name} (${content.length} bytes)`);
}

// ---------- value / arrow normalization (run in Node) ----------
function slugMonth(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function parsePct(raw: string): number | null {
  const c = raw.replace(/[%,\s₹]/g, "");
  if (!c) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}
function parseShares(raw: string): number | null {
  const c = raw.replace(/[,\s₹]/g, "");
  if (!c || !/\d/.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}
type Arrow = "up" | "down" | "flat/none" | "missing" | "unknown";
function normalizeArrow(cellHtml: string, cellText: string): { arrow: Arrow; raw: string | null } {
  const h = cellHtml.toLowerCase();
  const hasUpChar = /[▲▴↑⬆]/.test(cellText) || /[▲▴↑⬆]/.test(cellHtml);
  const hasDownChar = /[▼▾↓⬇]/.test(cellText) || /[▼▾↓⬇]/.test(cellHtml);
  const upClass = /(caret-up|arrow-up|fa-(caret|arrow|sort)-up|triangle-up|text-success|text-green|increase|positive|green|up-arrow|\bup\b)/.test(h);
  const downClass = /(caret-down|arrow-down|fa-(caret|arrow|sort)-down|triangle-down|text-danger|text-red|decrease|negative|\bred\b|down-arrow|\bdown\b)/.test(h);
  const hasIndicatorMarkup = /<(i|span|svg|img)/.test(h);

  // Capture the raw indicator snippet for the JSON when there is markup.
  const rawSnippet = hasIndicatorMarkup ? cellHtml.trim().slice(0, 400) : null;

  if (hasUpChar || (upClass && !downClass)) return { arrow: "up", raw: rawSnippet };
  if (hasDownChar || (downClass && !upClass)) return { arrow: "down", raw: rawSnippet };

  const txt = cellText.trim();
  if (txt === "" || txt === "-" || txt === "—" || txt.toLowerCase() === "na") {
    return { arrow: "missing", raw: rawSnippet };
  }
  // A value is present but no directional indicator was found.
  if (!hasIndicatorMarkup) return { arrow: "flat/none", raw: null };
  return { arrow: "unknown", raw: rawSnippet };
}

// ---------- DOM extraction (run in browser) ----------
interface RawTable {
  label: string | null;
  outerHTML: string;
  headerRows: string[][]; // each header row's cell texts
  bodyRows: { cells: { text: string; html: string }[] }[];
}
async function extractTables(page: Page): Promise<RawTable[]> {
  return page.evaluate(() => {
    function prevInOrder(node: Element): Element | null {
      if (node.previousElementSibling) {
        let n: Element = node.previousElementSibling;
        while (n.lastElementChild) n = n.lastElementChild;
        return n;
      }
      return node.parentElement;
    }
    function precedingHeading(table: Element): string | null {
      let cur = prevInOrder(table);
      let steps = 0;
      while (cur && steps < 600) {
        const txt = (cur.textContent ?? "").replace(/\s+/g, " ").trim();
        if (txt.length > 0 && txt.length < 60 && /(equity|debt|other|derivative|money market).{0,30}holdings/i.test(txt)) {
          return txt;
        }
        cur = prevInOrder(cur);
        steps++;
      }
      return null;
    }
    const tables = Array.from(document.querySelectorAll("table"));
    return tables
      .map((t) => {
        const headerRows: string[][] = [];
        const thead = t.querySelector("thead");
        const headerTrs = thead
          ? Array.from(thead.querySelectorAll("tr"))
          : Array.from(t.querySelectorAll("tr")).slice(0, 2);
        for (const tr of headerTrs) {
          headerRows.push(
            Array.from(tr.querySelectorAll("th,td")).map((c) =>
              (c.textContent ?? "").replace(/\s+/g, " ").trim()
            )
          );
        }
        const tbody = t.querySelector("tbody") ?? t;
        const bodyTrs = Array.from(tbody.querySelectorAll("tr")).filter(
          (tr) => !thead || !thead.contains(tr)
        );
        const bodyRows = bodyTrs.map((tr) => ({
          cells: Array.from(tr.querySelectorAll("td,th")).map((c) => ({
            text: (c.textContent ?? "").replace(/\s+/g, " ").trim(),
            html: (c as HTMLElement).innerHTML,
          })),
        }));
        return {
          label: precedingHeading(t),
          outerHTML: t.outerHTML,
          headerRows,
          bodyRows,
        };
      })
      .filter((t) => t.bodyRows.length > 0);
  });
}

// Pick the equity holdings table among candidates.
function pickEquityTable(tables: RawTable[]): RawTable | null {
  const looksLikeHoldings = (t: RawTable) =>
    t.headerRows.some((r) => r.some((c) => /%\s*of\s*aum/i.test(c))) ||
    t.headerRows.some((r) => r.some((c) => /no\.?\s*of\s*shares/i.test(c)));
  const candidates = tables.filter(looksLikeHoldings);
  const equity = candidates.find((t) => t.label && /equity/i.test(t.label));
  if (equity) return equity;
  // Fallback: first holdings-like table that is NOT labelled debt/other.
  const notDebt = candidates.find((t) => !t.label || !/debt|other|derivative|money market/i.test(t.label));
  return notDebt ?? candidates[0] ?? null;
}

// Build month columns from the header rows.
// Header has a month row (Apr-26 / Mar-26 ...) each spanning two sub-columns
// (% of AUM, No. of Shares), and a sub-header row. We map body columns by
// position: col0 = company, then pairs (pct, shares) per month.
function deriveMonths(table: RawTable): string[] {
  const monthRe = /^[A-Za-z]{3,9}[\s\-'’]+\d{2,4}$/;
  for (const row of table.headerRows) {
    const months = row.filter((c) => monthRe.test(c.trim()));
    if (months.length >= 1) return months.map((m) => m.trim());
  }
  // Fallback: scan all header cells.
  const flat = table.headerRows.flat().filter((c) => monthRe.test(c.trim()));
  return flat.map((m) => m.trim());
}

interface OutRow {
  company_name: string;
  months: Record<
    string,
    {
      aum_pct_raw: string;
      aum_pct_num: number | null;
      shares_raw: string;
      shares_num: number | null;
      arrow: Arrow;
      arrow_raw: string | null;
    }
  >;
}

function buildRows(table: RawTable, months: string[]): OutRow[] {
  const out: OutRow[] = [];
  for (const br of table.bodyRows) {
    if (br.cells.length < 2) continue;
    const company = br.cells[0].text;
    if (!company || /^(total|grand total)/i.test(company)) continue;
    // Heuristic: data cells after company come in (pct, shares) pairs per month.
    const dataCells = br.cells.slice(1);
    const row: OutRow = { company_name: company, months: {} };
    months.forEach((m, i) => {
      const pctCell = dataCells[i * 2];
      const sharesCell = dataCells[i * 2 + 1];
      const slug = slugMonth(m);
      const aumRaw = pctCell?.text ?? "";
      const shRaw = sharesCell?.text ?? "";
      // Arrow usually rides the shares cell; fall back to the pct cell.
      const aShares = sharesCell ? normalizeArrow(sharesCell.html, sharesCell.text) : null;
      const aPct = pctCell ? normalizeArrow(pctCell.html, pctCell.text) : null;
      let arrow: Arrow = "missing";
      let arrowRaw: string | null = null;
      for (const cand of [aShares, aPct]) {
        if (cand && (cand.arrow === "up" || cand.arrow === "down")) {
          arrow = cand.arrow;
          arrowRaw = cand.raw;
          break;
        }
      }
      if (arrow === "missing") {
        const fallback = aShares ?? aPct;
        if (fallback) {
          arrow = fallback.arrow;
          arrowRaw = fallback.raw;
        }
      }
      row.months[slug] = {
        aum_pct_raw: aumRaw,
        aum_pct_num: parsePct(aumRaw),
        shares_raw: shRaw,
        shares_num: parseShares(shRaw),
        arrow,
        arrow_raw: arrowRaw,
      };
    });
    out.push(row);
  }
  return out;
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
function writeCsv(rows: OutRow[], months: string[]): void {
  const slugs = months.map(slugMonth);
  const header = ["company_name"];
  for (const s of slugs) {
    header.push(
      `${s}_aum_pct_raw`,
      `${s}_aum_pct_num`,
      `${s}_shares_raw`,
      `${s}_shares_num`,
      `${s}_arrow`
    );
  }
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const cells = [r.company_name];
    for (const s of slugs) {
      const m = r.months[s];
      cells.push(
        m?.aum_pct_raw ?? "",
        m?.aum_pct_num != null ? String(m.aum_pct_num) : "",
        m?.shares_raw ?? "",
        m?.shares_num != null ? String(m.shares_num) : "",
        m?.arrow ?? ""
      );
    }
    lines.push(cells.map(csvEscape).join(","));
  }
  fs.writeFileSync(CSV_FILE, lines.join("\n") + "\n");
  L(`wrote ${CSV_FILE} (${rows.length} data rows)`);
}

async function trySelectFund(page: Page): Promise<boolean> {
  // Enumerate inputs for diagnostics.
  const inputs = await page.$$eval("input", (els) =>
    els.map((e, i) => ({
      i,
      id: (e as HTMLInputElement).id,
      name: (e as HTMLInputElement).name,
      type: (e as HTMLInputElement).type,
      placeholder: (e as HTMLInputElement).placeholder,
      cls: e.className,
      visible: !!(e as HTMLElement).offsetParent,
    }))
  );
  dump("inputs.json", JSON.stringify(inputs, null, 2));

  // Candidate fund-search inputs: prefer placeholders/ids hinting fund/scheme,
  // excluding the top-nav "Search mutual funds here..." box.
  const ranked = inputs
    .filter((x) => x.visible && (x.type === "text" || x.type === "search" || !x.type))
    .filter((x) => !/search mutual funds here/i.test(x.placeholder ?? ""))
    .sort((a, b) => {
      const score = (x: typeof a) =>
        (/fund|scheme|portfolio/i.test(`${x.id} ${x.name} ${x.placeholder} ${x.cls}`) ? 2 : 0) +
        (/search/i.test(`${x.id} ${x.name} ${x.placeholder}`) ? 1 : 0);
      return score(b) - score(a);
    });
  L(`fund-input candidates (ranked): ${JSON.stringify(ranked.map((r) => r.i))}`);

  const order = [...ranked.map((r) => r.i)];
  for (const idx of order) {
    try {
      const input = page.locator("input").nth(idx);
      await input.scrollIntoViewIfNeeded({ timeout: 5000 });
      await input.click({ timeout: 5000 });
      await input.fill("");
      await input.type(FUND, { delay: 60 });
      L(`typed fund into input #${idx}; waiting for suggestions`);
      await page.waitForTimeout(2000);
      dump(`after-type-input-${idx}.html`, await page.content());

      // Try to click an autocomplete suggestion matching the fund.
      const suggSelectors = [
        ".ui-menu-item",
        ".autocomplete-suggestion",
        ".tt-suggestion",
        ".typeahead .dropdown-menu li",
        ".dropdown-menu li",
        "ul li a",
        "li",
      ];
      for (const sel of suggSelectors) {
        const sugg = page.locator(sel, { hasText: /Kotak Arbitrage/i }).first();
        if ((await sugg.count()) > 0) {
          await sugg.click({ timeout: 4000 });
          L(`clicked suggestion via selector "${sel}"`);
          await page.waitForTimeout(2500);
          return true;
        }
      }
      // No suggestion list found — try pressing Enter to submit.
      await input.press("Enter");
      L(`pressed Enter on input #${idx}`);
      await page.waitForTimeout(2500);
      // Heuristic success check: page now mentions the fund near "Fund Name".
      const hasFund = await page
        .locator(`text=/Kotak Arbitrage/i`)
        .first()
        .count();
      if (hasFund > 0) return true;
    } catch (e) {
      L(`input #${idx} attempt failed: ${(e as Error).message}`);
    }
  }
  return false;
}

async function tryDownload(page: Page): Promise<void> {
  try {
    const dl = page.locator("a,button", { hasText: /^\s*download\s*$/i }).first();
    if ((await dl.count()) === 0) {
      L("no Download button found");
      return;
    }
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      dl.click(),
    ]);
    const suggested = download.suggestedFilename();
    const dest = path.join(DEBUG_DIR, `download-${suggested || "file"}`);
    await download.saveAs(dest);
    L(`saved site download -> ${dest}`);
  } catch (e) {
    L(`download attempt failed/skipped: ${(e as Error).message}`);
  }
}

async function main() {
  L(`fund="${FUND}"  url=${PAGE_URL}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  const page = await ctx.newPage();
  let ok = false;
  try {
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);
    dump("page-initial.html", await page.content());
    await page.screenshot({ path: path.join(DEBUG_DIR, "page-initial.png"), fullPage: true });

    const selected = await trySelectFund(page);
    L(`fund selection reported: ${selected}`);

    // Wait for an Equity Holdings table to populate (best-effort).
    try {
      await page.waitForSelector("text=/Equity Holdings/i", { timeout: 20000 });
    } catch {
      L("did not see 'Equity Holdings' heading within timeout");
    }
    await page.waitForTimeout(2500);

    dump("page-after-select.html", await page.content());
    await page.screenshot({ path: path.join(DEBUG_DIR, "page-after-select.png"), fullPage: true });

    await tryDownload(page);

    const tables = await extractTables(page);
    L(`found ${tables.length} non-empty tables; labels=${JSON.stringify(tables.map((t) => t.label))}`);
    const equity = pickEquityTable(tables);
    if (!equity) {
      L("could not identify an Equity Holdings table");
    } else {
      dump("equity-table.html", equity.outerHTML);
      dump("equity-table-structured.json", JSON.stringify(equity, null, 2));
      const months = deriveMonths(equity);
      L(`derived months: ${JSON.stringify(months)}`);
      if (months.length > 0) {
        const rows = buildRows(equity, months);
        L(`built ${rows.length} equity rows`);
        if (rows.length > 0) {
          const payload = {
            meta: {
              source: PAGE_URL,
              fund: FUND,
              scrapedAt: new Date().toISOString(),
              months,
              extractionMethod: "dom",
              note:
                "One-off scrape via GitHub Actions. Arrows normalized to up/down/flat-none/missing/unknown; arrow_raw holds source markup where ambiguous.",
            },
            rows,
          };
          fs.writeFileSync(JSON_FILE, JSON.stringify(payload, null, 2) + "\n");
          L(`wrote ${JSON_FILE}`);
          writeCsv(rows, months);
          ok = true;
        }
      }
    }
  } catch (e) {
    L(`FATAL during scrape: ${(e as Error).stack ?? (e as Error).message}`);
  } finally {
    dump("log.txt", logLines.join("\n") + "\n");
    await browser.close();
  }
  L(ok ? "SUCCESS: data files written" : "PARTIAL: see scrape-debug for diagnostics");
  // Always exit 0 so the workflow commits diagnostics.
  process.exit(0);
}

main();
