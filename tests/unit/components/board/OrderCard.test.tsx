import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { DndContext } from "@dnd-kit/core";
import { OrderProofSummary, OrderStatus, Priority } from "@prisma/client";
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
    isWaitingOnCustomer: false,
    hasCustomerResponseAlert: false,
    isApprovedNotExported: false,
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

function renderCard(card: BoardCard, canManage: boolean) {
  const Stub = createRoutesStub([
    {
      path: "/orders",
      Component: () => (
        <DndContext>
          <OrderCard
            card={card}
            canManage={canManage}
            canViewIntegrations={true}
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
});
