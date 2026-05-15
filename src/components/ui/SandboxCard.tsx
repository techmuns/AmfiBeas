import { Calculator } from "lucide-react";
import { cn } from "@/lib/cn";

interface SandboxScenario {
  /** Headline label (e.g. "Apr 2019"). */
  startLabel: string;
  /** Today/end label (e.g. "Apr 2026"). */
  endLabel: string;
  /** Initial investment in ₹. */
  startAmount: number;
  /** End-state value in ₹. */
  endAmount: number;
  /** CAGR over the period in %. */
  cagrPct: number | null;
  /** What the same money would have done in cash (e.g. liquid index). */
  cashEquivalent?: number | null;
  /** Optional caveat / context line. */
  caveat?: string;
}

interface SandboxCardProps {
  scenario: SandboxScenario;
  className?: string;
}

function fmt(v: number): string {
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/**
 * Compact "what would ₹X have grown to" sandbox card — turns the
 * dashboard from observational to actionable. Renders the
 * pre-computed scenario passed in by the caller (the calculation
 * itself stays in a data helper so the component is purely visual).
 */
export function SandboxCard({ scenario, className }: SandboxCardProps) {
  const multiple =
    scenario.startAmount > 0 ? scenario.endAmount / scenario.startAmount : null;
  return (
    <div
      className={cn(
        "rounded-xl border bg-gradient-to-br from-card to-muted/30 p-5 shadow-sm",
        className
      )}
    >
      <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Calculator className="h-3 w-3" />
        Investor Sandbox
      </div>
      <h3 className="text-sm font-semibold tracking-tight">
        ₹{fmt(scenario.startAmount)} in active equity, {scenario.startLabel}
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Today ({scenario.endLabel})
          </div>
          <div className="mt-1 text-2xl font-semibold tabular tracking-tight">
            ₹{fmt(scenario.endAmount)}
          </div>
          {multiple !== null && (
            <div className="text-[11px] tabular text-muted-foreground">
              {multiple.toFixed(2)}× the original investment
            </div>
          )}
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Annualised (CAGR)
          </div>
          <div className="mt-1 text-2xl font-semibold tabular tracking-tight">
            {scenario.cagrPct !== null
              ? `${scenario.cagrPct >= 0 ? "+" : ""}${scenario.cagrPct.toFixed(1)}%`
              : "—"}
          </div>
          {typeof scenario.cashEquivalent === "number" && (
            <div className="text-[11px] tabular text-muted-foreground">
              vs ₹{fmt(scenario.cashEquivalent)} in a hypothetical cash
              alternative
            </div>
          )}
        </div>
      </div>
      {scenario.caveat && (
        <p className="mt-3 text-[11px] italic text-muted-foreground">
          {scenario.caveat}
        </p>
      )}
    </div>
  );
}
