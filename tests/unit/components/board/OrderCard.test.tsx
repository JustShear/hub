import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { DndContext } from "@dnd-kit/core";
import { OrderProofSummary, OrderStatus, OrderWarehousePickSummary, Priority } from "@prisma/client";
import { OrderCard } from "~/components/board/OrderCard";
import type { BoardCard } from "~/domain/orders/board-query.server";

function makeCard(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: "order_1",
    orderNumber: "#1001",
    customerName: "Jordan Smith",
    customerEmail: "jordan@example.com",
    shopifyCreatedAt: "2026-01-01T00:00:00.000Z",
    workflowStatus: OrderStatus.NEW,
    workflowStatusChangedAt: "2026-01-01T00:00:00.000Z",
    daysInState: 2,
    proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
    priority: Priority.NORMAL,
    tags: [],
    isPreorder: false,
    cardTintOverride: null,
    isWaitingOnCustomer: false,
    hasCustomerResponseAlert: false,
    isApprovedNotExported: false,
    hasFailedProofDelivery: false,
    hasActiveFreightShipment: false,
    freightTrackingNumber: null,
    freightShipment: null,
    isCancelled: false,
    warehousePickSummary: OrderWarehousePickSummary.NOT_STARTED,
    hasOpenWarehouseIssue: false,
    hasShortPickItems: false,
    hasOpenExceptionCase: false,
    hasCustomerUpload: false,
    hasDecorationLineMarker: false,
    hasEmbroideryLineMarker: false,
    hasCustomerNote: false,
    hasApprovalOrPaymentIssue: false,
    columnKey: "new",
    lines: [],
    lineCount: 0,
    proofGroupCount: 0,
    proofGroupSummary: {
      activeGroupCount: 0,
      readyCount: 0,
      requiringWorkCount: 0,
      noProofRequiredCount: 0,
      blockedCount: 0,
      waitingOnCustomerCount: 0,
      changesRequestedCount: 0,
      approvedCount: 0,
      readyForExportCount: 0,
      exportedCount: 0,
      latestThumbnail: null,
      latestApprovedThumbnail: null,
      assignedStaffNames: [],
    },
    assignment: null,
    nearestDueDate: null,
    integrationIssues: [],
    hasIntegrationIssue: false,
    ...overrides,
  };
}

function renderCard(card: BoardCard, canManage: boolean, canCreateFreightShipments = false) {
  const Stub = createRoutesStub([
    {
      path: "/orders",
      Component: () => (
        <DndContext>
          <OrderCard
            card={card}
            canManage={canManage}
            canViewIntegrations={true}
            canCreateFreightShipments={canCreateFreightShipments}
            isPending={false}
            onMove={vi.fn()}
          />
        </DndContext>
      ),
    },
  ]);
  return render(<Stub initialEntries={["/orders"]} />);
}

describe("OrderCard", () => {
  it("shows the order number, customer, priority, and tags", () => {
    renderCard(makeCard({ tags: ["embroidery", "rush"] }), true);
    expect(screen.getByText("#1001")).toBeInTheDocument();
    expect(screen.getByText("Jordan Smith")).toBeInTheDocument();
    expect(screen.getByText("embroidery")).toBeInTheDocument();
    expect(screen.getByText("rush")).toBeInTheDocument();
  });

  it("links the order number to the order's deep-linked drawer route", () => {
    renderCard(makeCard(), true);
    expect(screen.getByRole("link", { name: "#1001" })).toHaveAttribute("href", "/orders/order_1");
  });

  it("shows a '+N' overflow chip beyond the visible tag limit", () => {
    renderCard(makeCard({ tags: ["a", "b", "c", "d", "e"] }), true);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows a fallback icon (not a broken image) when a product line has no image", () => {
    renderCard(
      makeCard({
        lines: [
          {
            id: "line_1",
            productTitle: "Sample Item",
            variantTitle: null,
            quantity: 1,
            imageUrl: null,
            sku: null,
          },
        ],
        lineCount: 1,
      }),
      true,
    );
    expect(screen.getByText(/no image available/i)).toBeInTheDocument();
  });

  it("shows unassigned honestly when there is no assignment", () => {
    renderCard(makeCard({ assignment: null }), true);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows the assigned staff member's name when assigned", () => {
    renderCard(
      makeCard({
        assignment: { role: "ARTWORK", staffUserId: "staff_1", staffUserName: "Priya Nair" },
      }),
      true,
    );
    expect(screen.getByText("Assigned: Priya Nair")).toBeInTheDocument();
  });

  it("shows an integration-issue indicator when the order has an unresolved failure", () => {
    renderCard(
      makeCard({
        hasIntegrationIssue: true,
        integrationIssues: [{ id: "f1", severity: "HIGH", summary: "Tag sync failed" }],
      }),
      true,
    );
    expect(screen.getByText("Integration issue")).toBeInTheDocument();
  });

  it("shows the drag handle and Move to menu when the staff member can manage the board", () => {
    renderCard(makeCard(), true);
    expect(screen.getByRole("button", { name: /drag #1001/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /move to/i })).toBeInTheDocument();
  });

  it("hides the drag handle and Move to menu for a read-only (view-only) staff member", () => {
    renderCard(makeCard(), false);
    expect(screen.queryByRole("button", { name: /drag #1001/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /move to/i })).not.toBeInTheDocument();
  });

  it.each(["proof_approved", "exported_for_print"] as const)(
    "shows a large, full-width, clickable proof preview in the %s column",
    (columnKey) => {
      renderCard(
        makeCard({
          columnKey,
          proofGroupSummary: {
            activeGroupCount: 1,
            readyCount: 0,
            requiringWorkCount: 0,
            noProofRequiredCount: 0,
            blockedCount: 0,
            waitingOnCustomerCount: 0,
            changesRequestedCount: 0,
            approvedCount: 1,
            readyForExportCount: 0,
            exportedCount: 0,
            latestThumbnail: { assetId: "asset_1", mimeType: "image/png" },
            latestApprovedThumbnail: { assetId: "asset_1", mimeType: "image/png" },
            assignedStaffNames: [],
          },
        }),
        true,
      );
      const images = screen.getAllByRole("presentation", { hidden: true });
      const largePreview = images.find((img) => img.className.includes("max-h-48"));
      expect(largePreview).toBeDefined();
      expect(largePreview).toHaveAttribute("src", "/proof-assets/asset_1");

      const link = screen.getByRole("link", { name: "View full-size proof" });
      expect(link).toHaveAttribute("href", "/proof-assets/asset_1");
      expect(link).toHaveAttribute("target", "_blank");
    },
  );

  it("shows no large preview in Proof Approved/Exported for Print when no version has actually been approved yet", () => {
    renderCard(
      makeCard({
        columnKey: "proof_approved",
        proofGroupSummary: {
          activeGroupCount: 1,
          readyCount: 0,
          requiringWorkCount: 0,
          noProofRequiredCount: 0,
          blockedCount: 0,
          waitingOnCustomerCount: 1,
          changesRequestedCount: 0,
          approvedCount: 0,
          readyForExportCount: 0,
          exportedCount: 0,
          // A newer, unapproved version's thumbnail is still the "latest"
          // one — it must never be shown as if it were the approved proof.
          latestThumbnail: { assetId: "asset_1", mimeType: "image/png" },
          latestApprovedThumbnail: null,
          assignedStaffNames: [],
        },
      }),
      true,
    );
    const images = screen.queryAllByRole("presentation", { hidden: true });
    expect(images.find((img) => img.className.includes("max-h-48"))).toBeUndefined();
    expect(screen.queryByRole("link", { name: "View full-size proof" })).not.toBeInTheDocument();
  });

  it("keeps the small icon-sized proof thumbnail in every other column", () => {
    renderCard(
      makeCard({
        columnKey: "new",
        proofGroupSummary: {
          activeGroupCount: 1,
          readyCount: 1,
          requiringWorkCount: 0,
          noProofRequiredCount: 0,
          blockedCount: 0,
          waitingOnCustomerCount: 0,
          changesRequestedCount: 0,
          approvedCount: 0,
          readyForExportCount: 0,
          exportedCount: 0,
          latestThumbnail: { assetId: "asset_1", mimeType: "image/png" },
          latestApprovedThumbnail: null,
          assignedStaffNames: [],
        },
      }),
      true,
    );
    const images = screen.getAllByRole("presentation", { hidden: true });
    const largePreview = images.find((img) => img.className.includes("max-h-48"));
    expect(largePreview).toBeUndefined();
    const smallThumbnail = images.find((img) => img.className.includes("h-6 w-6"));
    expect(smallThumbnail).toHaveAttribute("src", "/proof-assets/asset_1");
  });

  it("shows inline freight controls on a Pack-column card when permitted", () => {
    renderCard(
      makeCard({
        workflowStatus: OrderStatus.READY_TO_PACK,
        columnKey: "pack",
      }),
      true,
      true,
    );
    expect(screen.getByText("Weight (kg)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get rates" })).toBeInTheDocument();
  });

  it("hides inline freight controls on a Pack-column card without permission", () => {
    renderCard(
      makeCard({
        workflowStatus: OrderStatus.READY_TO_PACK,
        columnKey: "pack",
      }),
      true,
      false,
    );
    expect(screen.queryByText("Weight (kg)")).not.toBeInTheDocument();
  });

  it("tints the card light pink when it has a customer upload (OPTIS/Shopify file upload)", () => {
    renderCard(makeCard({ orderNumber: "#1002", hasCustomerUpload: true }), true);
    expect(screen.getByRole("link", { name: "#1002" }).closest("div.rounded-lg")).toHaveClass(
      "bg-accent-pink",
    );
  });

  it("shows a purple flag when the customer left a note at checkout", () => {
    renderCard(makeCard({ orderNumber: "#1010", hasCustomerNote: true }), true);
    expect(screen.getByTitle("Customer left a note at checkout")).toBeInTheDocument();
  });

  it("shows no flag when the customer left no checkout note", () => {
    renderCard(makeCard({ orderNumber: "#1011", hasCustomerNote: false }), true);
    expect(screen.queryByTitle("Customer left a note at checkout")).not.toBeInTheDocument();
  });

  it.each(["proof_approved", "exported_for_print"] as const)(
    "shows a red exclamation badge in the %s column when a proof isn't approved or the order isn't paid in full",
    (columnKey) => {
      renderCard(makeCard({ orderNumber: "#1012", columnKey, hasApprovalOrPaymentIssue: true }), true);
      expect(
        screen.getByTitle("Not every proof is approved yet, or the order isn't paid in full"),
      ).toBeInTheDocument();
    },
  );

  it("hides the exclamation badge in Proof Approved/Exported for Print once resolved", () => {
    renderCard(
      makeCard({ orderNumber: "#1013", columnKey: "proof_approved", hasApprovalOrPaymentIssue: false }),
      true,
    );
    expect(
      screen.queryByTitle("Not every proof is approved yet, or the order isn't paid in full"),
    ).not.toBeInTheDocument();
  });

  it("never shows the exclamation badge outside Proof Approved/Exported for Print, even if flagged", () => {
    renderCard(
      makeCard({ orderNumber: "#1014", columnKey: "new", hasApprovalOrPaymentIssue: true }),
      true,
    );
    expect(
      screen.queryByTitle("Not every proof is approved yet, or the order isn't paid in full"),
    ).not.toBeInTheDocument();
  });

  it("keeps the default card background when there is no customer upload", () => {
    renderCard(makeCard({ orderNumber: "#1003", hasCustomerUpload: false }), true);
    expect(screen.getByRole("link", { name: "#1003" }).closest("div.rounded-lg")).toHaveClass(
      "bg-surface",
    );
  });

  it("tints the card light pink when the manual override is set to PINK", () => {
    renderCard(makeCard({ orderNumber: "#1004", cardTintOverride: "PINK" }), true);
    expect(screen.getByRole("link", { name: "#1004" }).closest("div.rounded-lg")).toHaveClass(
      "bg-accent-pink",
    );
  });

  it("tints the card blue when the manual override is set to BLUE, even with no automatic embroidery signal", () => {
    renderCard(makeCard({ orderNumber: "#1008", cardTintOverride: "BLUE" }), true);
    expect(screen.getByRole("link", { name: "#1008" }).closest("div.rounded-lg")).toHaveClass(
      "bg-accent-blue",
    );
  });

  it("forces no tint when the manual override is set to NONE, even with automatic pink/blue signals present", () => {
    renderCard(
      makeCard({
        orderNumber: "#1009",
        cardTintOverride: "NONE",
        hasEmbroideryLineMarker: true,
        hasCustomerUpload: true,
        hasDecorationLineMarker: true,
      }),
      true,
    );
    const card = screen.getByRole("link", { name: "#1009" }).closest("div.rounded-lg");
    expect(card).toHaveClass("bg-surface");
    expect(card).not.toHaveClass("bg-accent-pink");
    expect(card).not.toHaveClass("bg-accent-blue");
  });

  it("also tints the card light pink when a line carries a decoration marker (Printing/Printed)", () => {
    renderCard(makeCard({ orderNumber: "#1005", hasDecorationLineMarker: true }), true);
    expect(screen.getByRole("link", { name: "#1005" }).closest("div.rounded-lg")).toHaveClass(
      "bg-accent-pink",
    );
  });

  it("tints the card light blue when a line carries an embroidery marker", () => {
    renderCard(makeCard({ orderNumber: "#1006", hasEmbroideryLineMarker: true }), true);
    expect(screen.getByRole("link", { name: "#1006" }).closest("div.rounded-lg")).toHaveClass(
      "bg-accent-blue",
    );
  });

  it("shows blue rather than pink when an order has both an embroidery marker and another pink-triggering signal", () => {
    renderCard(
      makeCard({
        orderNumber: "#1007",
        hasEmbroideryLineMarker: true,
        hasCustomerUpload: true,
        hasDecorationLineMarker: true,
      }),
      true,
    );
    const card = screen.getByRole("link", { name: "#1007" }).closest("div.rounded-lg");
    expect(card).toHaveClass("bg-accent-blue");
    expect(card).not.toHaveClass("bg-accent-pink");
  });

  it("shows the colour selector reflecting the card's current override", () => {
    renderCard(makeCard({ cardTintOverride: "PINK" }), true);
    expect(screen.getByRole("combobox", { name: /colour/i })).toHaveValue("PINK");
  });

  it("defaults the colour selector to Auto when there's no manual override", () => {
    renderCard(makeCard({ cardTintOverride: null }), true);
    expect(screen.getByRole("combobox", { name: /colour/i })).toHaveValue("AUTO");
  });

  it("disables the colour selector for a read-only (view-only) staff member", () => {
    renderCard(makeCard({ cardTintOverride: null }), false);
    expect(screen.getByRole("combobox", { name: /colour/i })).toBeDisabled();
  });

  it("shows the existing shipment's status instead of the create form when one already exists", () => {
    renderCard(
      makeCard({
        workflowStatus: OrderStatus.READY_TO_PACK,
        columnKey: "pack",
        freightShipment: {
          id: "fs_1",
          status: "CREATED",
          trackingNumber: "TRACK123",
          weightKg: 1.5,
          heightM: null,
          widthM: null,
          lengthM: null,
          carrierCode: "AusPost",
          carrierServiceCode: "3D85",
        },
      }),
      true,
      true,
    );
    expect(screen.getByText(/Freight label created.*TRACK123/)).toBeInTheDocument();
    expect(screen.queryByText("Weight (kg)")).not.toBeInTheDocument();
  });
});
