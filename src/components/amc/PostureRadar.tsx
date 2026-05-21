import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { RadarPosture } from "@/components/charts/RadarPosture";
import {
  POSTURE_AXES,
  amcPostureScores,
  type PostureScores,
} from "@/data/amc-narratives";

interface PostureRadarProps {
  slug: string;
  amcDisplayName: string;
}

/**
 * 5-axis strategic posture radar for a single AMC. Surfaces the latest
 * concall's quantified posture across digital maturity, geographic
 * depth, channel diversity, pipeline breadth, and cohort breadth.
 */
export function PostureRadar({ slug, amcDisplayName }: PostureRadarProps) {
  const scores = amcPostureScores(slug);
  if (!scores) {
    return (
      <Card
        title="Strategic Posture"
        subtitle={`5-axis posture snapshot for ${amcDisplayName}. Awaiting concall data.`}
        stackHeader
      >
        <p className="text-sm text-muted-foreground">
          The posture radar surfaces five axes scored 0-100 from the
          latest concall: digital maturity, geographic depth, channel
          diversity, pipeline breadth, and cohort breadth. It populates
          once the next earnings call is processed.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Strategic Posture"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Where this AMC sits on five strategic axes, scored 0-100 from
            the most recent concall disclosures.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            Source: {scores.asOf} concall · dashed grid = axis not disclosed
          </p>
        </div>
      }
      stackHeader
    >
      <RadarPosture
        axes={POSTURE_AXES}
        series={[
          {
            name: amcDisplayName,
            color: "hsl(var(--chart-1))",
            values: scoresToRecord(scores),
          },
        ]}
      />
      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Each axis is scored 0-100. <span className="text-foreground">Bigger
            shape = broader strategic posture overall</span>.
          </li>
          <li>
            Missing axes (where the AMC didn&rsquo;t disclose the
            underlying metric) collapse to zero on the radar but still
            show on the grid.
          </li>
          <li>
            Numbers come from the latest concall&rsquo;s metrics +
            channel-mix + initiatives — they refresh when the next call is
            processed.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}

/**
 * Side-by-side variant: overlays two AMCs on one radar. Used on
 * `/compare`.
 */
export function PostureRadarCompare({
  slugA,
  slugB,
  nameA,
  nameB,
}: {
  slugA: string;
  slugB: string;
  nameA: string;
  nameB: string;
}) {
  const a = amcPostureScores(slugA);
  const b = amcPostureScores(slugB);
  if (!a && !b) return null;
  const series = [];
  if (a) {
    series.push({
      name: nameA,
      color: "hsl(var(--chart-1))",
      values: scoresToRecord(a),
    });
  }
  if (b) {
    series.push({
      name: nameB,
      color: "hsl(var(--chart-3))",
      values: scoresToRecord(b),
    });
  }
  return (
    <Card
      title="Strategic Posture Overlay"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Two AMCs on a single posture radar. The further the shape
            extends along an axis, the stronger that AMC&rsquo;s posture
            on that dimension.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {[a && `${nameA} (${a.asOf})`, b && `${nameB} (${b.asOf})`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      }
      stackHeader
    >
      <RadarPosture axes={POSTURE_AXES} series={series} />
    </Card>
  );
}

function scoresToRecord(s: PostureScores): Record<string, number | null> {
  return {
    digitalMaturity: s.digitalMaturity,
    geographicDepth: s.geographicDepth,
    channelDiversity: s.channelDiversity,
    pipelineBreadth: s.pipelineBreadth,
    cohortBreadth: s.cohortBreadth,
  };
}
