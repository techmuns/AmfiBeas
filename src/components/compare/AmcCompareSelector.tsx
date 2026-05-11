"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ArrowLeftRight } from "lucide-react";

interface Option {
  amcSlug: string;
  displayName: string;
}

interface Props {
  amcs: readonly Option[];
  selectedA: string;
  selectedB: string;
}

export function AmcCompareSelector({ amcs, selectedA, selectedB }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const update = (next: { a?: string; b?: string }) => {
    const a = next.a ?? selectedA;
    const b = next.b ?? selectedB;
    const qs = new URLSearchParams({ a, b });
    startTransition(() => {
      router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
    });
  };

  const swap = () => update({ a: selectedB, b: selectedA });

  return (
    <div
      className={
        "flex flex-wrap items-end gap-3 rounded-lg border bg-card px-4 py-3 text-xs " +
        (pending ? "opacity-70" : "")
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          AMC A
        </span>
        <select
          value={selectedA}
          onChange={(e) => update({ a: e.target.value })}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          {amcs.map((a) => (
            <option key={a.amcSlug} value={a.amcSlug}>
              {a.displayName}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={swap}
        aria-label="Swap A and B"
        title="Swap A and B"
        className="mb-0.5 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ArrowLeftRight className="h-3 w-3" />
        Swap
      </button>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          AMC B
        </span>
        <select
          value={selectedB}
          onChange={(e) => update({ b: e.target.value })}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          {amcs.map((a) => (
            <option key={a.amcSlug} value={a.amcSlug}>
              {a.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
