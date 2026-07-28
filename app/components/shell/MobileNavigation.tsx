import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import type { NavGroup } from "~/lib/navigation";
import { NavLinks } from "~/components/shell/NavLinks";

export interface MobileNavigationProps {
  groups: NavGroup[];
  integrationIssueCount: number;
}

// Radix Dialog gives us focus trapping, Escape-to-close, and
// scroll-locking for free — hand-building that correctly is exactly the
// kind of accessibility work the milestone spec asked us not to redo.
export function MobileNavigation({ groups, integrationIssueCount }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy lg:hidden"
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col gap-4 bg-surface p-4 shadow-lg focus:outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-ink">Menu</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Site navigation links</Dialog.Description>
          <NavLinks
            groups={groups}
            integrationIssueCount={integrationIssueCount}
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
