import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "~/components/shared/Breadcrumbs";

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  statusBadge?: ReactNode;
}

// The single h1 per page lives here — route content below should start at
// h2, keeping heading hierarchy correct without every route re-deriving it.
export function PageHeader({
  title,
  description,
  breadcrumbs,
  primaryAction,
  secondaryActions,
  statusBadge,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {statusBadge}
          </div>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {primaryAction || secondaryActions ? (
          <div className="flex flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </div>
  );
}
