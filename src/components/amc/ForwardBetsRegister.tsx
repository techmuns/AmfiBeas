import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { cn } from "@/lib/cn";
import {
  amcInitiativesUnion,
  cohortInitiativesUnion,
} from "@/data/amc-narratives";

const LISTED_AMC_SLUGS = [
  "hdfc",
  "icici-pru",
  "nippon",
  "absl",
  "uti",
  "canara-robeco",
] as const;

const DISPLAY_NAME: Record<string, string> = {
  hdfc: "HDFC",
  "icici-pru": "ICICI Pru",
  nippon: "Nippon",
  absl: "ABSL",
  uti: "UTI",
  "canara-robeco": "Canara Robeco",
};

/**
 * Forward Bets register — AMC × initiative grid. A filled cell means
 * the AMC has mentioned that initiative across the available concalls;
 * an empty cell means it hasn't (or no concall is ingested yet). Useful
 * for spotting who's positioned around private credit, GiftCity, SIF,
 * AI, etc. — the leading-indicator view of cohort posture.
 */
export function ForwardBetsRegister() {
  const cols = cohortInitiativesUnion([...LISTED_AMC_SLUGS]);
  if (cols.length === 0) return null;
  const byAmc = new Map<string, Set<string>>();
  for (const slug of LISTED_AMC_SLUGS) {
    byAmc.set(
      slug,
      new Set(
        amcInitiativesUnion(slug).map((s) => s.toLowerCase().trim())
      )
    );
  }
  return (
    <Card
      title="Forward Bets — Cohort"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Which strategic initiatives each AMC has called out across
            the available concalls. Filled cell = mentioned; empty cell =
            not (yet) named. The cohort view of where capital, talent,
            and product attention are flowing.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {cols.length} initiatives across {LISTED_AMC_SLUGS.length} AMCs
          </p>
        </div>
      }
      stackHeader
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: "720px" }}>
          <thead>
            <tr className="border-b text-left">
              <th className="sticky left-0 z-10 bg-card py-2 pr-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Initiative
              </th>
              {LISTED_AMC_SLUGS.map((slug) => (
                <th
                  key={slug}
                  className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {DISPLAY_NAME[slug]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map((init) => {
              const key = init.toLowerCase().trim();
              return (
                <tr
                  key={init}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  <td className="sticky left-0 z-10 bg-card py-2 pr-3 text-[12px] font-medium capitalize text-foreground/90">
                    {init}
                  </td>
                  {LISTED_AMC_SLUGS.map((slug) => {
                    const hit = byAmc.get(slug)?.has(key);
                    return (
                      <td key={slug} className="px-2 py-2 text-center">
                        <Link
                          href={`/amc/${slug}`}
                          className="inline-block"
                          title={`${DISPLAY_NAME[slug]} — ${hit ? "mentioned" : "not mentioned"}`}
                        >
                          <span
                            className={cn(
                              "inline-block h-2.5 w-2.5 rounded-full",
                              hit
                                ? "bg-positive ring-2 ring-positive/30"
                                : "bg-muted-foreground/20"
                            )}
                          />
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Green dot = the AMC explicitly named the initiative on at
            least one of its available concalls.
          </li>
          <li>
            Grey dot = either not mentioned, or the AMC&rsquo;s concall
            isn&rsquo;t ingested yet. Click any cell to inspect that
            AMC&rsquo;s concall record.
          </li>
          <li>
            Read a row to see how many AMCs are leaning into a theme;
            read a column to see how broad an AMC&rsquo;s strategic
            stance is.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}
