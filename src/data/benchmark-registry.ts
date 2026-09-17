/**
 * Canonical benchmark-index registry + conservative alias resolver.
 *
 * Official AMC documents spell the same index a dozen ways — "NIFTY Midcap 150
 * TRI", "Nifty Midcap 150 Total Return Index", "NIFTY MIDCAP 150 TRI". They all
 * mean one index, so they must collapse onto one canonical key
 * (`NIFTY_MIDCAP_150`) before anything downstream can join a benchmark return
 * to a scheme.
 *
 * The resolver is deliberately EXACT, never fuzzy. Indian index names differ by
 * a single qualifier and mean genuinely different things:
 *
 *     NIFTY 500            ≠  NIFTY 500 Multicap 50:25:25
 *     NIFTY 100            ≠  NIFTY 100 Equal Weight
 *     NIFTY 200            ≠  NIFTY 200 Momentum 30
 *
 * so a name only resolves when its normalized form is an exact member of a
 * canonical entry's alias set. Anything else returns null and the scheme stays
 * `official-name-only` (identity kept, return withheld) rather than being
 * silently attached to a near-neighbour index.
 *
 * `returnSupport` records whether the benchmark-return engine
 * (scripts/build-benchmark-tri.ts) can actually produce a number for the index:
 * NSE indices reachable through the `ind_close_all` pipeline are "nse-ind-close-all";
 * everything else (BSE, CRISIL, ICRA, MSCI, blended debt/hybrid indices) is
 * "unsupported" — we keep the official NAME and return null rather than
 * substituting a convenient Nifty proxy.
 *
 * Pure data + pure functions: imported by both the build scripts and the
 * runtime API, so no I/O lives here.
 */

/** How a benchmark's level is quoted. */
export type BenchmarkBasis = "TRI" | "PRI" | "unknown";

/** Whether the return engine can compute a return for this index. */
export type BenchmarkReturnSupport =
  /** Resolvable from NSE's daily `ind_close_all` CSV (price close + div yield). */
  | "nse-ind-close-all"
  /** Identity known, but no automated first-party level source we trust. */
  | "unsupported";

export interface CanonicalBenchmark {
  /** Stable machine key, e.g. "NIFTY_MIDCAP_150". */
  key: string;
  /** Canonical display name (basis-neutral — the basis is per scheme). */
  name: string;
  /** Index provider / owner. */
  provider: string;
  /** Basis the index family is normally quoted in by AMC documents. */
  defaultBasis: BenchmarkBasis;
  /** Extra spellings beyond `name` (normalized on load; case/spacing-insensitive). */
  aliases: string[];
  /** Exact "Index Name" values as they appear in NSE's ind_close_all CSV. */
  nseIndexNames?: string[];
  returnSupport: BenchmarkReturnSupport;
}

const NSE = "NSE Indices";
const BSE = "BSE (Asia Index)";
const CRISIL = "CRISIL";
const MSCI = "MSCI";
const OTHER_PROVIDER = "Other / unclassified";

/**
 * The canonical index universe. Entries exist for every index family Indian
 * mutual-fund fact sheets commonly name; `returnSupport` marks which ones the
 * engine can actually price. Adding an entry here never invents a return — it
 * only lets the identity resolve and, for NSE entries, tells the TRI builder
 * which CSV row to read.
 */
export const CANONICAL_BENCHMARKS: CanonicalBenchmark[] = [
  // ---- NSE broad market -----------------------------------------------------
  { key: "NIFTY_50", name: "NIFTY 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 50", "Nifty50", "S&P CNX Nifty", "CNX Nifty"], nseIndexNames: ["Nifty 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_NEXT_50", name: "NIFTY Next 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Next 50", "Nifty Next50", "CNX Nifty Junior", "Nifty Junior"], nseIndexNames: ["Nifty Next 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_100", name: "NIFTY 100", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 100", "Nifty100"], nseIndexNames: ["Nifty 100"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_200", name: "NIFTY 200", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 200", "Nifty200"], nseIndexNames: ["Nifty 200"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_500", name: "NIFTY 500", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 500", "Nifty500", "S&P CNX 500", "CNX 500"], nseIndexNames: ["Nifty 500"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_TOTAL_MARKET", name: "NIFTY Total Market", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Total Market"], nseIndexNames: ["Nifty Total Market"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_500_MULTICAP_50_25_25", name: "NIFTY 500 Multicap 50:25:25", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty500 Multicap 50:25:25", "Nifty 500 Multicap 50:25:25", "NIFTY500 Multicap 50 25 25", "Nifty 500 Multicap 502525"], nseIndexNames: ["Nifty500 Multicap 50:25:25"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_LARGEMIDCAP_250", name: "NIFTY LargeMidcap 250", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty LargeMidcap 250", "Nifty Large Midcap 250", "NIFTY LargeMidcap250"], nseIndexNames: ["NIFTY LargeMidcap 250", "Nifty LargeMidcap 250"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MIDSMALLCAP_400", name: "NIFTY MidSmallcap 400", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty MidSmallcap 400", "Nifty Mid Smallcap 400"], nseIndexNames: ["NIFTY MidSmallcap 400", "Nifty MidSmallcap 400"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MIDCAP_150", name: "NIFTY Midcap 150", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Midcap 150", "Nifty Midcap150", "NIFTY Mid Cap 150"], nseIndexNames: ["Nifty Midcap 150"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MIDCAP_100", name: "NIFTY Midcap 100", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Midcap 100", "Nifty Midcap100", "CNX Midcap"], nseIndexNames: ["Nifty Midcap 100"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MIDCAP_50", name: "NIFTY Midcap 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Midcap 50", "Nifty Midcap50"], nseIndexNames: ["Nifty Midcap 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_SMALLCAP_250", name: "NIFTY Smallcap 250", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Smallcap 250", "Nifty Smallcap250", "NIFTY Small Cap 250"], nseIndexNames: ["Nifty Smallcap 250"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_SMALLCAP_100", name: "NIFTY Smallcap 100", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Smallcap 100", "Nifty Smallcap100"], nseIndexNames: ["Nifty Smallcap 100"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_SMALLCAP_50", name: "NIFTY Smallcap 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Smallcap 50", "Nifty Smallcap50"], nseIndexNames: ["Nifty Smallcap 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MICROCAP_250", name: "NIFTY Microcap 250", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Microcap 250", "Nifty Micro Cap 250"], nseIndexNames: ["Nifty Microcap 250"], returnSupport: "nse-ind-close-all" },

  // ---- NSE strategy / factor ------------------------------------------------
  { key: "NIFTY_50_EQUAL_WEIGHT", name: "NIFTY 50 Equal Weight", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty50 Equal Weight", "Nifty 50 Equal Weight"], nseIndexNames: ["Nifty50 Equal Weight"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_100_EQUAL_WEIGHT", name: "NIFTY 100 Equal Weight", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty100 Equal Weight", "Nifty 100 Equal Weight"], nseIndexNames: ["Nifty100 Equal Weight"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_500_EQUAL_WEIGHT", name: "NIFTY 500 Equal Weight", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty500 Equal Weight", "Nifty 500 Equal Weight"], nseIndexNames: ["Nifty500 Equal Weight"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_50_VALUE_20", name: "NIFTY 50 Value 20", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty50 Value 20", "Nifty 50 Value 20"], nseIndexNames: ["Nifty50 Value 20"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_100_QUALITY_30", name: "NIFTY 100 Quality 30", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty100 Quality 30", "Nifty 100 Quality 30"], nseIndexNames: ["Nifty100 Quality 30"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_100_LOW_VOLATILITY_30", name: "NIFTY 100 Low Volatility 30", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty100 Low Volatility 30", "Nifty 100 Low Volatility 30", "Nifty100 Low Vol 30"], nseIndexNames: ["Nifty100 Low Volatility 30"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_200_MOMENTUM_30", name: "NIFTY 200 Momentum 30", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty200 Momentum 30", "Nifty 200 Momentum 30"], nseIndexNames: ["Nifty200 Momentum 30"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_200_QUALITY_30", name: "NIFTY 200 Quality 30", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty200 Quality 30", "Nifty 200 Quality 30"], nseIndexNames: ["Nifty200 Quality 30"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_ALPHA_50", name: "NIFTY Alpha 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Alpha 50"], nseIndexNames: ["Nifty Alpha 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MIDCAP_150_QUALITY_50", name: "NIFTY Midcap150 Quality 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Midcap150 Quality 50", "Nifty Midcap 150 Quality 50"], nseIndexNames: ["Nifty Midcap150 Quality 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_500_VALUE_50", name: "NIFTY 500 Value 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty500 Value 50", "Nifty 500 Value 50"], nseIndexNames: ["Nifty500 Value 50"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_DIVIDEND_OPPORTUNITIES_50", name: "NIFTY Dividend Opportunities 50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Dividend Opportunities 50"], nseIndexNames: ["Nifty Dividend Opportunities 50"], returnSupport: "nse-ind-close-all" },

  // ---- NSE sectoral / thematic ---------------------------------------------
  { key: "NIFTY_BANK", name: "NIFTY Bank", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Bank", "Bank Nifty", "Nifty Bank Index"], nseIndexNames: ["Nifty Bank"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_FINANCIAL_SERVICES", name: "NIFTY Financial Services", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Financial Services", "Nifty Fin Services"], nseIndexNames: ["Nifty Financial Services"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_PRIVATE_BANK", name: "NIFTY Private Bank", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Private Bank"], nseIndexNames: ["Nifty Private Bank"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_PSU_BANK", name: "NIFTY PSU Bank", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty PSU Bank"], nseIndexNames: ["Nifty PSU Bank"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_IT", name: "NIFTY IT", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty IT", "Nifty Information Technology"], nseIndexNames: ["Nifty IT"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_PHARMA", name: "NIFTY Pharma", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Pharma"], nseIndexNames: ["Nifty Pharma"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_HEALTHCARE", name: "NIFTY Healthcare Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Healthcare", "Nifty Healthcare Index"], nseIndexNames: ["Nifty Healthcare Index"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_AUTO", name: "NIFTY Auto", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Auto"], nseIndexNames: ["Nifty Auto"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_FMCG", name: "NIFTY FMCG", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty FMCG"], nseIndexNames: ["Nifty FMCG"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_METAL", name: "NIFTY Metal", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Metal"], nseIndexNames: ["Nifty Metal"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MEDIA", name: "NIFTY Media", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Media"], nseIndexNames: ["Nifty Media"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_REALTY", name: "NIFTY Realty", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Realty"], nseIndexNames: ["Nifty Realty"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_ENERGY", name: "NIFTY Energy", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Energy"], nseIndexNames: ["Nifty Energy"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_OIL_AND_GAS", name: "NIFTY Oil & Gas", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Oil & Gas", "Nifty Oil and Gas"], nseIndexNames: ["Nifty Oil & Gas"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INFRASTRUCTURE", name: "NIFTY Infrastructure", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Infrastructure", "Nifty Infra"], nseIndexNames: ["Nifty Infrastructure"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_COMMODITIES", name: "NIFTY Commodities", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Commodities"], nseIndexNames: ["Nifty Commodities"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_CONSUMER_DURABLES", name: "NIFTY Consumer Durables", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Consumer Durables"], nseIndexNames: ["Nifty Consumer Durables"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INDIA_CONSUMPTION", name: "NIFTY India Consumption", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty India Consumption"], nseIndexNames: ["Nifty India Consumption"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INDIA_MANUFACTURING", name: "NIFTY India Manufacturing", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty India Manufacturing"], nseIndexNames: ["Nifty India Manufacturing"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INDIA_DEFENCE", name: "NIFTY India Defence", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty India Defence"], nseIndexNames: ["Nifty India Defence"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INDIA_DIGITAL", name: "NIFTY India Digital", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty India Digital"], nseIndexNames: ["Nifty India Digital"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_MNC", name: "NIFTY MNC", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty MNC"], nseIndexNames: ["Nifty MNC"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_PSE", name: "NIFTY PSE", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty PSE"], nseIndexNames: ["Nifty PSE"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_CPSE", name: "NIFTY CPSE", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty CPSE"], nseIndexNames: ["Nifty CPSE"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_SERVICES_SECTOR", name: "NIFTY Services Sector", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Services Sector"], nseIndexNames: ["Nifty Services Sector"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_TRANSPORTATION_AND_LOGISTICS", name: "NIFTY Transportation & Logistics", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Transportation & Logistics", "Nifty Transportation and Logistics"], nseIndexNames: ["Nifty Transportation & Logistics"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INDIA_TOURISM", name: "NIFTY India Tourism", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty India Tourism"], nseIndexNames: ["Nifty India Tourism"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_CAPITAL_MARKETS", name: "NIFTY Capital Markets", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Capital Markets"], nseIndexNames: ["Nifty Capital Markets"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_CORE_HOUSING", name: "NIFTY Core Housing", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Core Housing"], nseIndexNames: ["Nifty Core Housing"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_HOUSING", name: "NIFTY Housing", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Housing"], nseIndexNames: ["Nifty Housing"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_INDIA_RAILWAYS_PSU", name: "NIFTY India Railways PSU", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty India Railways PSU"], nseIndexNames: ["Nifty India Railways PSU"], returnSupport: "nse-ind-close-all" },
  { key: "NIFTY_EV_AND_NEW_AGE_AUTOMOTIVE", name: "NIFTY EV & New Age Automotive", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty EV & New Age Automotive", "Nifty EV and New Age Automotive"], nseIndexNames: ["Nifty EV & New Age Automotive"], returnSupport: "nse-ind-close-all" },

  // ---- NSE debt / hybrid (levels are NOT in ind_close_all) -------------------
  { key: "NIFTY_50_HYBRID_COMPOSITE_DEBT_65_35", name: "NIFTY 50 Hybrid Composite Debt 65:35", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 50 Hybrid Composite Debt 65:35", "NIFTY 50 Hybrid Composite Debt 65 35"], returnSupport: "unsupported" },
  { key: "NIFTY_50_HYBRID_COMPOSITE_DEBT_50_50", name: "NIFTY 50 Hybrid Composite Debt 50:50", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 50 Hybrid Composite Debt 50:50"], returnSupport: "unsupported" },
  { key: "NIFTY_50_HYBRID_COMPOSITE_DEBT_15_85", name: "NIFTY 50 Hybrid Composite Debt 15:85", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 50 Hybrid Composite Debt 15:85"], returnSupport: "unsupported" },
  { key: "NIFTY_EQUITY_SAVINGS", name: "NIFTY Equity Savings", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Equity Savings"], returnSupport: "unsupported" },
  { key: "NIFTY_50_ARBITRAGE", name: "NIFTY 50 Arbitrage", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 50 Arbitrage"], returnSupport: "unsupported" },
  { key: "NIFTY_COMPOSITE_DEBT", name: "NIFTY Composite Debt Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Composite Debt Index", "Nifty Composite Debt"], returnSupport: "unsupported" },
  { key: "NIFTY_SHORT_DURATION_DEBT", name: "NIFTY Short Duration Debt Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Short Duration Debt Index"], returnSupport: "unsupported" },
  { key: "NIFTY_MEDIUM_DURATION_DEBT", name: "NIFTY Medium Duration Debt Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Medium Duration Debt Index"], returnSupport: "unsupported" },
  { key: "NIFTY_LOW_DURATION_DEBT", name: "NIFTY Low Duration Debt Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Low Duration Debt Index"], returnSupport: "unsupported" },
  { key: "NIFTY_ULTRA_SHORT_DURATION_DEBT", name: "NIFTY Ultra Short Duration Debt Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Ultra Short Duration Debt Index"], returnSupport: "unsupported" },
  { key: "NIFTY_MONEY_MARKET", name: "NIFTY Money Market Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Money Market Index"], returnSupport: "unsupported" },
  { key: "NIFTY_LIQUID", name: "NIFTY Liquid Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Liquid Index"], returnSupport: "unsupported" },
  { key: "NIFTY_1D_RATE", name: "NIFTY 1D Rate Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 1D Rate Index"], returnSupport: "unsupported" },
  { key: "NIFTY_ALL_DURATION_GSEC", name: "NIFTY All Duration G-Sec Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty All Duration G-Sec Index"], returnSupport: "unsupported" },
  { key: "NIFTY_CORPORATE_BOND", name: "NIFTY Corporate Bond Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Corporate Bond Index"], returnSupport: "unsupported" },
  { key: "NIFTY_BANKING_AND_PSU_DEBT", name: "NIFTY Banking & PSU Debt Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Banking & PSU Debt Index", "Nifty Banking and PSU Debt Index"], returnSupport: "unsupported" },
  { key: "NIFTY_CREDIT_RISK_BOND", name: "NIFTY Credit Risk Bond Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty Credit Risk Bond Index"], returnSupport: "unsupported" },
  { key: "NIFTY_10_YR_BENCHMARK_GSEC", name: "NIFTY 10 yr Benchmark G-Sec Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 10 yr Benchmark G-Sec", "Nifty 10 yr Benchmark G-Sec Index", "Nifty 10 year Benchmark G-Sec Index"], returnSupport: "unsupported" },
  { key: "NIFTY_5_YR_BENCHMARK_GSEC", name: "NIFTY 5 yr Benchmark G-Sec Index", provider: NSE, defaultBasis: "TRI", aliases: ["Nifty 5 yr Benchmark G-Sec", "Nifty 5 yr Benchmark G-Sec Index", "Nifty 5 year Benchmark G-Sec Index"], returnSupport: "unsupported" },

  // ---- BSE ------------------------------------------------------------------
  { key: "BSE_SENSEX", name: "BSE SENSEX", provider: BSE, defaultBasis: "TRI", aliases: ["BSE Sensex", "S&P BSE Sensex", "Sensex"], returnSupport: "unsupported" },
  { key: "BSE_100", name: "BSE 100", provider: BSE, defaultBasis: "TRI", aliases: ["BSE 100", "S&P BSE 100"], returnSupport: "unsupported" },
  { key: "BSE_200", name: "BSE 200", provider: BSE, defaultBasis: "TRI", aliases: ["BSE 200", "S&P BSE 200"], returnSupport: "unsupported" },
  { key: "BSE_500", name: "BSE 500", provider: BSE, defaultBasis: "TRI", aliases: ["BSE 500", "S&P BSE 500"], returnSupport: "unsupported" },
  { key: "BSE_250_LARGEMIDCAP", name: "BSE 250 LargeMidCap", provider: BSE, defaultBasis: "TRI", aliases: ["BSE 250 LargeMidCap", "S&P BSE 250 LargeMidCap"], returnSupport: "unsupported" },
  { key: "BSE_MIDCAP", name: "BSE MidCap", provider: BSE, defaultBasis: "TRI", aliases: ["BSE MidCap", "S&P BSE MidCap"], returnSupport: "unsupported" },
  { key: "BSE_SMALLCAP", name: "BSE SmallCap", provider: BSE, defaultBasis: "TRI", aliases: ["BSE SmallCap", "S&P BSE SmallCap"], returnSupport: "unsupported" },
  { key: "BSE_INDIA_SECTOR_LEADERS", name: "BSE India Sector Leaders", provider: BSE, defaultBasis: "TRI", aliases: ["BSE India Sector Leaders"], returnSupport: "unsupported" },
  { key: "BSE_TOP_10_BANKS", name: "BSE Top 10 Banks", provider: BSE, defaultBasis: "TRI", aliases: ["BSE Top 10 Banks"], returnSupport: "unsupported" },
  { key: "BSE_HEALTHCARE", name: "BSE Healthcare", provider: BSE, defaultBasis: "TRI", aliases: ["BSE Healthcare", "S&P BSE Healthcare"], returnSupport: "unsupported" },

  // ---- CRISIL (hybrid + debt blends; no public level feed we trust) ---------
  { key: "CRISIL_HYBRID_35_65_AGGRESSIVE", name: "CRISIL Hybrid 35+65 - Aggressive Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Hybrid 35+65 - Aggressive Index", "CRISIL Hybrid 35+65 Aggressive Index", "CRISIL Hybrid 35 65 Aggressive"], returnSupport: "unsupported" },
  { key: "CRISIL_HYBRID_85_15_CONSERVATIVE", name: "CRISIL Hybrid 85+15 - Conservative Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Hybrid 85+15 - Conservative Index", "CRISIL Hybrid 85+15 Conservative Index"], returnSupport: "unsupported" },
  { key: "CRISIL_HYBRID_50_50_MODERATE", name: "CRISIL Hybrid 50+50 - Moderate Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Hybrid 50+50 - Moderate Index", "CRISIL Hybrid 50+50 Moderate Index"], returnSupport: "unsupported" },
  { key: "CRISIL_SHORT_TERM_DEBT_HYBRID_75_25", name: "CRISIL Short Term Debt Hybrid 75+25 Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Short Term Debt Hybrid 75+25 Index"], returnSupport: "unsupported" },
  { key: "CRISIL_EQUITY_SAVINGS", name: "CRISIL Equity Savings Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Equity Savings Index"], returnSupport: "unsupported" },
  { key: "CRISIL_ARBITRAGE", name: "CRISIL Arbitrage Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Arbitrage Index"], returnSupport: "unsupported" },
  { key: "CRISIL_LIQUID_DEBT", name: "CRISIL Liquid Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Liquid Debt Index", "CRISIL Liquid Fund Index"], returnSupport: "unsupported" },
  { key: "CRISIL_OVERNIGHT", name: "CRISIL Overnight Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Overnight Index", "CRISIL Overnight Fund Index"], returnSupport: "unsupported" },
  { key: "CRISIL_ULTRA_SHORT_DURATION_DEBT", name: "CRISIL Ultra Short Duration Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Ultra Short Duration Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_LOW_DURATION_DEBT", name: "CRISIL Low Duration Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Low Duration Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_SHORT_DURATION_DEBT", name: "CRISIL Short Duration Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Short Duration Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_MEDIUM_DURATION_DEBT", name: "CRISIL Medium Duration Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Medium Duration Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_MEDIUM_TO_LONG_DURATION_DEBT", name: "CRISIL Medium to Long Duration Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Medium to Long Duration Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_LONG_DURATION_DEBT", name: "CRISIL Long Duration Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Long Duration Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_DYNAMIC_BOND", name: "CRISIL Dynamic Bond Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Dynamic Bond Index"], returnSupport: "unsupported" },
  { key: "CRISIL_CORPORATE_BOND", name: "CRISIL Corporate Bond Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Corporate Bond Index"], returnSupport: "unsupported" },
  { key: "CRISIL_CREDIT_RISK_DEBT", name: "CRISIL Credit Risk Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Credit Risk Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_BANKING_AND_PSU_DEBT", name: "CRISIL Banking and PSU Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Banking and PSU Debt Index", "CRISIL Banking & PSU Debt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_MONEY_MARKET", name: "CRISIL Money Market Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Money Market Index"], returnSupport: "unsupported" },
  { key: "CRISIL_DYNAMIC_GILT", name: "CRISIL Dynamic Gilt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Dynamic Gilt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_10_YEAR_GILT", name: "CRISIL 10 Year Gilt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL 10 Year Gilt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_BROAD_BASED_GILT", name: "CRISIL Broad Based Gilt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Broad Based Gilt Index"], returnSupport: "unsupported" },
  { key: "CRISIL_FLOATING_RATE_DEBT", name: "CRISIL Floating Rate Debt Index", provider: CRISIL, defaultBasis: "TRI", aliases: ["CRISIL Floating Rate Debt Index", "CRISIL Short Term Bond Index"], returnSupport: "unsupported" },

  // ---- Global / commodity ---------------------------------------------------
  { key: "MSCI_INDIA", name: "MSCI India Index", provider: MSCI, defaultBasis: "TRI", aliases: ["MSCI India Index", "MSCI India"], returnSupport: "unsupported" },
  { key: "MSCI_WORLD", name: "MSCI World Index", provider: MSCI, defaultBasis: "TRI", aliases: ["MSCI World Index", "MSCI World"], returnSupport: "unsupported" },
  { key: "MSCI_EMERGING_MARKETS", name: "MSCI Emerging Markets Index", provider: MSCI, defaultBasis: "TRI", aliases: ["MSCI Emerging Markets Index", "MSCI EM Index"], returnSupport: "unsupported" },
  { key: "SP_500", name: "S&P 500", provider: "S&P Dow Jones Indices", defaultBasis: "TRI", aliases: ["S&P 500", "S&P 500 Index"], returnSupport: "unsupported" },
  { key: "NASDAQ_100", name: "NASDAQ-100", provider: "Nasdaq", defaultBasis: "TRI", aliases: ["NASDAQ 100", "NASDAQ-100", "Nasdaq 100 Index"], returnSupport: "unsupported" },
  { key: "DOMESTIC_PRICE_OF_GOLD", name: "Domestic Price of Gold", provider: OTHER_PROVIDER, defaultBasis: "unknown", aliases: ["Domestic Price of Gold", "Domestic Prices of Gold", "Price of Gold"], returnSupport: "unsupported" },
  { key: "DOMESTIC_PRICE_OF_SILVER", name: "Domestic Price of Silver", provider: OTHER_PROVIDER, defaultBasis: "unknown", aliases: ["Domestic Price of Silver", "Domestic Prices of Silver", "Price of Silver"], returnSupport: "unsupported" },
];

// ---------------------------------------------------------------------------
// Normalization + resolution
// ---------------------------------------------------------------------------

/** Tokens that describe the BASIS, not the index identity — stripped before
 *  matching so "NIFTY 500 TRI" and "Nifty 500 Total Return Index" converge. */
const BASIS_STRIP = [
  /\btotal\s+returns?\s+index\b/gi,
  /\btotal\s+returns?\b/gi,
  /\bprice\s+returns?\s+index\b/gi,
  /\bprice\s+returns?\b/gi,
  /\btri\b/gi,
  /\bpri\b/gi,
];

/**
 * Collapse a raw index spelling to a comparison key. Case, spacing, punctuation
 * and the TRI/PRI/"Total Return Index" suffix all disappear; every digit and
 * qualifier word survives, so 500 ≠ 500-Multicap-50:25:25 and
 * 100 ≠ 100-Equal-Weight.
 */
export function normalizeBenchmarkName(raw: string): string {
  let s = ` ${raw} `;
  s = s.replace(/[‐-―−]/g, "-"); // unicode dashes → ascii
  s = s.replace(/[   ]/g, " "); // nbsp variants → space
  s = s.replace(/\(([^)]*)\)/g, " $1 "); // unwrap parentheses, keep content
  for (const re of BASIS_STRIP) s = s.replace(re, " ");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/\bs\s*and\s*p\b/g, " "); // "S&P BSE 500" → "BSE 500"
  s = s.replace(/\bindex\b/g, " ");
  s = s.replace(/\bnse\b|\bnifty indices\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, "");
  return s;
}

/** Detect the basis a document quoted the benchmark in. */
export function detectBasis(raw: string): BenchmarkBasis {
  if (/\btri\b/i.test(raw) || /total\s+returns?\s*(index)?/i.test(raw)) return "TRI";
  if (/\bpri\b/i.test(raw) || /price\s+returns?\s*(index)?/i.test(raw)) return "PRI";
  return "unknown";
}

/** Words that only ever continue a LONGER index name. Seeing one directly after
 *  a match means the match is a prefix fragment, not the index itself. */
const QUALIFIER_CONTINUATION_RE =
  /^(momentum|quality|value|equal|low|high|alpha|beta|multicap|volatility|vol|weight|weighted|liquid|arbitrage|hybrid|composite|esg|shariah|top|leaders|select|smallcap|midcap|largecap|micro|junior|next|growth|dividend|enhanced|target|maturity|roll|down|\d{1,4})$/i;

const BY_KEY = new Map<string, CanonicalBenchmark>();
const BY_ALIAS = new Map<string, CanonicalBenchmark>();
const ALIAS_COLLISIONS: string[] = [];
for (const b of CANONICAL_BENCHMARKS) {
  if (BY_KEY.has(b.key)) ALIAS_COLLISIONS.push(`duplicate canonical key ${b.key}`);
  BY_KEY.set(b.key, b);
  for (const spelling of [b.name, ...b.aliases]) {
    const n = normalizeBenchmarkName(spelling);
    if (!n) continue;
    const prev = BY_ALIAS.get(n);
    if (prev && prev.key !== b.key) {
      ALIAS_COLLISIONS.push(`alias "${spelling}" resolves to both ${prev.key} and ${b.key}`);
      continue;
    }
    BY_ALIAS.set(n, b);
  }
}

/** Registry self-consistency problems (a canonical key that resolves to two
 *  different index identities). Empty in a healthy build; asserted by the
 *  validator so a bad edit cannot ship. */
export function registryCollisions(): string[] {
  return [...ALIAS_COLLISIONS];
}

export function benchmarkByKey(key: string): CanonicalBenchmark | null {
  return BY_KEY.get(key) ?? null;
}

export interface ResolvedBenchmark {
  canonical: CanonicalBenchmark;
  /** Basis as the SOURCE DOCUMENT quoted it (may differ from defaultBasis). */
  basis: BenchmarkBasis;
  /** The raw spelling that resolved. */
  rawName: string;
}

/**
 * Resolve a raw benchmark spelling to its canonical entry. EXACT normalized
 * match only — an unknown or ambiguous spelling returns null so the caller can
 * keep the official name and withhold the return, which is the honest outcome.
 */
export function resolveBenchmark(raw: string | null | undefined): ResolvedBenchmark | null {
  if (!raw) return null;
  const n = normalizeBenchmarkName(raw);
  if (!n) return null;
  const canonical = BY_ALIAS.get(n);
  if (!canonical) return null;
  return { canonical, basis: detectBasis(raw), rawName: raw.trim() };
}

/** NSE `ind_close_all` "Index Name" values → canonical key, for the return
 *  engine. Matching is punctuation/case-insensitive on both sides. */
export function nseCsvNameKeyMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of CANONICAL_BENCHMARKS) {
    for (const n of b.nseIndexNames ?? []) m.set(normalizeBenchmarkName(n), b.key);
  }
  return m;
}

/**
 * Scan a short text window (the tail of a "Benchmark: …" field, or a passive
 * scheme's "replicating/tracking …" descriptor) and return the LONGEST exact
 * canonical match found.
 *
 * Longest-match is what keeps "NIFTY 500 Multicap 50:25:25 TRI" from collapsing
 * onto "NIFTY 500": both are present as prefixes of the same span, and only the
 * longer one is the scheme's real benchmark. A window with no exact match
 * returns null — no nearest-neighbour, no fuzzy fallback.
 */
export function matchLongestBenchmark(window: string): ResolvedBenchmark | null {
  // Token spans with their char offsets, so the raw spelling can be recovered.
  const spans: Array<{ start: number; end: number }> = [];
  const re = /[A-Za-z0-9&:+.‐-―-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (spans.length > 400) break;
  }
  let best: { start: number; end: number; len: number } | null = null;
  const MAX_TOKENS = 12;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i; j < Math.min(spans.length, i + MAX_TOKENS); j++) {
      const start = spans[i].start;
      const end = spans[j].end;
      const raw = window.slice(start, end);
      const n = normalizeBenchmarkName(raw);
      if (!n || !BY_ALIAS.has(n)) continue;
      // EARLIEST start wins; among matches that start at the same place the
      // LONGEST wins. Earliest-first matters because the caller's window can
      // run past the field it belongs to, and a longer index name later in the
      // window must never outrank the one actually being labelled.
      if (!best || start < best.start || (start === best.start && n.length > best.len)) {
        best = { start, end, len: n.length };
      }
    }
  }
  if (!best) return null;
  const canonical = BY_ALIAS.get(normalizeBenchmarkName(window.slice(best.start, best.end)));
  if (!canonical) return null;
  // PARTIAL-MATCH GUARD. "Nifty 500 Low Volatility 50 Index" contains "Nifty
  // 500" as a prefix, and nothing else in the registry matches the longer span
  // — so a naive longest-match would attach a Low-Volatility-50 tracker to the
  // broad Nifty 500. If the word right after the matched span is a qualifier
  // that only ever appears inside a LONGER index name, the match is a fragment
  // of an index we do not know, and the honest answer is "unresolved".
  const after = /^\s*([A-Za-z0-9]+)/.exec(window.slice(best.end, best.end + 40));
  if (after && QUALIFIER_CONTINUATION_RE.test(after[1])) return null;
  // Pull in the trailing "Index" word and any basis marker ("TRI", "(TRI)",
  // "Total Return Index") so the basis is read from the document, not assumed.
  const tail = window.slice(best.end, best.end + 48);
  const tailRe = /^([\s:,-]*index\b)?[\s:,-]*(\(?\s*(tri|pri)\s*\)?|total\s+returns?\s+index|total\s+returns?|price\s+returns?\s+index)?/i;
  const tailMatch = tailRe.exec(tail);
  const end = best.end + (tailMatch ? tailMatch[0].length : 0);
  const rawName = window
    .slice(best.start, end)
    // Strip label leftovers the span may have swallowed on its left edge.
    .replace(/^[\s:,.\u2010-\u2015-]+/, "")
    .replace(/^(index|benchmark)\b[\s:,-]*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    // Drop a dangling close-paren the span picked up from a wrapping clause
    // ("…tracking Nifty Auto Index)"), but keep a balanced "(TRI)".
    .replace(/\)+$/, (m, offset: number, full: string) =>
      (full.slice(0, offset).match(/\(/g)?.length ?? 0) >= m.length ? m : ""
    )
    .trim();
  return { canonical, basis: detectBasis(rawName), rawName };
}
