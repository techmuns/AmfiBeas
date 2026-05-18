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
}

/**
 * Rule-based pattern detector that emits 0-3 short English insight
 * lines for a time series. Designed to feed the per-chart insight
 * strip under every chart. Pure rules — no model.
 *
 * The engine looks for, in order of priority:
 *   - all-time high / low at the latest point
 *   - consecutive directional runs (≥ 2 same-direction MoM moves)
 *   - σ-spikes (latest MoM Δ > ±2σ of historical MoM changes)
 *   - coincidence with a meaningful Nifty 500 drawdown
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
  if (latest.value === max && values.filter((v) => v === max).length === 1) {
    out.push(
      `${cap(name)} at an all-time high on the available window — ${formatValue(latest.value, unit)}.`
    );
  } else if (
    latest.value === min &&
    values.filter((v) => v === min).length === 1
  ) {
    out.push(
      `${cap(name)} at an all-time low on the available window — ${formatValue(latest.value, unit)}.`
    );
  }

  // 2. Consecutive directional run
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
        ? `${cap(name)} has risen for ${runLen} consecutive periods.`
        : `${cap(name)} has fallen for ${runLen} consecutive periods.`
    );
  }

  // 3. σ-spike on the latest MoM
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
          `Latest MoM change ${sign}${formatValue(lastMove, unit)} is ${z >= 0 ? "+" : ""}${z.toFixed(1)}σ vs the typical period change — an unusual move.`
        );
      }
    }
  }

  // 4. Cross-reference with Nifty drawdown if provided
  if (opts.drawdownByLabel) {
    const dd = opts.drawdownByLabel.get(latest.label);
    if (typeof dd === "number" && dd <= -10) {
      out.push(
        `Coincides with Nifty 500 in a ${Math.abs(dd).toFixed(1)}% drawdown.`
      );
    }
  }

  // 5. Fallback: vs 12-period trend. Always emits when there's enough
  //    history — keeps every chart from going empty if no other rule
  //    fires.
  if (out.length === 0 && series.length >= 12) {
    const window = series.slice(-12).map((p) => p.value);
    const avg = window.reduce((s, v) => s + v, 0) / window.length;
    if (avg !== 0) {
      const pctVsTrend = ((latest.value - avg) / Math.abs(avg)) * 100;
      if (Math.abs(pctVsTrend) >= 2) {
        out.push(
          `Latest reading is ${pctVsTrend >= 0 ? "+" : ""}${pctVsTrend.toFixed(1)}% vs the trailing 12-period average (${formatValue(avg, unit)}).`
        );
      } else {
        out.push(
          `Latest reading is within ±2% of the trailing 12-period average — running in line with trend.`
        );
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
