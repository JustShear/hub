import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { DndContext } from "@dnd-kit/core";
import {
  OrderProductionSummary,
  OrderProofSummary,
  OrderStatus,
  OrderWarehousePickSummary,
  Priority,
} from "@prisma/client";
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
    needsPrinting: false,
    isWaitingOnCustomer: false,
    hasCustomerResponseAlert: false,
    isApprovedNotExported: false,
    hasFailedProofDelivery: false,
    hasMissingProductionArtwork: false,
    hasReexportRequired: false,
    productionSummary: OrderProductionSummary.NOT_READY,
    hasOpenProductionIssue: false,
    productionAssignedStaffName: null,
    hasActiveFreightShipment: false,
    freightTrackingNumber: null,
    freightShipment: null,
    isCancelled: false,
    warehousePickSummary: OrderWarehousePickSummary.NOT_STARTED,
    hasOpenWarehouseIssue: false,
    hasShortPickItems: false,
    hasOpenExceptionCase: false,
    hasCustomerUpload: false,
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

  it("shows a large, full-width proof preview in the Proof Approved column", () => {
    renderCard(
      makeCard({
        columnKey: "proof_approved",
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
          assignedStaffNames: [],
        },
      }),
      true,
    );
    const images = screen.getAllByRole("presentation", { hidden: true });
    const largePreview = images.find((img) => img.className.includes("max-h-48"));
    expect(largePreview).toBeDefined();
    expect(largePreview).toHaveAttribute("src", "/proof-assets/asset_1");
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
        productionSummary: OrderProductionSummary.COMPLETE,
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
        productionSummary: OrderProductionSummary.COMPLETE,
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

  it("keeps the default card background when there is no customer upload", () => {
    renderCard(makeCard({ orderNumber: "#1003", hasCustomerUpload: false }), true);
    expect(screen.getByRole("link", { name: "#1003" }).closest("div.rounded-lg")).toHaveClass(
      "bg-surface",
    );
  });

  it("also tints the card light pink when manually marked as needing printing", () => {
    renderCard(makeCard({ orderNumber: "#1004", needsPrinting: true }), true);
    expect(screen.getByRole("link", { name: "#1004" }).closest("div.rounded-lg")).toHaveClass(
      "bg-accent-pink",
    );
  });

  it("shows a Needs printing checkbox reflecting the card's current value", () => {
    renderCard(makeCard({ needsPrinting: true }), true);
    expect(screen.getByRole("checkbox", { name: /needs printing/i })).toBeChecked();
  });

  it("disables the Needs printing checkbox for a read-only (view-only) staff member", () => {
    renderCard(makeCard({ needsPrinting: false }), false);
    expect(screen.getByRole("checkbox", { name: /needs printing/i })).toBeDisabled();
  });

  it("shows the existing shipment's status instead of the create form when one already exists", () => {
    renderCard(
      makeCard({
        workflowStatus: OrderStatus.READY_TO_PACK,
        columnKey: "pack",
        productionSummary: OrderProductionSummary.COMPLETE,
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
