/**
 * Build the MFs Portfolio Tracker's data layer entirely from AMC-direct monthly
 * disclosures (public/amc-holdings/<slug>.json), replacing the RupeeVest feed.
 *
 * Emits, keyed by a resolved tracker `schemecode`:
 *   - src/data/portfolio-tracker/amc-direct-index.json  — the picker directory
 *     (fund houses + schemes selectable in the scheme-wise tracker).
 *   - public/holdings-direct/<code>.json  — a FundPortfolio-shaped month-over-
 *     month EQUITY view (what the Overview / Head-to-head / Returns tabs fetch).
 *   - public/amc-portfolio/<code>.json  — the full all-asset-class disclosure
 *     panel (what the Holdings tab's AmcDisclosurePanel fetches).
 *   - src/data/portfolio-tracker/amc-portfolio-crosswalk.json  — schemecode →
 *     disclosure ref, so AmcDisclosurePanel can resolve availability.
 *
 * Scheme codes come from the AMFI/master registry (rupeevest-scheme-list.json)
 * so Returns/Ratios/NAV joins keep working for schemes it covers; a scheme with
 * no registry match gets a stable synthetic `d-<slug>-<n>` code (holdings still
 * show; returns simply have nothing to join to).
 *
 * Run: npx tsx scripts/build-amc-direct-tracker.ts
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HOLDINGS_DIR = path.join(ROOT, "public/amc-holdings");
const TRACKER_INDEX = path.join(ROOT, "src/data/portfolio-tracker/index.json");
const MASTER = path.join(ROOT, "rupeevest-scheme-list.json");
const OUT_DIR_INDEX = path.join(ROOT, "src/data/portfolio-tracker/amc-direct-index.json");
const OUT_CROSSWALK = path.join(ROOT, "src/data/portfolio-tracker/amc-portfolio-crosswalk.json");
const OUT_HOLDINGS = path.join(ROOT, "public/holdings-direct");
const OUT_PANELS = path.join(ROOT, "public/amc-portfolio");

type AssetClass = "Equity" | "Debt" | "Cash & equiv" | "Gold" | "Silver" | "Other";
const ASSET_ORDER: AssetClass[] = ["Equity", "Debt", "Cash & equiv", "Gold", "Silver", "Other"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface AmcHolding { isin: string | null; name: string; industry: string | null; quantity: number | null; marketValueCr: number | null; pctToNav: number | null }
interface AmcScheme { schemeName: string; schemeCode?: string | null; asOf: string | null; holdings: AmcHolding[] }
interface MonthSnap { asOfMonth: string; asOf: string | null; schemes: AmcScheme[] }
interface AmcSnapshot { amc: string; amcSlug: string; sourceUrl?: string; asOfMonth: string; fetchedAt: string; schemes: AmcScheme[]; history?: MonthSnap[] }

function classifyHolding(h: AmcHolding): AssetClass {
  const name = (h.name || "").toLowerCase();
  const ind = (h.industry || "").toLowerCase();
  const isin = (h.isin || "").toUpperCase();
  const hay = `${name} ${ind}`;
  if (/\bsilver\b/.test(hay)) return "Silver";
  if (/\bgold\b/.test(hay)) return "Gold";
  if (/\b(treps?|repo|reverse repo|cblo|net receivab|net payab|net current asset|current asset|cash|clearing corporation|margin|deposit|call money)\b/.test(name)) return "Cash & equiv";
  if (/\b(aaa|aa\+?|aa-|a1\+?|a\+?|sov|sovereign|crisil|icra|care|ind a|fitch|brickwork)\b/.test(ind)) return "Debt";
  if (/\b(government of india|govt of india|g[- ]?sec|gsec|state development loan|\bsdl\b|treasury bill|t[- ]?bill|gilt|bond|debenture|\bncd\b|commercial paper|certificate of deposit|floating rate note|zero coupon|strips)\b/.test(name)) return "Debt";
  if (/^INF/.test(isin)) return "Other";
  if (/^INE/.test(isin)) return "Equity";
  return "Other";
}

/** Normalize a scheme name to comparable tokens for registry matching. */
function normName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(reg|dir|direct|growth|idcw|payout|reinvest(ment)?|plan|option|mutual|fund|scheme|the|of)\b/g, " ")
    .replace(/\b(mid|large|small|flexi|multi|micro) cap\b/g, "$1cap")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rough classification inferred from the scheme name when the registry has none. */
function inferClassification(name: string): string | null {
  const n = name.toLowerCase();
  if (/\bliquid\b/.test(n)) return "Debt : Liquid";
  if (/\bovernight\b/.test(n)) return "Debt : Overnight";
  if (/\barbitrage\b/.test(n)) return "Hybrid : Arbitrage";
  if (/\b(gilt|g-?sec|bond|duration|debt|money market|credit risk|banking and psu)\b/.test(n)) return "Debt";
  if (/\bbalanced advantage|dynamic asset\b/.test(n)) return "Hybrid : Dynamic Asset Allocation";
  if (/\b(hybrid|multi asset|equity savings)\b/.test(n)) return "Hybrid";
  if (/\bflexi ?cap\b/.test(n)) return "Equity : Flexi Cap";
  if (/\blarge ?cap\b/.test(n)) return "Equity : Large Cap";
  if (/\bmid ?cap\b/.test(n)) return "Equity : Mid Cap";
  if (/\bsmall ?cap\b/.test(n)) return "Equity : Small Cap";
  if (/\bmulti ?cap\b/.test(n)) return "Equity : Multi Cap";
  if (/\belss|tax saver\b/.test(n)) return "Equity : ELSS";
  if (/\betf\b/.test(n)) return "Equity : ETFs";
  if (/\bindex\b/.test(n)) return "Equity : Index";
  if (/\bfund of fund|fof\b/.test(n)) return "Other : FoF";
  return null;
}

const fmtIndian = (n: number): string => {
  const s = Math.round(n).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
};

function main() {
  const master = (JSON.parse(fs.readFileSync(MASTER, "utf8")).schemes as { schemecode: string; name: string }[]);
  const idx = (JSON.parse(fs.readFileSync(TRACKER_INDEX, "utf8")).funds as { schemecode: string; name: string; fundName: string | null; classification: string | null }[]);

  // Registry lookups: normalized name → {code, classification}. Prefer the tracker
  // index (has classification) then the broader master (code only).
  const byNorm = new Map<string, { code: string; classification: string | null }>();
  for (const m of master) { const k = normName(m.name); if (k && !byNorm.has(k)) byNorm.set(k, { code: m.schemecode, classification: null }); }
  for (const f of idx) { const k = normName(f.fundName ?? f.name); if (k) byNorm.set(k, { code: f.schemecode, classification: f.classification }); }

  const dirFunds: Record<string, unknown>[] = [];
  const crosswalkEntries: Record<string, unknown> = {};
  const usedCodes = new Set<string>();
  fs.mkdirSync(OUT_HOLDINGS, { recursive: true });
  fs.mkdirSync(OUT_PANELS, { recursive: true });

  let schemeCount = 0;
  const amcSet = new Set<string>();

  for (const file of fs.readdirSync(HOLDINGS_DIR)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const snap = JSON.parse(fs.readFileSync(path.join(HOLDINGS_DIR, file), "utf8")) as AmcSnapshot;
    if (!snap.schemes?.length) continue;

    // All months for this AMC, newest-first: latest + history.
    const monthBuckets: MonthSnap[] = [
      { asOfMonth: snap.asOfMonth, asOf: snap.schemes[0]?.asOf ?? null, schemes: snap.schemes },
      ...(snap.history ?? []),
    ];

    // Group each scheme's per-month snapshots by scheme name.
    const bySchemeName = new Map<string, { asOf: string | null; monthKey: string; monthLabel: string; holdings: AmcHolding[] }[]>();
    for (const mb of monthBuckets) {
      const asOf = mb.schemes[0]?.asOf ?? mb.asOf;
      const key = (asOf ?? "").slice(0, 7) || mb.asOfMonth;
      for (const sc of mb.schemes) {
        if (!bySchemeName.has(sc.schemeName)) bySchemeName.set(sc.schemeName, []);
        bySchemeName.get(sc.schemeName)!.push({ asOf: sc.asOf ?? asOf, monthKey: (sc.asOf ?? asOf ?? "").slice(0, 7) || key, monthLabel: mb.asOfMonth, holdings: sc.holdings });
      }
    }

    let localIdx = 0;
    for (const [schemeName, monthsRaw] of bySchemeName) {
      localIdx++;
      // Skip schemes whose "name" is really an unparsed sheet code (e.g. BSLMTP,
      // HDFCTS, NIFTYETF) — all-caps/alnum with no spaces. Not a human name.
      if (/^[A-Z0-9]{3,}$/.test(schemeName.trim())) continue;
      // Resolve a stable schemecode.
      const hit = byNorm.get(normName(schemeName));
      let code = hit?.code;
      if (!code || usedCodes.has(code)) code = code && !usedCodes.has(code) ? code : `d-${snap.amcSlug}-${localIdx}`;
      usedCodes.add(code);
      const classification = hit?.classification ?? inferClassification(schemeName);

      // Dedup months by key, newest-first.
      const seen = new Set<string>();
      const months = monthsRaw
        .filter((m) => { if (seen.has(m.monthKey)) return false; seen.add(m.monthKey); return true; })
        .sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1))
        .slice(0, 12);
      if (!months.length) continue;

      // ---- FundPortfolio (equity month-over-month) → holdings-direct/<code>.json
      // No Indian MF scheme exceeds ~₹5 lakh cr; a larger sum means the source
      // market-value column was mis-scaled (a few AMCs quote rupees, not crores)
      // — null it out so garbage AUM never drives the sort or the header.
      const plausibleAum = (v: number): number | null => (v > 0 && v < 1_000_000 ? Math.round(v * 100) / 100 : null);
      const fpMonths = months.map((m) => {
        const [y, mo] = m.monthKey.split("-");
        const label = y && mo ? `${MON3[+mo - 1]}-${y.slice(2)}` : m.monthLabel;
        const aumCr = plausibleAum(m.holdings.reduce((s, h) => s + (h.marketValueCr ?? 0), 0));
        return { key: m.monthKey, slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""), label, aumCr };
      });
      // equity rows aligned across months, keyed by ISIN/name
      // A weight outside [0,100] is a mis-parsed cell (e.g. a market value that
      // landed in the %-to-NAV column) — drop it rather than surface garbage.
      const okPct = (p: number | null): number | null => (p != null && p >= 0 && p <= 100 ? p : null);
      const rowMap = new Map<string, { company_name: string; fincode: string; byKey: Map<string, { pct: number | null; shares: number | null }> }>();
      for (const m of months) {
        for (const h of m.holdings) {
          if (classifyHolding(h) !== "Equity") continue;
          const rk = h.isin ? h.isin.toUpperCase() : "n:" + h.name.toLowerCase().trim();
          if (!rowMap.has(rk)) rowMap.set(rk, { company_name: h.name, fincode: h.isin || rk, byKey: new Map() });
          rowMap.get(rk)!.byKey.set(m.monthKey, { pct: okPct(h.pctToNav), shares: h.quantity });
        }
      }
      const rows = [...rowMap.values()].map((r) => {
        const monthsCell: Record<string, unknown> = {};
        fpMonths.forEach((fm, i) => {
          const cur = r.byKey.get(fm.key);
          const older = fpMonths[i + 1] ? r.byKey.get(fpMonths[i + 1].key) : undefined;
          let arrow = "flat/none";
          if (older && cur && cur.shares != null && older.shares != null) arrow = cur.shares > older.shares ? "up" : cur.shares < older.shares ? "down" : "flat/none";
          monthsCell[fm.slug] = {
            aum_pct_raw: cur?.pct != null ? String(cur.pct) : "-",
            aum_pct_num: cur?.pct ?? null,
            shares_raw: cur?.shares != null ? fmtIndian(cur.shares) : "-",
            shares_num: cur?.shares ?? null,
            arrow: i === fpMonths.length - 1 ? "flat/none" : arrow,
            arrow_raw: null,
          };
        });
        return { company_name: r.company_name, fincode: r.fincode, months: monthsCell };
      }).sort((a, b) => ((b.months[fpMonths[0].slug] as { aum_pct_num: number | null })?.aum_pct_num ?? -1) - ((a.months[fpMonths[0].slug] as { aum_pct_num: number | null })?.aum_pct_num ?? -1));

      const aumTotalCr = fpMonths[0].aumCr;
      const fundPortfolio = {
        meta: {
          fund: schemeName, schemecode: code, classification,
          aumTotalCr, aumAsOf: months[0].asOf, scrapedAt: snap.fetchedAt,
          source: snap.sourceUrl ?? "", section: "Equity Holdings",
          months: fpMonths.map((m) => ({ label: m.label, aumCr: m.aumCr })),
        },
        rows,
      };
      fs.writeFileSync(path.join(OUT_HOLDINGS, `${code}.json`), JSON.stringify(fundPortfolio) + "\n", "utf8");

      // ---- disclosure panel (all asset classes) → amc-portfolio/<code>.json
      const panelMonths = months.map((m) => {
        const alloc = new Map<AssetClass, number>();
        let coverage = 0;
        for (const h of m.holdings) { const c = classifyHolding(h); const p = h.pctToNav ?? 0; alloc.set(c, (alloc.get(c) ?? 0) + p); coverage += p; }
        return { key: m.monthKey, label: m.monthLabel, coveragePct: Math.round(coverage * 100) / 100, fetchedAt: snap.fetchedAt, allocation: ASSET_ORDER.map((c) => ({ class: c, pct: Math.round((alloc.get(c) ?? 0) * 100) / 100 })).filter((s) => s.pct > 0.005) };
      });
      const panelRowMap = new Map<string, { name: string; isin: string | null; industry: string | null; assetClass: AssetClass; months: Record<string, { pctToNav: number | null; marketValueCr: number | null }> }>();
      for (const m of months) {
        for (const h of m.holdings) {
          const rk = h.isin ? h.isin.toUpperCase() : "n:" + h.name.toLowerCase().trim();
          if (!panelRowMap.has(rk)) panelRowMap.set(rk, { name: h.name, isin: h.isin, industry: h.industry, assetClass: classifyHolding(h), months: {} });
          panelRowMap.get(rk)!.months[m.monthKey] = { pctToNav: h.pctToNav, marketValueCr: h.marketValueCr };
        }
      }
      const panel = {
        schemecode: code, amc: snap.amc, amcSlug: snap.amcSlug, amcSchemeName: schemeName,
        amcSchemeCode: "", sourceUrl: snap.sourceUrl ?? "", confidence: hit ? "exact" : "high",
        months: panelMonths,
        rows: [...panelRowMap.values()].sort((a, b) => (b.months[panelMonths[0].key]?.pctToNav ?? -1) - (a.months[panelMonths[0].key]?.pctToNav ?? -1)),
      };
      fs.writeFileSync(path.join(OUT_PANELS, `${code}.json`), JSON.stringify(panel) + "\n", "utf8");

      // ---- directory entry + crosswalk ref
      dirFunds.push({ schemecode: code, name: schemeName, fundName: schemeName, classification, aumTotalCr, rowCount: rows.length, file: `holdings-direct/${code}.json`, amcSlug: snap.amcSlug });
      crosswalkEntries[code] = { amcSlug: snap.amcSlug, amcSchemeName: schemeName, asOfMonth: months[0].monthLabel, holdings: panel.rows.length, confidence: hit ? "exact" : "high" };
      schemeCount++;
      amcSet.add(snap.amcSlug);
    }
  }

  dirFunds.sort((a, b) => (b.aumTotalCr as number ?? 0) - (a.aumTotalCr as number ?? 0));
  fs.writeFileSync(OUT_DIR_INDEX, JSON.stringify({ meta: { generatedAt: "static", source: "AMC-direct SEBI monthly disclosures", schemes: dirFunds.length }, funds: dirFunds }) + "\n", "utf8");
  fs.writeFileSync(OUT_CROSSWALK, JSON.stringify({ meta: { generatedAt: "static", source: "AMC-direct", trackerSchemes: schemeCount }, entries: crosswalkEntries }) + "\n", "utf8");
  console.log(`AMC-direct tracker: ${schemeCount} schemes across ${amcSet.size} AMCs → amc-direct-index.json + holdings-direct/ + amc-portfolio/ + crosswalk`);
}

main();
