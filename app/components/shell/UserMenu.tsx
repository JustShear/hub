import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, User } from "lucide-react";
import { useSubmit } from "react-router";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

export interface UserMenuProps {
  staffUser: StaffUserWithPermissions;
}

export function UserMenu({ staffUser }: UserMenuProps) {
  const submit = useSubmit();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-blue/40 text-ink hover:bg-accent-blue/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
          aria-label={`Account menu for ${staffUser.name}`}
        >
          <User aria-hidden="true" className="h-5 w-5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-ink">{staffUser.name}</p>
            <p className="truncate text-xs text-muted">{staffUser.email}</p>
            <p className="mt-1 text-xs text-muted">{staffUser.roleNames.join(", ")}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => {
              void submit(null, { method: "post", action: "/logout" });
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
