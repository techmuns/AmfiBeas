import { redirect } from "next/navigation";

// The monthly industry views were consolidated into the Total Market hub (/).
// Map the legacy ?tab= values onto their new homes so old links keep working.
const TAB_MAP: Record<string, string> = {
  snapshot: "snapshot",
  flows: "flow-table",
  "flow-table": "flow-table",
  "fee-mix": "fee-mix",
  categories: "categories",
  "market-cycle": "market-cycle",
};

export default async function MonthlyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? TAB_MAP[sp.tab] : undefined;
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (typeof sp.month === "string") params.set("month", sp.month);
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
