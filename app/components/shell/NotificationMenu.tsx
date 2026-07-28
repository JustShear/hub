import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import { EmptyState } from "~/components/shared/EmptyState";

// No notification source exists yet — this is a shell showing an honest
// empty state rather than seeded/fake notification items.
export function NotificationMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <Bell aria-hidden="true" className="h-5 w-5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <p className="px-1 pb-2 text-sm font-semibold text-ink">Notifications</p>
          <EmptyState
            title="No notifications yet"
            description="You'll see updates here once notifications are enabled."
            icon={Bell}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
