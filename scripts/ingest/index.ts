import { ingestAmfiAmcMaster } from "./amfi-nav";
import { ingestAmfiIndustryMonthly } from "./amfi-industry";

interface Step {
  name: string;
  run: () => Promise<void>;
  optional?: boolean;
}

const STEPS: Step[] = [
  { name: "amfi-amc-master", run: ingestAmfiAmcMaster },
  { name: "amfi-industry-monthly", run: ingestAmfiIndustryMonthly, optional: true },
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
