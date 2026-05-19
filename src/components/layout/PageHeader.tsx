interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
