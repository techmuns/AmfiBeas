import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { AMCS } from "@/data/amcs";
import { monthlyForAmc, quarterlyForAmc } from "@/data/generator";
import { formatINR } from "@/lib/format";

export default function AmcListPage() {
  const rows = AMCS.map((a) => {
    const m = monthlyForAmc(a.slug);
    const q = quarterlyForAmc(a.slug);
    const latest = m[m.length - 1];
    const latestQ = q[q.length - 1];
    return { profile: a, latest, latestQ };
  }).sort((a, b) => b.latest.aum - a.latest.aum);

  const totalAum = rows.reduce((s, r) => s + r.latest.aum, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AMCs"
        subtitle={`${rows.length} tracked Indian asset managers`}
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">AMC</th>
                <th className="py-2 pr-4 font-medium">Listed</th>
                <th className="py-2 pr-4 text-right font-medium tabular">AUM</th>
                <th className="py-2 pr-4 text-right font-medium tabular">Share</th>
                <th className="py-2 pr-4 text-right font-medium tabular">Equity %</th>
                <th className="py-2 pr-4 text-right font-medium tabular">SIP</th>
                <th className="py-2 pr-4 text-right font-medium tabular">PAT (Q)</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ profile, latest, latestQ }) => (
                <tr
                  key={profile.slug}
                  className="border-b last:border-0 hover:bg-accent/50"
                >
                  <td className="py-3 pr-4">
                    <Link
                      href={`/amc/${profile.slug}`}
                      className="font-medium hover:underline"
                    >
                      {profile.name}
                    </Link>
                    {profile.ticker && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {profile.ticker}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {profile.listed ? "Yes" : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right tabular">
                    {formatINR(latest.aum, { compact: true })}
                  </td>
                  <td className="py-3 pr-4 text-right tabular">
                    {((latest.aum / totalAum) * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 pr-4 text-right tabular">
                    {((latest.equityAum / latest.aum) * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 pr-4 text-right tabular">
                    {formatINR(latest.sipFlow, { compact: true })}
                  </td>
                  <td className="py-3 pr-4 text-right tabular">
                    {formatINR(latestQ.pat, { compact: true })}
                  </td>
                  <td className="py-3 text-right">
                    <Link
                      href={`/amc/${profile.slug}`}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      aria-label={`Open ${profile.name}`}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
