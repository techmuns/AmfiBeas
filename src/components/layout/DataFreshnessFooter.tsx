import {
  amcAaumQuarterlySnapshot,
  amcQuarterlySnapshot,
} from "@/data/source";
import { amfiMonthlyPdfSnapshot } from "@/data/amfi-monthly";
import { amfiQuarterlyIndustrySnapshot } from "@/data/amfi-quarterly";

function latestGeneratedAt(): string {
  const stamps = [
    amcAaumQuarterlySnapshot.meta?.generatedAt,
    amcQuarterlySnapshot.meta?.generatedAt,
    amfiMonthlyPdfSnapshot.meta?.generatedAt,
    amfiQuarterlyIndustrySnapshot.meta?.generatedAt,
  ].filter((s): s is string => typeof s === "string");
  if (stamps.length === 0) return "";
  // Compare ISO strings lexicographically — works as a date comparator
  // for the well-formed timestamps our ingest writes.
  stamps.sort();
  return stamps[stamps.length - 1];
}

function formatIsoDate(iso: string): string {
  // YYYY-MM-DDTHH:MM:SS.sssZ → YYYY-MM-DD
  return iso.slice(0, 10);
}

export function DataFreshnessFooter() {
  const iso = latestGeneratedAt();
  if (!iso) return null;
  return (
    <footer className="border-t bg-card/30 px-6 py-3 text-[11px] tabular text-muted-foreground lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Data as of <span className="text-foreground">{formatIsoDate(iso)}</span>{" "}
          · AMFI Fundwise AAUM + AMFI Monthly &amp; Quarterly Reports +
          listed-AMC company filings
        </span>
        <span>AmfiBeas</span>
      </div>
    </footer>
  );
}
