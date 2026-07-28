import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

// Semantic <nav><ol> with aria-current on the active crumb — keyboard
// navigable for free since crumbs are plain links.
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /> : null}
              {item.href && !isLast ? (
                <Link
                  to={item.href}
                  className="rounded hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-medium text-ink" : ""}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
