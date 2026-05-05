import Link from "next/link";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { AMCS, amfiNameToSlug, getAMC } from "@/data/amcs";
import { monthlyForAmc, quarterlyForAmc } from "@/data/generator";
import { amcMasterSnapshot, dataMode } from "@/data/source";
import {
  formatCompactCrSafe,
  formatIntSafe,
  formatPctSafe,
} from "@/lib/format";
import { cn } from "@/lib/cn";

interface Row {
  name: string;
  slug?: string;
  ticker?: string;
  listed?: boolean;
  amcCode?: number;
  schemeCount?: number;
  totalAum?: number;
  activeEquityShare?: number;
  sipContribution?: number;
  quarterlyPat?: number;
  hasProfile: boolean;
}

function buildRows(): { rows: Row[]; mode: "live" | "demo" } {
  const mode = dataMode().amcMaster;

  if (mode === "live") {
    const rows: Row[] = amcMasterSnapshot.amcs.map((a) => {
      const slug = amfiNameToSlug(a.name);
      const profile = slug ? getAMC(slug) : undefined;
      const monthly = slug ? monthlyForAmc(slug) : [];
      const quarterly = slug ? quarterlyForAmc(slug) : [];
      const latest = monthly[monthly.length - 1];
      const latestQ = quarterly[quarterly.length - 1];
      return {
        name: a.name,
        slug,
        ticker: profile?.ticker,
        listed: profile?.listed,
        amcCode: a.amcCode,
        schemeCount: a.schemeCount,
        totalAum: latest?.totalAum,
        activeEquityShare:
          latest && latest.totalAum > 0
            ? (latest.activeEquityAum / latest.totalAum) * 100
            : undefined,
        sipContribution: latest?.sipContribution,
        quarterlyPat: latestQ?.pat,
        hasProfile: Boolean(profile),
      };
    });
    return { rows, mode };
  }

  const rows: Row[] = AMCS.map((profile) => {
    const monthly = monthlyForAmc(profile.slug);
    const quarterly = quarterlyForAmc(profile.slug);
    const latest = monthly[monthly.length - 1];
    const latestQ = quarterly[quarterly.length - 1];
    return {
      name: profile.name,
      slug: profile.slug,
      ticker: profile.ticker,
      listed: profile.listed,
      schemeCount: undefined,
      totalAum: latest.totalAum,
      activeEquityShare:
        latest.totalAum > 0
          ? (latest.activeEquityAum / latest.totalAum) * 100
          : undefined,
      sipContribution: latest.sipContribution,
      quarterlyPat: latestQ.pat,
      hasProfile: true,
    };
  });
  return { rows, mode };
}

export default function AmcListPage() {
  const { rows, mode } = buildRows();
  const totalAum = rows.reduce((s, r) => s + (r.totalAum ?? 0), 0);

  const subtitle =
    mode === "live"
      ? `${rows.length} AMFI-registered AMCs · live AMC master from amfiindia.com`
      : `${rows.length} tracked AMCs · demo data`;

  return (
    <div className="space-y-6">
      <PageHeader title="AMCs" subtitle={subtitle} />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">AMC</th>
                <th className="py-2 pr-4 text-right font-medium tabular">
                  {mode === "live" ? "Schemes" : "Listed"}
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular">AUM</th>
                <th className="py-2 pr-4 text-right font-medium tabular">Share</th>
                <th className="py-2 pr-4 text-right font-medium tabular">Active Eq %</th>
                <th className="py-2 pr-4 text-right font-medium tabular">SIP</th>
                <th className="py-2 pr-4 text-right font-medium tabular">PAT (Q)</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const clickable = r.hasProfile && r.slug;
                const Wrapper = ({ children }: { children: React.ReactNode }) =>
                  clickable ? (
                    <Link
                      href={`/amc/${r.slug}`}
                      className="font-medium hover:underline"
                    >
                      {children}
                    </Link>
                  ) : (
                    <span className="font-medium">{children}</span>
                  );
                return (
                  <tr
                    key={(r.slug ?? r.name) + i}
                    className={cn(
                      "border-b last:border-0",
                      clickable && "hover:bg-accent/50"
                    )}
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <Wrapper>{r.name}</Wrapper>
                        {r.hasProfile && (
                          <BadgeCheck
                            className="h-3.5 w-3.5 text-positive"
                            aria-label="Has profile data"
                          />
                        )}
                        {r.ticker && (
                          <span className="text-xs text-muted-foreground">
                            {r.ticker}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right tabular">
                      {mode === "live"
                        ? formatIntSafe(r.schemeCount)
                        : r.listed
                        ? "Yes"
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {formatCompactCrSafe(r.totalAum)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {formatPctSafe(
                        r.totalAum && totalAum
                          ? (r.totalAum / totalAum) * 100
                          : null
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {formatPctSafe(r.activeEquityShare)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {formatCompactCrSafe(r.sipContribution)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular text-muted-foreground">
                      {formatCompactCrSafe(r.quarterlyPat)}
                    </td>
                    <td className="py-3 text-right">
                      {clickable && (
                        <Link
                          href={`/amc/${r.slug}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          aria-label={`Open ${r.name}`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
