import { cn } from "@/lib/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function Card({
  title,
  subtitle,
  action,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...rest}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-4">
          <div>
            {title && (
              <h3 className="text-sm font-medium tracking-tight">{title}</h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      )}
      <div className="px-5 pb-5 pt-3">{children}</div>
    </div>
  );
}
