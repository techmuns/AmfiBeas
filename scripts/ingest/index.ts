import { ingestAmfiAmcMaster } from "./amfi-nav";
import { ingestAmfiSubClassification } from "./amfi-sub-classification";
import { ingestListedAmcQuarterly } from "./listed-amc-quarterly";
import { ingestAmfiAaum } from "./amfi-aaum";
import { ingestMorningstar } from "./morningstar";

interface Step {
  name: string;
  run: () => Promise<void>;
  optional?: boolean;
}

const STEPS: Step[] = [
  { name: "amfi-amc-master", run: ingestAmfiAmcMaster },
  {
    name: "amfi-sub-classification",
    run: ingestAmfiSubClassification,
    optional: true,
  },
  {
    name: "listed-amc-quarterly",
    run: ingestListedAmcQuarterly,
    optional: true,
  },
  { name: "amfi-aaum", run: ingestAmfiAaum, optional: true },
  // Morningstar is opt-in via MORNINGSTAR_FETCH_ENABLED=1; the step itself
  // returns immediately when the flag is unset, so registering unconditionally
  // is safe.
  { name: "morningstar", run: ingestMorningstar, optional: true },
];

async function main() {
  let failures = 0;
  for (const step of STEPS) {
    process.stdout.write(`\n=== ${step.name} ===\n`);
    try {
      await step.run();
    } catch (err) {
      failures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[ingest][error] ${step.name}: ${msg}\n`);
      if (!step.optional) throw err;
    }
  }
  process.stdout.write(
    `\nDone. ${STEPS.length - failures}/${STEPS.length} step(s) succeeded.\n`
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[ingest][fatal] ${msg}\n`);
  process.exit(1);
});
