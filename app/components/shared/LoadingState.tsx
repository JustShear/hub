import { Loader2 } from "lucide-react";

export interface LoadingStateProps {
  label?: string;
}

// Every one of our current loaders is a fast DB query, so a simple spinner
// is honest — a skeleton loader for something that resolves near-instantly
// would just be motion for its own sake. prefers-reduced-motion is handled
// globally in app.css.
export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div role="status" className="flex items-center gap-2 p-8 text-muted">
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
