import { PageHeader } from "@/components/layout/PageHeader";
import { StockSearchView } from "@/components/data/StockSearchView";

// Static shell: the company directory and each company's holder list are fetched
// on demand from /stocks/*.json, so the Worker serves a prerendered page and
// never pays per-request CPU to scan the holdings universe.
export const dynamic = "force-static";

export const metadata = {
  title: "Search Stocks — AmfiBeas",
};

export default function SearchStocksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Search Stocks"
        subtitle="Which mutual funds own a company"
      />
      <StockSearchView />
    </div>
  );
}
