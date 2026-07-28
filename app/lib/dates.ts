// Shared date helpers — Australian formatting and due-date classification.
// No ".server" suffix: card components format dates client-side too.

export type DueDateState = "overdue" | "due_today" | "due_soon" | "future" | "none";

const DUE_SOON_WINDOW_DAYS = 3;
const MS_PER_DAY = 86_400_000;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// "Due soon" window is a Stage One default, not yet configurable per SRS —
// revisit as an AppSetting if staff want it tuned per shop.
export function classifyDueDate(dueDate: Date | null, now: Date = new Date()): DueDateState {
  if (!dueDate) {
    return "none";
  }
  const diffDays = Math.round(
    (startOfDay(dueDate).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
  );
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "due_today";
  if (diffDays <= DUE_SOON_WINDOW_DAYS) return "due_soon";
  return "future";
}

export function formatAuDate(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

export function formatAuDateTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function daysSince(date: Date | string, now: Date = new Date()): number {
  const value = typeof date === "string" ? new Date(date) : date;
  return Math.max(
    0,
    Math.floor((startOfDay(now).getTime() - startOfDay(value).getTime()) / MS_PER_DAY),
  );
}
