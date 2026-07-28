import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "error";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-border/70 text-ink",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
}

// Never the only signal of state — always paired with text (the badge's own
// label, or text next to it), per the "don't use colour alone" requirement.
export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
