import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { OrderProofSummary, OrderStatus, Priority } from "@prisma/client";
import { OverviewTab } from "~/components/order-drawer/OverviewTab";
import type { OrderDetail } from "~/domain/orders/order-detail-query.server";

function makeOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: "order_1",
    shopId: "shop_1",
    shopifyOrderGid: "gid://shopify/Order/1",
    shopifyLegacyOrderId: null,
    orderNumber: "#1001",
    shopifyCreatedAt: "2026-01-01T00:00:00.000Z",
    shopifyUpdatedAt: null,
    customerShopifyGid: null,
    customerName: "Jordan Smith",
    customerEmail: "jordan@example.com",
    customerPhone: null,
    noteFromCustomer: null,
    tags: [],
    financialStatus: null,
    fulfillmentStatus: null,
    shippingMethod: null,
    currencyCode: null,
    subtotalPrice: null,
    totalPrice: null,
    totalDiscounts: null,
    totalTax: null,
    discountCodes: null,
    shippingAddress: null,
    billingAddress: null,
    fulfillments: null,
    cancelledAt: null,
    cancelReason: null,
    isPreorder: false,
    lastSyncedAt: null,
    workflowStatus: OrderStatus.NEW,
    workflowStatusChangedAt: "2026-01-01T00:00:00.000Z",
    proofSummary: OrderProofSummary.PROOFS_NOT_STARTED,
    priority: Priority.NORMAL,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lines: [],
    dueDates: [],
    assignment: null,
    notes: [],
    notesTotalCount: 0,
    notesHasMore: false,
    activity: [],
    activityHasMore: false,
    integrationIssues: [],
    proofGroups: [],
    proofRequests: [],
    freightShipments: [],
    warehousePickJob: null,
    exceptionCases: [],
    daysInState: 4,
    orderAgeDays: 4,
    isWaitingOnCustomer: false,
    hasCustomerResponseAlert: false,
    ...overrides,
  };
}

function renderOverview(order: OrderDetail) {
  const Stub = createRoutesStub([
    {
      path: "/orders/:orderId",
      Component: () => (
        <OverviewTab
          order={order}
          assignableStaff={[]}
          canEditAssignment={true}
          canEditPriority={true}
          canEditDueDates={true}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/orders/order_1"]} />);
}

describe("OverviewTab", () => {
  it("keeps the internal workflow details collapsed by default", () => {
    renderOverview(makeOrder());
    expect(
      screen.getByRole("button", { name: /internal workflow/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
    expect(screen.queryByText("Time in this status")).not.toBeInTheDocument();
  });

  it("reveals the workflow details after clicking the section header", () => {
    renderOverview(makeOrder());
    fireEvent.click(screen.getByRole("button", { name: /internal workflow/i }));

    expect(screen.getByText("Workflow status")).toBeInTheDocument();
    expect(screen.getByText("Time in this status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /internal workflow/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("hides the workflow details again after a second click", () => {
    renderOverview(makeOrder());
    const toggle = screen.getByRole("button", { name: /internal workflow/i });
    fireEvent.click(toggle);
    expect(screen.getByText("Workflow status")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
  });

  it("still shows the read-only Shopify order summary section unconditionally", () => {
    renderOverview(makeOrder());
    expect(screen.getByText("Order summary (from Shopify — read only)")).toBeInTheDocument();
    expect(screen.getByText("Proof requirement")).toBeInTheDocument();
  });
});
