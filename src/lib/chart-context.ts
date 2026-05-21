/**
 * Per-chart helpers for the "trends + proportions + insights"
 * template the dashboard standardised on. Pure functions, no
 * imports of UI components — these can be called from server
 * components without crossing the RSC boundary.
 */

export interface SeriesPoint {
  label: string;
  value: number;
}

/** Trailing N-period moving average. Used to overlay a calm trend
 *  line on top of monthly / quarterly bars so the eye can separate
 *  noise from direction. Window defaults to 12. */
export function movingAverage(
  series: SeriesPoint[],
  window = 12
): { label: string; value: number | null }[] {
  return series.map((p, i) => {
    if (i + 1 < window) return { label: p.label, value: null };
    const slice = series.slice(i + 1 - window, i + 1);
    const sum = slice.reduce((s, q) => s + q.value, 0);
    return { label: p.label, value: sum / window };
  });
}

/** Trailing N-period moving average computed over a FULL historical
 *  series, then sliced to the visible tail. Use this instead of calling
 *  `movingAverage()` on a pre-sliced series — that pattern makes the
 *  trendline `null` for the first `window-1` visible points, which
 *  visually reads as "the average line starts halfway through the
 *  chart". By passing the full history here, the visible window
 *  always shows real average values whenever prior data exists.
 *
 *  Gaps remain only where the underlying snapshot genuinely has fewer
 *  than `window-1` months of prior data — never fake backfill.
 *
 *  Example:
 *    const visible = monthlyTrend(field, 24);           // last 24 months
 *    const history = monthlyTrend(field, 10_000);       // full history
 *    <BarSeries data={visible} trendline={
 *      slicedMovingAverage(history, 12, 24)             // 12M MA, last 24
 *    } />
 */
export function slicedMovingAverage(
  fullHistory: SeriesPoint[],
  window: number,
  visibleLength: number
): { label: string; value: number | null }[] {
  return movingAverage(fullHistory, window).slice(-visibleLength);
}

/** Picks the right average overlay for a chart card based on actual
 *  data depth. The single helper every trendline callsite on the
 *  dashboard should use — it removes the "average line starts
 *  halfway through the chart" problem entirely.
 *
 *  Resolution rule:
 *   - When `fullHistory.length >= visibleSeries.length + window − 1`,
 *     returns a **trailing-window MA** series aligned to the visible
 *     window. Every visible point has a real average. Caller wires
 *     it as `trendline={overlay.trendline} trendlineName={overlay.label}`
 *     and uses no `referenceValue`.
 *   - Otherwise, returns a **visible-period mean** — a single
 *     horizontal value rendered as `referenceValue` with
 *     `referenceLabel="Shown-period avg"`. Real values only, no fake
 *     early-period numbers. Caller passes no `trendline`.
 *   - When even the visible series is empty / single-point, returns
 *     `{ kind: "none" }` so the caller can suppress both overlays.
 *
 *  Window-to-label map: 12 → "12-month avg", 4 → "4-quarter avg",
 *  anything else → "${window}-period avg". Visible-mean label is
 *  always "Shown-period avg".
 */
export function adaptiveAverageOverlay(
  fullHistory: SeriesPoint[],
  visibleSeries: SeriesPoint[],
  window: number
):
  | { kind: "trailing"; trendline: { label: string; value: number | null }[]; label: string }
  | { kind: "visible-mean"; referenceValue: number; label: string }
  | { kind: "none" } {
  if (!visibleSeries || visibleSeries.length < 2) {
    return { kind: "none" };
  }
  const trailingLabel =
    window === 12
      ? "12-month avg"
      : window === 4
        ? "4-quarter avg"
        : `${window}-period avg`;
  if (fullHistory.length >= visibleSeries.length + window - 1) {
    return {
      kind: "trailing",
      trendline: slicedMovingAverage(fullHistory, window, visibleSeries.length),
      label: trailingLabel,
    };
  }
  const finite = visibleSeries.filter(
    (p) => typeof p.value === "number" && Number.isFinite(p.value)
  );
  if (finite.length < 2) return { kind: "none" };
  const mean = finite.reduce((s, p) => s + p.value, 0) / finite.length;
  return {
    kind: "visible-mean",
    referenceValue: mean,
    label: "Shown-period avg",
  };
}

/** Latest-point YoY % change vs a lag-N prior point. Returns null
 *  when the series is too short, when either anchor value isn't a
 *  finite number, or when the prior value is zero (would divide
 *  by zero). Mirrors the math the chartInsights() YoY rule uses so
 *  the header badge and the insight line stay in lockstep. */
export function latestYoyPct(
  series: SeriesPoint[],
  lag: number
): number | null {
  if (series.length <= lag) return null;
  const latest = series[series.length - 1];
  const prior = series[series.length - 1 - lag];
  if (!Number.isFinite(latest.value) || !Number.isFinite(prior.value)) {
    return null;
  }
  if (prior.value === 0) return null;
  return ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
}

/** Year-over-year % change for each point in a monthly series, where
 *  the lookback is 12 entries. Quarterly callers pass `lag = 4`. */
export function yoyPctSeries(
  series: SeriesPoint[],
  lag = 12
): { label: string; value: number | null }[] {
  return series.map((p, i) => {
    if (i < lag) return { label: p.label, value: null };
    const prior = series[i - lag].value;
    if (prior === 0) return { label: p.label, value: null };
    return {
      label: p.label,
      value: ((p.value - prior) / Math.abs(prior)) * 100,
    };
  });
}

/** Population standard deviation of a numeric series. */
function popStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return variance > 0 ? Math.sqrt(variance) : null;
}

export interface PeerSeriesContext {
  /** Display name for the peer series — used in divergence text (e.g.
   *  "industry net inflow"). */
  name: string;
  /** Peer time series — must use the SAME labels as the primary series
   *  so the engine can align by `latest.label`. Missing labels are
   *  silently skipped. */
  data: SeriesPoint[];
}

export interface ChartInsightOpts {
  /** Optional name to use in the generated text (e.g. "SIP contribution"). */
  metricName?: string;
  /** Units suffix for absolute-value hints (defaults to "" — caller can
   *  pass "%" / "₹ Cr" etc.). */
  unitSuffix?: string;
  /** Whether higher is "good" — drives the tone of cycle / drawdown
   *  cross-references. Defaults to true. */
  higherIsBetter?: boolean;
  /** Optional Nifty 500 drawdown by month, keyed by the same labels
   *  used in `series`. Lets the insight engine emit "coincides with
   *  Nifty −10% drawdown" callouts when relevant. */
  drawdownByLabel?: Map<string, number>;
  /** Lookback for YoY-style comparisons (12 for monthly, 4 for
   *  quarterly). When set, the engine emits a "YoY +X%" line — and an
   *  "accelerating / decelerating" tag if the prior period's YoY was
   *  also computable. */
  yoyLag?: number;
  /** Paired comparison series. Enables a "divergent from {peer}" line
   *  when the latest move signs differ — useful for SIP-vs-net-flow
   *  or active-vs-passive cross-reads. */
  peer?: PeerSeriesContext;
  /** Optional cycle phase keyed by series label. Lets the engine emit
   *  "Latest reading sits in a Correction cycle phase" callouts so
   *  charts can be read in regime context without leaving the card. */
  cyclePhaseByLabel?: Map<string, string>;
  /** Named historical anchors (e.g. "COVID 2020", "FY23 correction").
   *  When the latest reading is a new extreme since the most recent
   *  anchor that's inside the series window, the engine emits a
   *  "highest / lowest since the {title}" line. */
  episodeAnchors?: { label: string; title: string }[];
}

/**
 * Rule-based pattern detector that emits 0-3 short English insight
 * lines for a time series. Designed to feed the per-chart insight
 * strip under every chart. Pure rules — no model.
 *
 * The engine looks for, in priority order:
 *   1. all-time high / low at the latest point
 *   2. σ-spikes (latest MoM Δ > ±2σ of historical MoM changes)
 *   3. multi-period high / low (e.g. highest in 12 periods) when the
 *      latest reading isn't an outright ATH
 *   3b. extreme since a named historical episode (when
 *       `opts.episodeAnchors` supplied) — "Lowest since COVID 2020"
 *   4. divergence from a paired peer series (when `opts.peer` supplied)
 *   5. consecutive directional runs (≥ 2 same-direction MoM moves)
 *   6. YoY change with an "accelerating / decelerating" tag (when
 *      `opts.yoyLag` supplied)
 *   6b. cycle phase coincidence (when `opts.cyclePhaseByLabel`
 *       supplied) — only fires for "Correction" / "Peak" phases.
 *   7. coincidence with a meaningful Nifty 500 drawdown
 *   8. fallback: vs trailing-12 average
 *
 * Returns at most 3 strings.
 */
export function chartInsights(
  series: SeriesPoint[],
  opts: ChartInsightOpts = {}
): string[] {
  if (series.length < 3) return [];
  const out: string[] = [];
  const name = opts.metricName ?? "this metric";
  const unit = opts.unitSuffix ?? "";
  const latest = series[series.length - 1];
  const values = series.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);

  // 1. All-time high / low
  let isAth = false;
  let isAtl = false;
  if (latest.value === max && values.filter((v) => v === max).length === 1) {
    isAth = true;
    out.push(
      `${cap(name)} at an all-time high — ${formatValue(latest.value, unit)}.`
    );
  } else if (
    latest.value === min &&
    values.filter((v) => v === min).length === 1
  ) {
    isAtl = true;
    out.push(
      `${cap(name)} at an all-time low — ${formatValue(latest.value, unit)}.`
    );
  }

  // 2. σ-spike on the latest MoM — promoted ahead of the directional
  //    run because a single outlier move is more newsworthy than "3
  //    months up in a row".
  if (series.length >= 4) {
    const moves = series
      .slice(1)
      .map((p, i) => p.value - series[i].value);
    const sd = popStdDev(moves);
    const lastMove = moves[moves.length - 1];
    if (sd !== null && sd > 0) {
      const z = lastMove / sd;
      if (Math.abs(z) >= 2) {
        const sign = lastMove >= 0 ? "+" : "";
        out.push(
          `${sign}${formatValue(lastMove, unit)} MoM — biggest move in recent history (${z >= 0 ? "+" : ""}${z.toFixed(1)}σ vs typical).`
        );
      }
    }
  }

  // 3. Multi-period high / low — only fires when the latest reading is
  //    an N-period extreme but NOT an outright ATH/ATL (we already
  //    emitted that line). Walks back to find the last time the value
  //    was equal or more extreme, so we can anchor "highest since X".
  if (!isAth && !isAtl && series.length >= 12) {
    const lastIdx = series.length - 1;
    let priorIdx = -1;
    let extremeKind: "high" | "low" | null = null;
    // Highest in trailing window
    if (latest.value > Math.max(...values.slice(0, lastIdx).slice(-11))) {
      // Find prior occurrence ≥ latest.value, walking back from the
      // start of that 11-period window.
      for (let i = lastIdx - 12; i >= 0; i--) {
        if (series[i].value >= latest.value) {
          priorIdx = i;
          extremeKind = "high";
          break;
        }
      }
      if (extremeKind === null) {
        priorIdx = 0;
        extremeKind = "high";
      }
    } else if (latest.value < Math.min(...values.slice(0, lastIdx).slice(-11))) {
      for (let i = lastIdx - 12; i >= 0; i--) {
        if (series[i].value <= latest.value) {
          priorIdx = i;
          extremeKind = "low";
          break;
        }
      }
      if (extremeKind === null) {
        priorIdx = 0;
        extremeKind = "low";
      }
    }
    if (extremeKind && priorIdx >= 0) {
      const gap = lastIdx - priorIdx;
      out.push(
        extremeKind === "high"
          ? `Highest in ${gap} periods — last topped ${series[priorIdx].label}.`
          : `Lowest in ${gap} periods — last dipped ${series[priorIdx].label}.`
      );
    }
  }

  // 3b. Episode anchor — when the latest reading is a new extreme
  //     since the most recent NAMED historical episode that's still
  //     inside the series window. Skipped when the latest is already
  //     flagged as ATH/ATL (the all-time line subsumes it).
  if (
    !isAth &&
    !isAtl &&
    opts.episodeAnchors &&
    opts.episodeAnchors.length > 0 &&
    series.length >= 4
  ) {
    // Pick the most recent anchor whose label is inside the series and
    // isn't the latest point itself (latest can't be "since itself").
    let anchorIdx = -1;
    let anchorTitle = "";
    for (const ep of opts.episodeAnchors) {
      const idx = series.findIndex((p) => p.label === ep.label);
      if (idx >= 0 && idx < series.length - 1 && idx > anchorIdx) {
        anchorIdx = idx;
        anchorTitle = ep.title;
      }
    }
    if (anchorIdx >= 0) {
      const sliceValues = values.slice(anchorIdx);
      const sliceMax = Math.max(...sliceValues);
      const sliceMin = Math.min(...sliceValues);
      if (
        latest.value === sliceMax &&
        sliceValues.filter((v) => v === sliceMax).length === 1
      ) {
        out.push(`Highest since the ${anchorTitle}.`);
      } else if (
        latest.value === sliceMin &&
        sliceValues.filter((v) => v === sliceMin).length === 1
      ) {
        out.push(`Lowest since the ${anchorTitle}.`);
      }
    }
  }

  // 4. Divergence from a paired peer series — strongest cross-series
  //    signal we have. Compares the sign of the latest MoM move on
  //    both series. Only emits when the signs differ AND both moves
  //    are non-trivial relative to their own series scale.
  if (opts.peer && series.length >= 2) {
    const peerByLabel = new Map(opts.peer.data.map((p) => [p.label, p.value]));
    const latestPeer = peerByLabel.get(latest.label);
    const prevPeer = peerByLabel.get(series[series.length - 2].label);
    const latestSelf = latest.value;
    const prevSelf = series[series.length - 2].value;
    if (
      typeof latestPeer === "number" &&
      typeof prevPeer === "number" &&
      Number.isFinite(latestPeer) &&
      Number.isFinite(prevPeer)
    ) {
      const selfDelta = latestSelf - prevSelf;
      const peerDelta = latestPeer - prevPeer;
      const selfDir = Math.sign(selfDelta);
      const peerDir = Math.sign(peerDelta);
      // Both moves must be material relative to their own scale —
      // tiny noise shouldn't be called divergence.
      const selfMaterial =
        Math.abs(prevSelf) > 0
          ? Math.abs(selfDelta / prevSelf) >= 0.01
          : Math.abs(selfDelta) > 0;
      const peerMaterial =
        Math.abs(prevPeer) > 0
          ? Math.abs(peerDelta / prevPeer) >= 0.01
          : Math.abs(peerDelta) > 0;
      if (selfDir !== 0 && peerDir !== 0 && selfDir !== peerDir && selfMaterial && peerMaterial) {
        out.push(
          selfDir > 0
            ? `Rose while ${opts.peer.name} fell — flow divergence.`
            : `Fell while ${opts.peer.name} rose — flow divergence.`
        );
      }
    }
  }

  // 5. Consecutive directional run
  const directions = series
    .slice(1)
    .map((p, i) => Math.sign(p.value - series[i].value));
  let runLen = 0;
  let runDir = 0;
  for (let i = directions.length - 1; i >= 0; i--) {
    if (i === directions.length - 1) {
      runDir = directions[i];
      runLen = runDir !== 0 ? 1 : 0;
    } else if (directions[i] === runDir && runDir !== 0) {
      runLen += 1;
    } else {
      break;
    }
  }
  if (runLen >= 2) {
    out.push(
      runDir > 0
        ? `Up for ${runLen} straight periods.`
        : `Down for ${runLen} straight periods.`
    );
  }

  // 6. YoY change + acceleration tag — only fires when caller supplies
  //    a meaningful lookback (12 for monthly, 4 for quarterly). The
  //    acceleration tag compares the latest YoY % to the prior point's
  //    YoY % so the reader sees whether growth is speeding up or
  //    slowing.
  if (opts.yoyLag && series.length > opts.yoyLag + 1) {
    const lag = opts.yoyLag;
    const lastIdx = series.length - 1;
    const priorY = series[lastIdx - lag].value;
    if (priorY !== 0 && Number.isFinite(priorY)) {
      const yoy = ((latest.value - priorY) / Math.abs(priorY)) * 100;
      let accelTag = "";
      const prevIdx = lastIdx - 1;
      if (prevIdx - lag >= 0) {
        const prevSelf = series[prevIdx].value;
        const prevPriorY = series[prevIdx - lag].value;
        if (prevPriorY !== 0 && Number.isFinite(prevPriorY)) {
          const prevYoy = ((prevSelf - prevPriorY) / Math.abs(prevPriorY)) * 100;
          const delta = yoy - prevYoy;
          if (Math.abs(delta) >= 1) {
            accelTag =
              delta > 0
                ? ` — accelerating from ${prevYoy >= 0 ? "+" : ""}${prevYoy.toFixed(1)}% last period`
                : ` — decelerating from ${prevYoy >= 0 ? "+" : ""}${prevYoy.toFixed(1)}% last period`;
          }
        }
      }
      out.push(
        `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% YoY${accelTag}.`
      );
    }
  }

  // 6b. Cycle phase coincidence — when the latest reading sits in a
  //     notable regime ("Correction", "Peak"). Skipped for the
  //     "calmer" phases (Expansion, Recovery, Base) to keep the line
  //     count tight; those don't add narrative value.
  if (opts.cyclePhaseByLabel) {
    const phase = opts.cyclePhaseByLabel.get(latest.label);
    if (phase === "Correction" || phase === "Peak") {
      out.push(
        phase === "Correction"
          ? `Reading lands inside the current Correction phase.`
          : `Reading lands inside the current Peak phase.`
      );
    }
  }

  // 7. Cross-reference with Nifty drawdown if provided
  if (opts.drawdownByLabel) {
    const dd = opts.drawdownByLabel.get(latest.label);
    if (typeof dd === "number" && dd <= -10) {
      out.push(
        `Reads against a Nifty 500 down ${Math.abs(dd).toFixed(1)}%.`
      );
    }
  }

  // 8. Fallback: vs 12-period trend. Always emits when there's enough
  //    history — keeps every chart from going empty if no other rule
  //    fires.
  if (out.length === 0 && series.length >= 12) {
    const window = series.slice(-12).map((p) => p.value);
    const avg = window.reduce((s, v) => s + v, 0) / window.length;
    if (avg !== 0) {
      const pctVsTrend = ((latest.value - avg) / Math.abs(avg)) * 100;
      if (Math.abs(pctVsTrend) >= 2) {
        out.push(
          `${pctVsTrend >= 0 ? "+" : ""}${pctVsTrend.toFixed(1)}% vs trailing 12-period average.`
        );
      } else {
        out.push(`Running in line with the trailing 12-period trend.`);
      }
    }
  }

  return out.slice(0, 3);
}

function cap(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function formatValue(v: number, unit: string): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  // Compact ₹ Cr scaling for big numbers.
  if (unit === "₹ Cr" || unit === "Cr") {
    if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L Cr`;
    if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K Cr`;
    return `${sign}₹${abs.toFixed(0)} Cr`;
  }
  if (unit === "%") return `${sign}${abs.toFixed(1)}%`;
  if (unit === "bps") return `${sign}${abs.toFixed(0)} bps`;
  // Default: humanised integer.
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}
