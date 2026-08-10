import { describe, expect, it } from "vitest";
import { OrderProofSummary, OrderStatus, OrderWarehousePickSummary, Priority } from "@prisma/client";
import { compareCards, type BoardCard } from "~/domain/orders/board-query.server";

function makeCard(overrides: Partial<BoardCard>): BoardCard {
  return {
    id: overrides.id ?? "id",
    orderNumber: "#1000",
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    shopifyCreatedAt: "2026-01-01T00:00:00.000Z",
    workflowStatus: OrderStatus.NEW,
    workflowStatusChangedAt: "2026-01-01T00:00:00.000Z",
    daysInState: 0,
    proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
    priority: Priority.NORMAL,
    tags: [],
    isPreorder: false,
    needsPrinting: false,
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

describe("compareCards", () => {
  it("sorts by priority, most urgent first", () => {
    const low = makeCard({ id: "low", priority: Priority.LOW });
    const urgent = makeCard({ id: "urgent", priority: Priority.URGENT });
    const cards = [low, urgent].sort((a, b) => compareCards(a, b, "priority"));
    expect(cards.map((c) => c.id)).toEqual(["urgent", "low"]);
  });

  it("sorts by nearest due date ascending, no-due-date last", () => {
    const soon = makeCard({
      id: "soon",
      nearestDueDate: { type: "DISPATCH", dueDate: "2026-01-02T00:00:00.000Z", state: "due_soon" },
    });
    const later = makeCard({
      id: "later",
      nearestDueDate: { type: "DISPATCH", dueDate: "2026-02-01T00:00:00.000Z", state: "future" },
    });
    const none = makeCard({ id: "none", nearestDueDate: null });
    const cards = [none, later, soon].sort((a, b) => compareCards(a, b, "due_date"));
    expect(cards.map((c) => c.id)).toEqual(["soon", "later", "none"]);
  });

  it("sorts by oldest order first", () => {
    const older = makeCard({ id: "older", shopifyCreatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeCard({ id: "newer", shopifyCreatedAt: "2026-02-01T00:00:00.000Z" });
    const cards = [newer, older].sort((a, b) => compareCards(a, b, "oldest_order"));
    expect(cards.map((c) => c.id)).toEqual(["older", "newer"]);
  });

  it("sorts by newest order first", () => {
    const older = makeCard({ id: "older", shopifyCreatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeCard({ id: "newer", shopifyCreatedAt: "2026-02-01T00:00:00.000Z" });
    const cards = [older, newer].sort((a, b) => compareCards(a, b, "newest_order"));
    expect(cards.map((c) => c.id)).toEqual(["newer", "older"]);
  });

  it("sorts by longest in current state first", () => {
    const longAgo = makeCard({
      id: "longAgo",
      workflowStatusChangedAt: "2026-01-01T00:00:00.000Z",
    });
    const recent = makeCard({ id: "recent", workflowStatusChangedAt: "2026-02-01T00:00:00.000Z" });
    const cards = [recent, longAgo].sort((a, b) => compareCards(a, b, "longest_in_state"));
    expect(cards.map((c) => c.id)).toEqual(["longAgo", "recent"]);
  });

  it("sorts by order number numerically, not lexicographically", () => {
    const small = makeCard({ id: "small", orderNumber: "#999" });
    const big = makeCard({ id: "big", orderNumber: "#1001" });
    const cards = [big, small].sort((a, b) => compareCards(a, b, "order_number"));
    expect(cards.map((c) => c.id)).toEqual(["small", "big"]);
  });

  it("is stable for equal cards (falls back to id)", () => {
    const a = makeCard({ id: "a" });
    const b = makeCard({ id: "b" });
    expect(compareCards(a, b, "priority")).toBeLessThan(0);
  });

  describe("urgency_default", () => {
    it("ranks urgent above high above overdue above nearest-due above oldest-in-state", () => {
      const urgent = makeCard({ id: "urgent", priority: Priority.URGENT });
      const high = makeCard({ id: "high", priority: Priority.HIGH });
      const overdue = makeCard({
        id: "overdue",
        priority: Priority.NORMAL,
        nearestDueDate: { type: "DISPATCH", dueDate: "2025-01-01T00:00:00.000Z", state: "overdue" },
      });
      const dueSoon = makeCard({
        id: "dueSoon",
        priority: Priority.NORMAL,
        nearestDueDate: {
          type: "DISPATCH",
          dueDate: "2026-06-01T00:00:00.000Z",
          state: "due_soon",
        },
      });
      const oldest = makeCard({
        id: "oldest",
        priority: Priority.NORMAL,
        workflowStatusChangedAt: "2025-01-01T00:00:00.000Z",
      });

      const cards = [oldest, dueSoon, overdue, high, urgent].sort((a, b) =>
        compareCards(a, b, "urgency_default"),
      );
      expect(cards.map((c) => c.id)).toEqual(["urgent", "high", "overdue", "dueSoon", "oldest"]);
    });
  });
});
