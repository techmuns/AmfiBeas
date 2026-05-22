export interface NamedValue {
  name: string;
  value: number;
}

export interface TopNResult {
  topN: NamedValue[];
  others: number;
  total: number;
  topNShare: number;
  isTrueTopN: boolean;
}

export function topNWithOthers(
  rows: NamedValue[],
  n: number
): TopNResult {
  const valid = rows.filter(
    (r) => typeof r.value === "number" && Number.isFinite(r.value)
  );
  const sorted = [...valid].sort((a, b) => b.value - a.value);
  const topN = sorted.slice(0, n);
  const tail = sorted.slice(n);
  const others = tail.reduce((acc, r) => acc + r.value, 0);
  const total = sorted.reduce((acc, r) => acc + r.value, 0);
  const topNSum = topN.reduce((acc, r) => acc + r.value, 0);
  const topNShare = total > 0 ? (topNSum / total) * 100 : Number.NaN;
  return {
    topN,
    others,
    total,
    topNShare,
    isTrueTopN: topN.length === n,
  };
}
