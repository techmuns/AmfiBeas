/**
 * Dedicated CLI entry for the AMFI Fundwise AAUM × category AUDIT
 * mode. Drives the same form as `scripts/ingest/amfi-aaum.ts` but
 * selects ONE specific AMC (so the result table breaks down by
 * scheme category) and writes the parsed output to
 * `manual-data/audit/amfi-aaum-category-{slug}-{quarter}.json`.
 *
 * Usage:
 *   AAUM_AUDIT_AMC="HDFC Mutual Fund" npm run audit:amfi-aaum-category
 *   AAUM_AUDIT_AMC="SBI Mutual Fund" AAUM_AUDIT_QUARTER="2026-Q1" \
 *     npm run audit:amfi-aaum-category
 *   AAUM_AUDIT_AMC="ICICI Prudential Mutual Fund" AAUM_AUDIT_WRITE="0" \
 *     npm run audit:amfi-aaum-category   # dry-run, no JSON written
 *
 * Audit-only — does NOT touch src/data/snapshots/amc-aaum-quarterly.json.
 * Designed to confirm AMFI returns AMC × category AAUM before we
 * commit to building the production extractor for Active Equity
 * Market Share. See PR #76 for the audit narrative.
 */
import { ingestAmfiAaumCategoryAudit } from "./amfi-aaum";

const AMC = process.env.AAUM_AUDIT_AMC;
const QUARTER = process.env.AAUM_AUDIT_QUARTER;
const WRITE = process.env.AAUM_AUDIT_WRITE !== "0";

if (!AMC) {
  process.stderr.write(
    `[audit:amfi-aaum-category] AAUM_AUDIT_AMC env var is required.\n` +
      `  Example: AAUM_AUDIT_AMC="HDFC Mutual Fund" npm run audit:amfi-aaum-category\n` +
      `  Optional: AAUM_AUDIT_QUARTER="2026-Q1"  AAUM_AUDIT_WRITE="0"\n`
  );
  process.exit(1);
}

ingestAmfiAaumCategoryAudit(AMC, QUARTER, WRITE).then(
  (out) => {
    if (!out) {
      process.stderr.write(`[audit:amfi-aaum-category] returned null\n`);
      process.exit(1);
    }
    if (out.status !== "ok") {
      process.stderr.write(
        `[audit:amfi-aaum-category] status=${out.status}; see notes:\n` +
          out.notes.map((n) => `  - ${n}`).join("\n") +
          "\n"
      );
      process.exit(2);
    }
    process.exit(0);
  },
  (err) => {
    process.stderr.write(
      `[audit:amfi-aaum-category][fatal] ${(err as Error).message}\n`
    );
    process.exit(1);
  }
);
