import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { DataFreshnessFooter } from "./DataFreshnessFooter";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
        <DataFreshnessFooter />
      </div>
    </div>
  );
}
