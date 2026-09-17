/**
 * First-party AMC document sources for the official scheme-benchmark registry.
 *
 * ONLY the AMC's own hosts appear here. The spec's source priority is
 *   factsheet → SID → KIM → scheme/product page → other official document,
 * and a mapping may only be called `official-mapped` when the evidence URL is
 * one of these. Third-party aggregators (AdvisorKhoj, fund portals) are allowed
 * for DISCOVERY only and are deliberately absent — nothing here ever resolves
 * to one.
 *
 * Every AMC gets a list of candidate landing pages plus a link filter. The
 * acquisition tier (acquire.ts) curls each page, harvests document links, picks
 * the most recent month, downloads it from the AMC's own host and extracts the
 * benchmark fields. A page that 404s, bot-walls or yields nothing simply fails
 * over to the next candidate; an AMC where every candidate fails is reported as
 * `unmapped` with the reason, never back-filled from the category proxy.
 *
 * The host for each AMC is the one the committed monthly-portfolio snapshots
 * (public/amc-holdings/<slug>.json) already resolve to, so these are hosts the
 * repo's existing pipeline is known to reach.
 */

import type { BenchmarkSourceType } from "../../../src/data/scheme-benchmarks";

export interface SchemeDocSource {
  /** Universe AMC slug (see universe.ts / advisorkhoj.slugFor). */
  slug: string;
  amc: string;
  /** Candidate first-party landing pages, best first. */
  pages: string[];
  /** What kind of document these pages lead to. */
  sourceType: BenchmarkSourceType;
  /** Keep only harvested links matching this (href + anchor text). */
  include?: RegExp;
  referer?: string;
  /** Page is JS-rendered or bot-walled — needs the headless-browser tier. */
  browser?: boolean;
}

/** Links that look like a monthly factsheet / fund-facts document. */
export const FACTSHEET_LINK_RE =
  /(fact[\s_-]*sheet|factsheet|fund[\s_-]*fact|fundfact|monthly[\s_-]*(update|bulletin|connect|digest)|scheme[\s_-]*(update|features))/i;

/** Links that look like a SID / KIM (the fallback document tier). */
export const SID_KIM_LINK_RE = /(\bsid\b|scheme[\s_-]*information[\s_-]*document|\bkim\b|key[\s_-]*information[\s_-]*memorandum)/i;

export const SCHEME_DOC_SOURCES: SchemeDocSource[] = [
  { slug: "360-one", amc: "360 ONE Mutual Fund", pages: ["https://www.360.one/mutual-fund/downloads/", "https://www.360.one/mutual-fund/"], sourceType: "factsheet" },
  { slug: "abakkus", amc: "Abakkus Mutual Fund", pages: ["https://www.abakkusmf.com/downloads", "https://www.abakkusmf.com/"], sourceType: "factsheet" },
  { slug: "absl", amc: "Aditya Birla Sun Life Mutual Fund", pages: ["https://mutualfund.adityabirlacapital.com/forms-and-downloads/factsheet", "https://mutualfund.adityabirlacapital.com/forms-and-downloads"], sourceType: "factsheet" },
  { slug: "angel-one", amc: "Angel One Mutual Fund", pages: ["https://www.angelonemf.com/downloads"], sourceType: "factsheet" },
  { slug: "axis", amc: "Axis Mutual Fund", pages: ["https://www.axismf.com/factsheet", "https://www.axismf.com/downloads"], sourceType: "factsheet", referer: "https://www.axismf.com/" },
  { slug: "bajaj-finserv", amc: "Bajaj Finserv Mutual Fund", pages: ["https://www.bajajamc.com/downloads", "https://www.bajajamc.com/factsheet"], sourceType: "factsheet" },
  { slug: "bandhan", amc: "Bandhan Mutual Fund", pages: ["https://bandhanmutual.com/downloads/factsheet", "https://bandhanmutual.com/downloads"], sourceType: "factsheet" },
  { slug: "bank-of-india", amc: "Bank of India Mutual Fund", pages: ["https://www.boimf.in/investor-corner", "https://www.boimf.in/downloads"], sourceType: "factsheet" },
  { slug: "baroda-bnp-paribas", amc: "Baroda BNP Paribas Mutual Fund", pages: ["https://www.barodabnpparibasmf.in/downloads/factsheet", "https://www.barodabnpparibasmf.in/downloads"], sourceType: "factsheet" },
  { slug: "canara-robeco", amc: "Canara Robeco Mutual Fund", pages: ["https://www.canararobeco.com/downloads/factsheet", "https://www.canararobeco.com/downloads"], sourceType: "factsheet" },
  { slug: "capitalmind", amc: "Capitalmind Mutual Fund", pages: ["https://capitalmindmf.com/statutory-disclosures.html", "https://capitalmindmf.com/"], sourceType: "factsheet" },
  { slug: "choice", amc: "Choice Mutual Fund", pages: ["https://www.choicemf.com/disclosures/factsheet", "https://www.choicemf.com/disclosures"], sourceType: "factsheet", referer: "https://www.choicemf.com/" },
  { slug: "dsp", amc: "DSP Mutual Fund", pages: ["https://www.dspim.com/mandatory-disclosures/factsheet", "https://www.dspim.com/downloads"], sourceType: "factsheet" },
  { slug: "edelweiss", amc: "Edelweiss Mutual Fund", pages: ["https://www.edelweissmf.com/literature/factsheet", "https://www.edelweissmf.com/literature/disclosures?productType=All"], sourceType: "factsheet", browser: true },
  { slug: "franklin-templeton", amc: "Franklin Templeton Mutual Fund", pages: ["https://www.franklintempletonindia.com/reports", "https://www.franklintempletonindia.com/investor/forms-and-downloads"], sourceType: "factsheet", referer: "https://www.franklintempletonindia.com/" },
  { slug: "groww", amc: "Groww Mutual Fund", pages: ["https://www.growwmf.in/statutory-disclosure/factsheet", "https://www.growwmf.in/statutory-disclosure"], sourceType: "factsheet" },
  { slug: "hdfc", amc: "HDFC Mutual Fund", pages: ["https://www.hdfcfund.com/mutual-funds/factsheets", "https://www.hdfcfund.com/statutory-disclosure"], sourceType: "factsheet", browser: true },
  { slug: "helios", amc: "Helios Mutual Fund", pages: ["https://www.heliosmf.in/downloads/", "https://www.heliosmf.in/"], sourceType: "factsheet" },
  { slug: "hsbc", amc: "HSBC Mutual Fund", pages: ["https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources", "https://www.assetmanagement.hsbc.co.in/en/mutual-funds"], sourceType: "factsheet" },
  { slug: "icici-pru", amc: "ICICI Prudential Mutual Fund", pages: ["https://www.icicipruamc.com/media-center/downloads", "https://www.icicipruamc.com/downloads"], sourceType: "factsheet" },
  { slug: "invesco", amc: "Invesco Mutual Fund", pages: ["https://www.invescomutualfund.com/literature-and-form?tab=Factsheet", "https://www.invescomutualfund.com/literature-and-form?tab=Complete"], sourceType: "factsheet", referer: "https://www.invescomutualfund.com/" },
  { slug: "iti", amc: "ITI Mutual Fund", pages: ["https://www.itiamc.com/downloads", "https://www.itiamc.com/statuory-disclosure"], sourceType: "factsheet" },
  { slug: "jio-blackrock", amc: "Jio BlackRock Mutual Fund", pages: ["https://www.jioblackrockmf.com/downloads", "https://www.jioblackrockmf.com/"], sourceType: "factsheet" },
  { slug: "jm-financial", amc: "JM Financial Mutual Fund", pages: ["https://www.jmfinancialmf.com/downloads/Factsheet", "https://www.jmfinancialmf.com/downloads"], sourceType: "factsheet", referer: "https://www.jmfinancialmf.com/" },
  { slug: "kotak", amc: "Kotak Mahindra Mutual Fund", pages: ["https://www.kotakmf.com/Information/forms-and-downloads", "https://www.kotakmf.com/factsheet"], sourceType: "factsheet" },
  { slug: "lic", amc: "LIC Mutual Fund", pages: ["https://www.licmf.com/downloads/factsheet", "https://www.licmf.com/downloads"], sourceType: "factsheet", referer: "https://www.licmf.com/" },
  { slug: "mahindra-manulife", amc: "Mahindra Manulife Mutual Fund", pages: ["https://www.mahindramanulife.com/downloads", "https://www.mahindramanulife.com/"], sourceType: "factsheet" },
  { slug: "mirae", amc: "Mirae Asset Mutual Fund", pages: ["https://www.miraeassetmf.co.in/downloads/factsheet", "https://www.miraeassetmf.co.in/downloads"], sourceType: "factsheet", browser: true },
  { slug: "motilal-oswal", amc: "Motilal Oswal Mutual Fund", pages: ["https://www.motilaloswalmf.com/downloads/mutual-fund/factsheet", "https://www.motilaloswalmf.com/downloads"], sourceType: "factsheet" },
  { slug: "navi", amc: "Navi Mutual Fund", pages: ["https://navi.com/mutual-fund/downloads", "https://navi.com/mutual-fund"], sourceType: "factsheet" },
  { slug: "nippon", amc: "Nippon India Mutual Fund", pages: ["https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures", "https://mf.nipponindiaim.com/investor-service/downloads"], sourceType: "factsheet", referer: "https://mf.nipponindiaim.com/" },
  { slug: "nj", amc: "NJ Mutual Fund", pages: ["https://www.njmutualfund.com/downloads", "https://www.njmutualfund.com/"], sourceType: "factsheet" },
  { slug: "old-bridge", amc: "Old Bridge Mutual Fund", pages: ["https://oldbridgemf.com/statutory-disclosures.html", "https://oldbridgemf.com/"], sourceType: "factsheet" },
  { slug: "pgim-india", amc: "PGIM India Mutual Fund", pages: ["https://www.pgimindia.com/mutual-funds/disclosures/factsheet", "https://www.pgimindia.com/mutual-funds/disclosures"], sourceType: "factsheet", referer: "https://www.pgimindia.com/" },
  { slug: "ppfas", amc: "PPFAS Mutual Fund", pages: ["https://amc.ppfas.com/downloads/factsheet/", "https://amc.ppfas.com/downloads/"], sourceType: "factsheet" },
  { slug: "quant", amc: "quant Mutual Fund", pages: ["https://quantmutual.com/downloads", "https://www.quantmutual.com/downloads"], sourceType: "factsheet" },
  { slug: "quantum", amc: "Quantum Mutual Fund", pages: ["https://www.quantumamc.com/downloads", "https://www.quantumamc.com/"], sourceType: "factsheet" },
  { slug: "samco", amc: "Samco Mutual Fund", pages: ["https://www.samcomf.com/StatutoryDisclosure", "https://www.samcomf.com/downloads"], sourceType: "factsheet" },
  { slug: "sbi", amc: "SBI Mutual Fund", pages: ["https://www.sbimf.com/docs/default-source/monthly-factsheet", "https://www.sbimf.com/forms-and-downloads"], sourceType: "factsheet", referer: "https://www.sbimf.com/" },
  { slug: "shriram", amc: "Shriram Mutual Fund", pages: ["https://www.shriramamc.in/investor-statutory-disclosures", "https://www.shriramamc.in/downloads"], sourceType: "factsheet" },
  { slug: "sundaram", amc: "Sundaram Mutual Fund", pages: ["https://www.sundarammutual.com/factsheet", "https://www.sundarammutual.com/downloads"], sourceType: "factsheet" },
  { slug: "tata", amc: "Tata Mutual Fund", pages: ["https://www.tatamutualfund.com/downloads/factsheet", "https://www.tatamutualfund.com/downloads"], sourceType: "factsheet" },
  { slug: "taurus", amc: "Taurus Mutual Fund", pages: ["https://www.taurusmutualfund.com/index.php/factsheet", "https://www.taurusmutualfund.com/"], sourceType: "factsheet" },
  { slug: "the-wealth-company", amc: "The Wealth Company Mutual Fund", pages: ["https://www.wealthcompanyamc.in/literature-forms/factsheet/", "https://www.wealthcompanyamc.in/literature-forms/"], sourceType: "factsheet" },
  { slug: "trust", amc: "Trust Mutual Fund", pages: ["https://www.trustmf.com/disclosures?activeTab=factsheet", "https://www.trustmf.com/disclosures"], sourceType: "factsheet" },
  { slug: "unifi", amc: "Unifi Mutual Fund", pages: ["https://unifimf.com/statutorydocuments/", "https://unifimf.com/"], sourceType: "factsheet" },
  { slug: "union", amc: "Union Mutual Fund", pages: ["https://www.unionmf.com/about-us/downloads", "https://www.unionmf.com/"], sourceType: "factsheet", referer: "https://www.unionmf.com/" },
  { slug: "uti", amc: "UTI Mutual Fund", pages: ["https://www.utimf.com/downloads/fund-factsheet", "https://www.utimf.com/downloads"], sourceType: "factsheet" },
  { slug: "whiteoak-capital", amc: "WhiteOak Capital Mutual Fund", pages: ["https://mf.whiteoakamc.com/downloads", "https://mf.whiteoakamc.com/regulatory-disclosures"], sourceType: "factsheet" },
  { slug: "zerodha", amc: "Zerodha Mutual Fund", pages: ["https://www.zerodhafundhouse.com/resources/disclosures", "https://www.zerodhafundhouse.com/"], sourceType: "factsheet" },
];

/** amc-holdings snapshots use a couple of shorter slugs than the AMFI-derived
 *  universe slug; bridge them so the offline descriptor tier lines up. */
export const HOLDINGS_SLUG_ALIASES: Record<string, string> = {
  "mahindra-manulife": "mahindra",
};
