/**
 * Display-only short names for listed companies — used exclusively on the
 * Insights tab, where tables are tight and the audience knows the tickers.
 * (The Portfolio Tracker, AMC pages and exports keep the full legal names.)
 *
 * Two layers:
 *  1. A curated dictionary mapping a normalised company name to its common
 *     short form / acronym (e.g. "Life Insurance Corporation of India" → "LIC",
 *     "Sun Pharmaceutical Industries" → "Sun Pharma"). Only entries that
 *     genuinely shorten are listed — identity mappings are pointless.
 *  2. A generic fallback that just strips the trailing legal suffix
 *     ("Ltd"/"Ltd."/"Limited"). We deliberately do NOT drop descriptor words
 *     like "Power"/"Energy"/"Steel" generically, because for Indian group
 *     companies those disambiguate (Adani Power vs Adani Green, JSW Steel vs
 *     JSW Energy, Tata Motors vs Tata Steel).
 */

/** Normalised lookup key: drop parentheticals ("(India)"), the legal suffix,
 *  punctuation and case, and collapse whitespace. Keeps "&" so "Larsen &
 *  Toubro" stays distinct. */
function normKey(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*\b(?:Limited|Ltd)\b\.?\s*$/i, "")
    .toLowerCase()
    .replace(/[.''`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip only the trailing legal suffix — the conservative generic shortener. */
function stripLegalSuffix(name: string): string {
  return name.replace(/\s*\b(?:Limited|Ltd)\b\.?\s*$/i, "").trim();
}

// Keys are normKey() outputs (lowercase, suffix/punctuation-free, parentheticals
// dropped). Only transforming entries — anything not here falls back to a plain
// legal-suffix strip.
const SHORT_NAMES: Record<string, string> = {
  // Pharma / healthcare
  "sun pharmaceutical industries": "Sun Pharma",
  "dr reddys laboratories": "Dr. Reddy's",
  "cipla": "Cipla",
  "divis laboratories": "Divi's Labs",
  "max healthcare institute": "Max Healthcare",
  "apollo hospitals enterprise": "Apollo Hospitals",
  "fortis healthcare": "Fortis",
  "glaxosmithkline pharmaceuticals": "GSK Pharma",
  "glenmark pharmaceuticals": "Glenmark",
  "torrent pharmaceuticals": "Torrent Pharma",
  "aurobindo pharma": "Aurobindo",
  "alkem laboratories": "Alkem",
  // Financials / insurance / exchanges
  "life insurance corporation of india": "LIC",
  "multi commodity exchange of india": "MCX",
  "state bank of india": "SBI",
  "housing development finance corporation": "HDFC",
  "punjab national bank": "PNB",
  "central bank of india": "Central Bank",
  "the federal bank": "Federal Bank",
  "federal bank": "Federal Bank",
  "kotak mahindra bank": "Kotak Bank",
  "mahindra & mahindra financial services": "M&M Financial",
  "cholamandalam investment & finance company": "Chola Finance",
  "icici prudential life insurance company": "ICICI Pru Life",
  "sbi life insurance company": "SBI Life",
  "hdfc life insurance company": "HDFC Life",
  "sbi cards & payment services": "SBI Cards",
  "rural electrification corporation": "REC",
  "power finance corporation": "PFC",
  "indian railway finance corporation": "IRFC",
  "jio financial services": "Jio Financial",
  "pb fintech": "PB Fintech",
  "one 97 communications": "Paytm",
  // Energy / utilities / metals
  "oil & natural gas corporation": "ONGC",
  "national thermal power corporation": "NTPC",
  "power grid corporation of india": "Power Grid",
  "bharat petroleum corporation": "BPCL",
  "hindustan petroleum corporation": "HPCL",
  "indian oil corporation": "IOC",
  "gail": "GAIL",
  "steel authority of india": "SAIL",
  "national aluminium company": "NALCO",
  "jindal steel & power": "Jindal Steel",
  "hindalco industries": "Hindalco",
  "adani ports & special economic zone": "Adani Ports",
  "adani green energy": "Adani Green",
  "adani energy solutions": "Adani Energy",
  "reliance industries": "Reliance",
  // Capital goods / defence / industrials
  "hindustan aeronautics": "HAL",
  "bharat heavy electricals": "BHEL",
  "bharat electronics": "BEL",
  "bharat dynamics": "BDL",
  "mazagon dock shipbuilders": "Mazagon Dock",
  "voltamp transformers": "Voltamp",
  "td power systems": "TD Power",
  "solar industries india": "Solar Industries",
  "container corporation of india": "Concor",
  "larsen & toubro": "L&T",
  "siemens energy india": "Siemens Energy",
  // IT
  "tata consultancy services": "TCS",
  "oracle financial services software": "Oracle FSS",
  "kpit technologies": "KPIT",
  "persistent systems": "Persistent",
  "info edge india": "Info Edge",
  // FMCG / consumer / autos
  "hindustan unilever": "HUL",
  "britannia industries": "Britannia",
  "nestle india": "Nestlé",
  "godrej consumer products": "Godrej Consumer",
  "colgate palmolive india": "Colgate",
  "procter & gamble hygiene & health care": "P&G Hygiene",
  "tata consumer products": "Tata Consumer",
  "maruti suzuki india": "Maruti Suzuki",
  "tvs motor company": "TVS Motor",
  "samvardhana motherson international": "Motherson",
  "sona blw precision forgings": "Sona BLW",
  "the indian hotels company": "Indian Hotels",
  "interglobe aviation": "IndiGo",
  "avenue supermarts": "DMart",
  "fsn e-commerce ventures": "Nykaa",
  "macrotech developers": "Lodha",
  "tube investments of india": "Tube Investments",
  // Cement
  "ultratech cement": "UltraTech",
  "grasim industries": "Grasim",
  "ambuja cements": "Ambuja",
  "jk lakshmi cement": "JK Lakshmi",
  "the ramco cements": "Ramco Cements",
  "apl apollo tubes": "APL Apollo",
  "berger paints india": "Berger Paints",
};

/**
 * Short, display-friendly company name for the Insights tab. Returns the
 * curated short form when known, else the name with its trailing legal suffix
 * stripped. Never returns empty.
 */
export function shortenCompany(name: string): string {
  if (!name) return name;
  const curated = SHORT_NAMES[normKey(name)];
  if (curated) return curated;
  return stripLegalSuffix(name) || name;
}
