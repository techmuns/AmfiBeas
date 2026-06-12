import { Topbar } from "./Topbar";
import { DataFreshnessFooter } from "./DataFreshnessFooter";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Topbar />
      <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
      <DataFreshnessFooter />
    </div>
  );
}
