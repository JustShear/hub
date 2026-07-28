import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Move } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { BOARD_COLUMNS, type BoardColumnKey } from "~/domain/orders/board-columns";
import { canMoveOrderToColumn } from "~/domain/orders/workflow-transitions";

export interface MoveToMenuProps {
  currentWorkflowStatus: OrderStatus;
  currentColumnKey: BoardColumnKey | null;
  onMove: (targetColumnKey: BoardColumnKey) => void;
  disabled?: boolean;
}

// The guaranteed keyboard-accessible path for moving a card — works
// identically whether or not the pointer/touch drag gesture is used, and
// calls the exact same onMove handler (same server validation either way).
export function MoveToMenu({
  currentWorkflowStatus,
  currentColumnKey,
  onMove,
  disabled,
}: MoveToMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Move aria-hidden="true" className="h-3 w-3" />
          Move to…
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 w-56 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {BOARD_COLUMNS.filter((column) => column.key !== currentColumnKey).map((column) => {
            const check = canMoveOrderToColumn(currentWorkflowStatus, column.key);
            return (
              <DropdownMenu.Item
                key={column.key}
                disabled={!check.allowed}
                onSelect={() => {
                  if (check.allowed) onMove(column.key);
                }}
                title={!check.allowed ? check.reason : undefined}
                className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[disabled]:opacity-60"
              >
                {column.label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
