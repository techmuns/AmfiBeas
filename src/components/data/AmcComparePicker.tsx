"use client";

import { useRouter } from "next/navigation";

/**
 * Two-AMC picker for the head-to-head compare tool. URL-param driven (?a=&b=)
 * so the comparison itself stays server-rendered — changing a dropdown just
 * navigates, and the server recomputes the table.
 */
export function AmcComparePicker({
  universe,
  a,
  b,
}: {
  universe: { slug: string; displayName: string }[];
  a: string;
  b: string;
}) {
  const router = useRouter();
  const go = (na: string, nb: string) => {
    const params = new URLSearchParams({ tab: "compare", a: na, b: nb });
    router.push(`/amc?${params.toString()}`);
  };
  const select = (value: string, onChange: (v: string) => void) => (
    <select
      className="max-w-[14rem] rounded-md border bg-card px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {universe.map((u) => (
        <option key={u.slug} value={u.slug}>
          {u.displayName}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">A</span>
      {select(a, (v) => go(v, b))}
      <span className="text-xs text-muted-foreground">vs</span>
      <span className="text-xs font-medium text-muted-foreground">B</span>
      {select(b, (v) => go(a, v))}
    </div>
  );
}
