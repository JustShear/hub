import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, Mail, MoreVertical, Phone, X } from "lucide-react";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";
import { ORDER_STATUS_LABELS } from "~/domain/orders/labels";
import { PriorityBadge } from "~/components/board/CardBadges";
import { formatAuDate, formatAuDateTime } from "~/lib/dates";
import { OverviewTab } from "~/components/order-drawer/OverviewTab";
import { ProductsTab } from "~/components/order-drawer/ProductsTab";
import { UploadsTab } from "~/components/order-drawer/UploadsTab";
import { NotesTab } from "~/components/order-drawer/NotesTab";
import { ShopifyTab } from "~/components/order-drawer/ShopifyTab";
import { ActivityTab } from "~/components/order-drawer/ActivityTab";
import { PlaceholderTab } from "~/components/order-drawer/PlaceholderTab";
import { ProofsTab } from "~/components/order-drawer/proofs/ProofsTab";
import { FreightTab } from "~/components/order-drawer/freight/FreightTab";
import { WarehouseTab } from "~/components/order-drawer/warehouse/WarehouseTab";
import { ExceptionsTab } from "~/components/order-drawer/exceptions/ExceptionsTab";

export interface OrderDrawerProps {
  order: OrderDetail;
  shopDomain: string | null;
  assignableStaff: { id: string; name: string }[];
  canEditAssignment: boolean;
  canEditPriority: boolean;
  canEditDueDates: boolean;
  canViewNotes: boolean;
  canCreateNotes: boolean;
  canViewRawData: boolean;
  canViewIntegrations: boolean;
  canViewProofGroups: boolean;
  canCreateProofGroups: boolean;
  canUpdateProofGroups: boolean;
  canCancelProofGroups: boolean;
  canCreateProofVersions: boolean;
  canUpdateProofVersionStatus: boolean;
  canAssignProofArtwork: boolean;
  canCreateProofNotes: boolean;
  canCreateProofRequests: boolean;
  canViewProofRequests: boolean;
  canResendProofRequests: boolean;
  canRevokeProofRequests: boolean;
  canViewProofResponses: boolean;
  canOverrideProofResponses: boolean;
  canManageProofReminders: boolean;
  canViewFreight: boolean;
  canCreateFreight: boolean;
  canDownloadFreight: boolean;
  canCancelFreight: boolean;
  canViewWarehousePicks: boolean;
  canViewExceptionCases: boolean;
  canCreateExceptionCases: boolean;
}

function nearestDueDate(order: OrderDetail) {
  if (order.dueDates.length === 0) return null;
  return order.dueDates.reduce((closest, current) =>
    current.dueDate < closest.dueDate ? current : closest,
  );
}

export function OrderDrawer({
  order,
  shopDomain,
  assignableStaff,
  canEditAssignment,
  canEditPriority,
  canEditDueDates,
  canViewNotes,
  canCreateNotes,
  canViewRawData,
  canViewProofGroups,
  canCreateProofGroups,
  canUpdateProofGroups,
  canCancelProofGroups,
  canCreateProofVersions,
  canUpdateProofVersionStatus,
  canAssignProofArtwork,
  canCreateProofNotes,
  canCreateProofRequests,
  canViewProofRequests,
  canResendProofRequests,
  canRevokeProofRequests,
  canViewProofResponses,
  canOverrideProofResponses,
  canManageProofReminders,
  canViewFreight,
  canCreateFreight,
  canDownloadFreight,
  canCancelFreight,
  canViewWarehousePicks,
  canViewExceptionCases,
  canCreateExceptionCases,
}: OrderDrawerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  function close() {
    void navigate({ pathname: "/orders", search: location.search });
  }

  const nearest = nearestDueDate(order);
  const adminUrl =
    shopDomain && order.shopifyLegacyOrderId
      ? `https://${shopDomain}/admin/orders/${order.shopifyLegacyOrderId}`
      : null;
  const rawDataUrl = `/dev/orders/${order.id}`;
  const drawerUrl = typeof window !== "undefined" ? window.location.href : "";

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus(`Couldn't copy ${label.toLowerCase()}.`);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          onEscapeKeyDown={close}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-lg focus:outline-none sm:w-[90vw] sm:max-w-3xl md:max-w-4xl"
        >
          <Dialog.Title className="sr-only">Order {order.orderNumber} details</Dialog.Title>
          <Dialog.Description className="sr-only">
            Internal order workspace for {order.orderNumber}, opened from the Kanban board.
          </Dialog.Description>

          <header className="flex flex-col gap-3 border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{order.orderNumber}</h2>
                  <PriorityBadge priority={order.priority} />
                  {order.integrationIssues.length > 0 ? (
                    <span title="Integration issue" className="text-warning">
                      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">This order has an open integration issue</span>
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {order.customerName ?? "No customer name on file"}
                </p>
                {order.customerEmail || order.customerPhone ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                    {order.customerEmail ? (
                      <a
                        href={`mailto:${order.customerEmail}`}
                        className="flex items-center gap-1 text-brand-navy hover:underline"
                      >
                        <Mail aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        {order.customerEmail}
                      </a>
                    ) : null}
                    {order.customerPhone ? (
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="flex items-center gap-1 text-brand-navy hover:underline"
                      >
                        <Phone aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        {order.customerPhone}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      aria-label="More actions"
                      className="rounded-md p-2 text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                    >
                      <MoreVertical aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 w-64 rounded-lg border border-border bg-surface p-1 shadow-lg"
                    >
                      {adminUrl ? (
                        <DropdownMenu.Item asChild>
                          <a
                            href={adminUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
                          >
                            Open in Shopify
                          </a>
                        </DropdownMenu.Item>
                      ) : null}
                      {canViewRawData ? (
                        <DropdownMenu.Item asChild>
                          <a
                            href={rawDataUrl}
                            className="block cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
                          >
                            Open Raw Data Inspector
                          </a>
                        </DropdownMenu.Item>
                      ) : null}
                      <DropdownMenu.Item
                        onSelect={() => {
                          void copyToClipboard(order.orderNumber, "Order number");
                        }}
                        className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
                      >
                        Copy order number
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => {
                          void copyToClipboard(drawerUrl, "Drawer link");
                        }}
                        className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page focus:bg-page"
                      >
                        Copy drawer link
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close order details"
                    onClick={close}
                    className="rounded-md p-2 text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>{ORDER_STATUS_LABELS[order.workflowStatus]}</span>
              <span>Assigned: {order.assignment?.staffUserName ?? "Unassigned"}</span>
              <span>Nearest due: {nearest ? formatAuDate(nearest.dueDate) : "None set"}</span>
              <span>Created {formatAuDate(order.shopifyCreatedAt)}</span>
              <span>
                Last synced {order.lastSyncedAt ? formatAuDateTime(order.lastSyncedAt) : "Never"}
              </span>
            </div>
            {copyStatus ? (
              <p role="status" className="text-xs text-success">
                {copyStatus}
              </p>
            ) : null}
          </header>

          <Tabs.Root defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border px-4">
              {[
                { value: "overview", label: "Overview" },
                { value: "products", label: "Products" },
                { value: "uploads", label: "Uploads" },
                { value: "proofs", label: "Proofs" },
                { value: "freight", label: "Freight" },
                { value: "warehouse", label: "Warehouse" },
                { value: "exceptions", label: "Exceptions" },
                { value: "communication", label: "Communication" },
                { value: "notes", label: "Notes" },
                { value: "shopify", label: "Shopify" },
                { value: "activity", label: "Activity" },
              ].map((tab) => (
                <Tabs.Trigger
                  key={tab.value}
                  value={tab.value}
                  className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-navy data-[state=active]:border-brand-navy data-[state=active]:text-ink"
                >
                  {tab.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Tabs.Content value="overview">
                <OverviewTab
                  order={order}
                  assignableStaff={assignableStaff}
                  canEditAssignment={canEditAssignment}
                  canEditPriority={canEditPriority}
                  canEditDueDates={canEditDueDates}
                />
              </Tabs.Content>
              <Tabs.Content value="products">
                <ProductsTab order={order} />
              </Tabs.Content>
              <Tabs.Content value="uploads">
                <UploadsTab order={order} />
              </Tabs.Content>
              <Tabs.Content value="proofs">
                {canViewProofGroups ? (
                  <ProofsTab
                    order={order}
                    assignableStaff={assignableStaff}
                    canCreateProofGroups={canCreateProofGroups}
                    canUpdateProofGroups={canUpdateProofGroups}
                    canCancelProofGroups={canCancelProofGroups}
                    canCreateProofVersions={canCreateProofVersions}
                    canUpdateProofVersionStatus={canUpdateProofVersionStatus}
                    canAssignProofArtwork={canAssignProofArtwork}
                    canCreateProofNotes={canCreateProofNotes}
                    canCreateProofRequests={canCreateProofRequests}
                    canViewProofRequests={canViewProofRequests}
                    canResendProofRequests={canResendProofRequests}
                    canRevokeProofRequests={canRevokeProofRequests}
                    canViewProofResponses={canViewProofResponses}
                    canOverrideProofResponses={canOverrideProofResponses}
                    canManageProofReminders={canManageProofReminders}
                  />
                ) : (
                  <PlaceholderTab
                    title="Proofs are restricted"
                    description="You don't have permission to view proof groups."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="freight">
                {canViewFreight ? (
                  <FreightTab
                    order={order}
                    canCreateFreight={canCreateFreight}
                    canDownloadFreight={canDownloadFreight}
                    canCancelFreight={canCancelFreight}
                  />
                ) : (
                  <PlaceholderTab
                    title="Freight is restricted"
                    description="You don't have permission to view freight shipments."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="warehouse">
                {canViewWarehousePicks ? (
                  <WarehouseTab order={order} />
                ) : (
                  <PlaceholderTab
                    title="Warehouse picking is restricted"
                    description="You don't have permission to view warehouse pick jobs."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="exceptions">
                {canViewExceptionCases ? (
                  <ExceptionsTab order={order} canCreateExceptionCases={canCreateExceptionCases} />
                ) : (
                  <PlaceholderTab
                    title="Exceptions are restricted"
                    description="You don't have permission to view exception cases."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="communication">
                <PlaceholderTab
                  title="Customer communication isn't enabled yet"
                  description="Customer proof communication is not enabled yet."
                />
              </Tabs.Content>
              <Tabs.Content value="notes">
                {canViewNotes ? (
                  <NotesTab
                    orderId={order.id}
                    initialNotes={order.notes}
                    initialHasMore={order.notesHasMore}
                    canCreateNotes={canCreateNotes}
                  />
                ) : (
                  <PlaceholderTab
                    title="Notes are restricted"
                    description="You don't have permission to view internal notes."
                  />
                )}
              </Tabs.Content>
              <Tabs.Content value="shopify">
                <ShopifyTab order={order} shopDomain={shopDomain} />
              </Tabs.Content>
              <Tabs.Content value="activity">
                <ActivityTab
                  orderId={order.id}
                  initialEvents={order.activity}
                  initialHasMore={order.activityHasMore}
                />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
