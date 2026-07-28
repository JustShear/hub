import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { EmptyState } from "~/components/shared/EmptyState";

// Search has no backing implementation yet (that's a later milestone) — this
// is deliberately a shell with an honest "not available yet" message rather
// than an input that looks functional but silently does nothing.
export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const isSlash = event.key === "/" && !isTyping;

      if (isShortcut || isSlash) {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-muted sm:inline">
            Ctrl K
          </kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed left-1/2 top-24 z-50 w-full max-w-lg -translate-x-1/2 rounded-lg border border-border bg-surface p-4 shadow-lg focus:outline-none">
          <Dialog.Title className="text-sm font-semibold text-ink">Search</Dialog.Title>
          <Dialog.Description className="sr-only">Global search status</Dialog.Description>
          <div className="mt-3">
            <EmptyState
              title="Search isn't available yet"
              description="Order and customer search is planned for a future milestone."
              icon={Search}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
