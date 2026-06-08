import { redirect } from "next/navigation";

// The quarterly industry views were consolidated into the Total Market hub (/)
// and the AMC section. Map the legacy ?tab= values onto their new homes:
//   snapshot      -> /?tab=aum-mix
//   aaum-flows    -> /?tab=attribution
//   concentration -> /amc?tab=insights (Market Share Insights)
export default async function QuarterlyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : undefined;
  if (tab === "concentration") {
    redirect("/amc?tab=insights");
  }
  const map: Record<string, string> = {
    snapshot: "aum-mix",
    "aaum-flows": "attribution",
  };
  redirect(`/?tab=${tab && map[tab] ? map[tab] : "aum-mix"}`);
}
