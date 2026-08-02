import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import { Link } from "react-router";
import type { Notification } from "@prisma/client";
import { useFetcher } from "react-router";
import { EmptyState } from "~/components/shared/EmptyState";
import { formatAuDateTime } from "~/lib/dates";

export interface NotificationMenuProps {
  notifications: Notification[];
  unreadCount: number;
}

// Only entity types with their own top-level route are resolvable to a
// link — everything else (e.g. ProofGroup, which only exists nested inside
// an order drawer) shows as an unlinked row rather than a broken/guessed URL.
function resolveNotificationLink(notification: Notification): string | null {
  if (!notification.relatedEntityId) return null;
  switch (notification.relatedEntityType) {
    case "ExceptionCase":
      return `/exceptions/${notification.relatedEntityId}`;
    case "WarehousePickJob":
      return `/warehouse/${notification.relatedEntityId}`;
    case "ProductionJob":
      return `/production/${notification.relatedEntityId}`;
    default:
      return null;
  }
}

export function NotificationMenu({ notifications, unreadCount }: NotificationMenuProps) {
  const markReadFetcher = useFetcher();
  const markAllReadFetcher = useFetcher();

  function markRead(notificationId: string) {
    void markReadFetcher.submit(
      { _intent: "markRead", notificationId },
      { method: "post", action: "/notifications/actions" },
    );
  }

  function markAllRead() {
    void markAllReadFetcher.submit(
      { _intent: "markAllRead" },
      { method: "post", action: "/notifications/actions" },
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "Notifications"
          }
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <Bell aria-hidden="true" className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <div className="flex items-center justify-between pb-2">
            <p className="px-1 text-sm font-semibold text-ink">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="rounded px-1 text-xs font-medium text-brand-navy hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <EmptyState
              title="No notifications yet"
              description="You'll see updates here as they happen."
              icon={Bell}
            />
          ) : (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {notifications.map((notification) => {
                const isUnread = notification.readAt === null;
                const href = resolveNotificationLink(notification);
                const content = (
                  <>
                    <p className="text-sm font-medium text-ink">{notification.title}</p>
                    {notification.body ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{notification.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted">
                      {formatAuDateTime(notification.createdAt)}
                    </p>
                  </>
                );
                const rowClassName = `block rounded-md p-2 text-left ${
                  isUnread ? "bg-page" : ""
                } hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy`;

                return (
                  <li key={notification.id}>
                    {href ? (
                      <Link
                        to={href}
                        onClick={() => {
                          if (isUnread) markRead(notification.id);
                        }}
                        className={rowClassName}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (isUnread) markRead(notification.id);
                        }}
                        className={`w-full ${rowClassName}`}
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
