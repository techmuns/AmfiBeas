export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/80 px-6 backdrop-blur lg:px-8">
      <div className="text-sm text-muted-foreground">
        Indian AMC Dashboard
      </div>
      <div className="text-xs text-muted-foreground tabular">
        Demo data
      </div>
    </header>
  );
}
