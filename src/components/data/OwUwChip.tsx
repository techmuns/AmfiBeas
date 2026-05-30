"use client";

const DEFAULT_THRESHOLD_PP = 0.1;
const DEFAULT_MIN_PEER_COUNT = 5;

interface Props {
  selectedPct: number | null;
  peerAvg: number | null;
  peerCount: number;
  /** Total cohort size used to label the chip tooltip (e.g. "K of N"). */
  peerTarget?: number;
  /** Half-width of the "In line" band, in pp. Default 0.1pp ≡ 10 bps. */
  threshold?: number;
  /** Minimum peers that must have loaded before any non-`—` chip renders. */
  minPeerCount?: number;
}

/** Overweight / underweight chip for a single holding row, comparing the
 *  selected fund's % of AUM against the average across same-category peers.
 *  Renders one of: "—" | "In line" | "OW +X.Xpp" | "UW −X.Xpp" (1 dp). */
export function OwUwChip({
  selectedPct,
  peerAvg,
  peerCount,
  peerTarget,
  threshold = DEFAULT_THRESHOLD_PP,
  minPeerCount = DEFAULT_MIN_PEER_COUNT,
}: Props) {
  const tooltip = peerTarget
    ? `vs ${peerCount} of ${peerTarget} same-category peers by AUM`
    : `vs ${peerCount} same-category peers by AUM`;

  if (
    selectedPct === null ||
    peerAvg === null ||
    peerCount < minPeerCount
  ) {
    return <span className="text-muted-foreground">—</span>;
  }
  const delta = selectedPct - peerAvg;
  if (delta > threshold) {
    return (
      <span className="text-positive" title={tooltip}>
        OW +{delta.toFixed(1)}pp
      </span>
    );
  }
  if (delta < -threshold) {
    return (
      <span className="text-negative" title={tooltip}>
        UW −{Math.abs(delta).toFixed(1)}pp
      </span>
    );
  }
  return (
    <span className="text-muted-foreground" title={tooltip}>
      In line
    </span>
  );
}
