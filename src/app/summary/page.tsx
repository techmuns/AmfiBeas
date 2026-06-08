import { redirect } from "next/navigation";

// The industry summary now lives on the Total Market hub (/).
export default async function SummaryRedirect() {
  redirect("/");
}
