import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

// For "nothing here yet" — never seed fake content to fill this space.
export function EmptyState({ title, description, icon: Icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-8 text-center">
      {Icon ? <Icon aria-hidden="true" className="h-8 w-8 text-muted" /> : null}
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
