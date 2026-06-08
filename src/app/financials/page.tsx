import { redirect } from "next/navigation";

// Listed-AMC financials now live inside the AMC Compare tool, alongside the
// AAUM / market-share / growth comparison (AMC vs AMC vs Industry vs Avg).
export default async function FinancialsRedirect() {
  redirect("/amc?tab=compare");
}
