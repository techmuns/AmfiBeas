/**
 * Manual override layer for the official scheme-benchmark registry.
 *
 * Small, auditable, and explicitly NOT the primary architecture: the registry
 * is generated from first-party AMC documents, and overrides exist only for the
 * cases an automated parser cannot safely resolve (a benchmark change announced
 * in an addendum, an AMC whose factsheet is an image-only PDF, a scheme whose
 * name collides with another in its own house).
 *
 * Every override must carry its own first-party evidence URL and a reason —
 * an override without evidence is rejected by the validator exactly like a
 * scraped mapping without evidence would be. Overrides are applied LAST and win
 * over scraped evidence for the same scheme.
 *
 * File: manual-data/scheme-benchmarks/overrides.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { warn } from "../utils";
import type { BenchmarkSourceType } from "../../../src/data/scheme-benchmarks";

export const OVERRIDES_PATH = path.resolve(process.cwd(), "manual-data/scheme-benchmarks/overrides.json");

export interface SchemeBenchmarkOverride {
  /** Match by ANY of these: an API schemecode, or the underlying key. */
  schemecode?: string;
  underlyingKey?: string;
  /** Human label, for the reviewer. Not used for matching. */
  schemeName?: string;
  amc?: string;
  /** Benchmark exactly as the AMC document spells it. */
  officialBenchmarkName: string;
  /** First-party AMC URL the reviewer read it from. REQUIRED. */
  evidenceUrl: string;
  sourceType?: BenchmarkSourceType;
  sourceDocumentDate?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  /** Why a human had to intervene. REQUIRED. */
  reason: string;
  addedAt: string;
  updatedAt?: string;
  /** Prior identities, oldest first — lets a benchmark CHANGE be recorded. */
  history?: Array<{
    officialBenchmarkName: string;
    evidenceUrl: string;
    sourceType?: BenchmarkSourceType;
    sourceDocumentDate?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }>;
}

export interface OverridesFile {
  meta?: { version?: number; note?: string; lastUpdated?: string };
  overrides: SchemeBenchmarkOverride[];
}

export interface LoadedOverrides {
  bySchemecode: Map<string, SchemeBenchmarkOverride>;
  byUnderlyingKey: Map<string, SchemeBenchmarkOverride>;
  rejected: Array<{ override: SchemeBenchmarkOverride; reason: string }>;
  total: number;
}

export async function loadOverrides(): Promise<LoadedOverrides> {
  const out: LoadedOverrides = { bySchemecode: new Map(), byUnderlyingKey: new Map(), rejected: [], total: 0 };
  let file: OverridesFile;
  try {
    file = JSON.parse(await fs.readFile(OVERRIDES_PATH, "utf8")) as OverridesFile;
  } catch {
    return out; // absent file = no overrides, which is the normal state
  }
  for (const o of file.overrides ?? []) {
    out.total += 1;
    if (!o.officialBenchmarkName?.trim()) {
      out.rejected.push({ override: o, reason: "missing officialBenchmarkName" });
      continue;
    }
    if (!/^https?:\/\//i.test(o.evidenceUrl ?? "")) {
      out.rejected.push({ override: o, reason: "missing or non-URL evidenceUrl — cannot be called official" });
      continue;
    }
    if (!o.reason?.trim()) {
      out.rejected.push({ override: o, reason: "missing reason" });
      continue;
    }
    if (!o.schemecode && !o.underlyingKey) {
      out.rejected.push({ override: o, reason: "override matches nothing (needs schemecode or underlyingKey)" });
      continue;
    }
    if (o.schemecode) out.bySchemecode.set(o.schemecode, o);
    if (o.underlyingKey) out.byUnderlyingKey.set(o.underlyingKey, o);
  }
  if (out.rejected.length > 0) {
    warn(`scheme-benchmark overrides: ${out.rejected.length} rejected (see coverage report)`);
  }
  return out;
}
