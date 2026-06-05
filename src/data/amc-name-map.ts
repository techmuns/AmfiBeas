/**
 * Canonical scheme-name → AMC (fund-house) mapping.
 *
 * Runtime-safe: pure data + string ops, no Node-only deps, so it is shared by
 * the Next app and the build scripts (scripts/build-amc-allocations.ts,
 * scripts/build-cap-flows.ts) instead of each keeping its own copy.
 *
 * AMC_PREFIXES is matched as a case-insensitive prefix of the scheme name and
 * is ordered most-specific first, so e.g. "Quantum" beats "Quant" and
 * "Aditya Birla SL" matches before any bare token. amcOf falls back to the
 * scheme's first token when no prefix matches — which is also why some
 * AMFI-mandated ETFs whose names are not the AMC brand (e.g. "CPSE ETF",
 * "Bharat 22 ETF") resolve to that brand token rather than their manager.
 */
export const AMC_PREFIXES: [string, string][] = [
  ["Aditya Birla SL", "Aditya Birla"],
  ["Baroda BNP Paribas", "Baroda BNP Paribas"],
  ["Bank of India", "Bank of India"],
  ["Mahindra Manulife", "Mahindra Manulife"],
  ["Motilal Oswal", "Motilal Oswal"],
  ["Parag Parikh", "PPFAS"],
  ["Franklin Build India", "Franklin Templeton"],
  ["Franklin India", "Franklin Templeton"],
  ["Templeton India", "Franklin Templeton"],
  ["ICICI Pru", "ICICI Pru"],
  ["Nippon India", "Nippon"],
  ["PGIM India", "PGIM"],
  ["Canara Rob", "Canara Robeco"],
  ["Invesco India", "Invesco"],
  ["Mirae Asset", "Mirae"],
  ["Bajaj Finserv", "Bajaj Finserv"],
  ["Old Bridge", "Old Bridge"],
  ["360 ONE", "360 ONE"],
  ["LIC MF", "LIC MF"],
  ["Quantum", "Quantum"],
  ["Quant", "Quant"],
  ["TRUSTMF", "Trust"],
  ["WhiteOak", "WhiteOak"],
  ["WOC", "WhiteOak"],
  ["Edelweiss", "Edelweiss"],
  ["Helios", "Helios"],
  ["Abakkus", "Abakkus"],
  ["Sundaram", "Sundaram"],
  ["Bandhan", "Bandhan"],
  ["Samco", "Samco"],
  ["HSBC", "HSBC"],
  ["HDFC", "HDFC"],
  ["Kotak", "Kotak"],
  ["Axis", "Axis"],
  ["Tata", "Tata"],
  ["SBI", "SBI"],
  ["UTI", "UTI"],
  ["DSP", "DSP"],
  ["ITI", "ITI"],
  ["Union", "Union"],
  ["JM ", "JM"],
  ["NJ ", "NJ"],
  ["Navi", "Navi"],
  ["Groww", "Groww"],
  ["Zerodha", "Zerodha"],
  ["Shriram", "Shriram"],
  ["Taurus", "Taurus"],
  ["Unifi", "Unifi"],
  ["Capitalmind", "Capitalmind"],
  ["Angel One", "Angel One"],
];

export function amcOf(fund: string): string {
  const f = fund.trim();
  for (const [pre, label] of AMC_PREFIXES) {
    if (f.toLowerCase().startsWith(pre.toLowerCase())) return label;
  }
  return f.split(/[\s(]/)[0]; // fallback: first token
}
