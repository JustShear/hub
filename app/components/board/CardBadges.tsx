import type { ComponentType } from "react";
import { ArrowDown, ArrowUp, Equal, Siren } from "lucide-react";
import type { Priority } from "@prisma/client";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { formatAuDate } from "~/lib/dates";
import {
  DUE_DATE_STATE_LABELS,
  DUE_DATE_TYPE_LABELS,
  PRIORITY_LABELS,
} from "~/domain/orders/labels";
import type { BoardCardDueDate } from "~/domain/orders/board-query.server";

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warning",
  URGENT: "error",
};

const PRIORITY_ICON: Record<
  Priority,
  ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
> = {
  LOW: ArrowDown,
  NORMAL: Equal,
  HIGH: ArrowUp,
  URGENT: Siren,
};

// Priority is never colour-only — an icon plus the text label are both
// always present alongside the tone.
export function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      <Icon aria-hidden="true" className="mr-1 inline h-3 w-3 align-text-bottom" />
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const DUE_DATE_TONE: Record<string, BadgeTone> = {
  overdue: "error",
  due_today: "warning",
  due_soon: "warning",
  future: "neutral",
  none: "neutral",
};

export function DueDateIndicator({ dueDate }: { dueDate: BoardCardDueDate | null }) {
  if (!dueDate) {
    return <span className="text-xs text-muted">No due date</span>;
  }
  return (
    <Badge tone={DUE_DATE_TONE[dueDate.state] ?? "neutral"}>
      <span className="sr-only">{DUE_DATE_STATE_LABELS[dueDate.state]}: </span>
      {formatAuDate(dueDate.dueDate)}
      <span className="ml-1 text-[10px] opacity-80">({DUE_DATE_TYPE_LABELS[dueDate.type]})</span>
    </Badge>
  );
}

export interface IndicatorChipProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  tone: BadgeTone;
}

export function IndicatorChip({ icon: Icon, label, tone }: IndicatorChipProps) {
  return (
    <Badge tone={tone}>
      <Icon aria-hidden="true" className="mr-1 inline h-3 w-3 align-text-bottom" />
      {label}
    </Badge>
  );
}

const MAX_VISIBLE_TAGS = 3;

export function TagChips({ tags }: { tags: string[] }) {
  const shown = tags.slice(0, MAX_VISIBLE_TAGS);
  const remaining = tags.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-border bg-page px-2 py-0.5 text-[11px] text-muted"
        >
          {tag}
        </span>
      ))}
      {remaining > 0 ? (
        <span className="rounded-full border border-border bg-page px-2 py-0.5 text-[11px] text-muted">
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}
