import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import type { NarrativeFact } from "@/data/narrative";
import { cn } from "@/lib/cn";

function toneClasses(tone: NarrativeFact["tone"]) {
  if (tone === "positive") {
    return {
      icon: "text-positive",
      border: "border-positive/30",
      Icon: TrendingUp,
    };
  }
  if (tone === "negative") {
    return {
      icon: "text-negative",
      border: "border-negative/30",
      Icon: TrendingDown,
    };
  }
  return {
    icon: "text-muted-foreground",
    border: "border-border",
    Icon: Minus,
  };
}

export function IndustryNarrative({ facts }: { facts: readonly NarrativeFact[] }) {
  if (facts.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Auto-generated from the latest snapshot — no human commentary.</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {facts.map((f) => {
          const { icon, border, Icon } = toneClasses(f.tone);
          return (
            <div
              key={f.id}
              className={cn(
                "flex items-start gap-3 rounded-md border bg-card px-3 py-2.5",
                border
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", icon)} />
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium tracking-tight">
                  {f.title}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {f.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
