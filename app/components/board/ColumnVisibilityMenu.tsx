import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Columns3 } from "lucide-react";
import { BOARD_COLUMNS } from "~/domain/orders/board-columns";

export interface ColumnVisibilityMenuProps {
  /** undefined means every column is currently visible (the default). */
  visibleColumns: string[] | undefined;
  /** undefined means "reset to show every column" — matches boardFiltersToSearchParams' own convention. */
  onChange: (next: string[] | undefined) => void;
}

// A personal display preference, not a permission-gated capability — any
// staff member who can see the board can hide columns they don't need,
// same as sort/filters. Persisted the same way (URL search params), and
// round-trips through a saved view via SavedViewConfig.visibleColumns.
export function ColumnVisibilityMenu({ visibleColumns, onChange }: ColumnVisibilityMenuProps) {
  const activeKeys = new Set(visibleColumns ?? BOARD_COLUMNS.map((c) => c.key));

  function toggle(key: string) {
    const next = new Set(activeKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    // Always leave at least one column visible — hiding every column would
    // leave the board with nothing to show and no way back in via the UI.
    if (next.size === 0) return;
    onChange(next.size === BOARD_COLUMNS.length ? undefined : [...next]);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink hover:bg-surface"
        >
          <Columns3 aria-hidden="true" className="h-4 w-4" />
          Columns
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {BOARD_COLUMNS.map((column) => (
            <DropdownMenu.CheckboxItem
              key={column.key}
              checked={activeKeys.has(column.key)}
              onSelect={(event) => {
                // Keep the menu open across multiple toggles in one go.
                event.preventDefault();
              }}
              onCheckedChange={() => {
                toggle(column.key);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden="true" className="h-4 w-4 text-brand-navy" />
                </DropdownMenu.ItemIndicator>
              </span>
              {column.label}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
