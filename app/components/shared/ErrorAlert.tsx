import { AlertTriangle } from "lucide-react";

export interface ErrorAlertProps {
  title: string;
  description?: string;
  /** "error" for inline error alerts, "warning" for the integration-warning alert use case. */
  tone?: "error" | "warning";
}

const TONE_CLASSES = {
  error: { border: "border-error/40", bg: "bg-error/10", icon: "text-error" },
  warning: { border: "border-warning/40", bg: "bg-warning/10", icon: "text-warning" },
} as const;

// role="alert" + an icon + text — never colour as the only signal of state.
export function ErrorAlert({ title, description, tone = "error" }: ErrorAlertProps) {
  const classes = TONE_CLASSES[tone];

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border ${classes.border} ${classes.bg} p-4`}
    >
      <AlertTriangle aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${classes.icon}`} />
      <div>
        <p className="font-medium text-ink">{title}</p>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
    </div>
  );
}
