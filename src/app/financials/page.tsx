import { Suspense } from "react";
import { FinancialsView } from "./FinancialsView";

// Static shell: the heavy single-AMC / compare computation runs CLIENT-side
// (FinancialsView reads ?amc= / ?period= / ?view= via useSearchParams), so the
// Cloudflare Worker only serves a static page and never re-renders this on
// demand — which is what was tripping the Worker resource limit (Error 1102).
export const dynamic = "force-static";

export default function FinancialsPage() {
  return (
    <Suspense fallback={null}>
      <FinancialsView />
    </Suspense>
  );
}
