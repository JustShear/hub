import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, LogOut, User } from "lucide-react";
import { useFetcher, useSubmit } from "react-router";
import type { Theme } from "@prisma/client";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

export interface UserMenuProps {
  staffUser: StaffUserWithPermissions;
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "CLASSIC", label: "Classic" },
  { value: "DARK", label: "Dark" },
  { value: "COLOURED_MODERN", label: "Coloured modern" },
];

export function UserMenu({ staffUser }: UserMenuProps) {
  const submit = useSubmit();
  const themeFetcher = useFetcher();
  // Optimistic: reflect the in-flight selection immediately rather than
  // waiting for the app shell's loader to revalidate — same pattern as
  // OrderCard's needs-printing toggle.
  const currentTheme =
    (themeFetcher.formData?.get("theme") as Theme | null) ?? staffUser.theme;

  function setTheme(theme: Theme) {
    void themeFetcher.submit(
      { _intent: "setTheme", theme },
      { method: "post", action: "/profile/actions" },
    );
  }

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
          <DropdownMenu.RadioGroup
            value={currentTheme}
            onValueChange={(value) => {
              setTheme(value as Theme);
            }}
          >
            <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted">Theme</p>
            {THEME_OPTIONS.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden="true" className="h-4 w-4" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
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
