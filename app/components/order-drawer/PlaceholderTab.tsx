import { Hourglass } from "lucide-react";
import { EmptyState } from "~/components/shared/EmptyState";

export interface PlaceholderTabProps {
  title: string;
  description: string;
}

// Honest "not built yet" placeholder for future-milestone tabs (Proofs,
// Communication) — no fake records, progress bars, or clickable-looking
// controls, per the milestone's explicit ban on implying functionality
// that doesn't exist yet.
export function PlaceholderTab({ title, description }: PlaceholderTabProps) {
  return <EmptyState icon={Hourglass} title={title} description={description} />;
}
