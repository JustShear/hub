import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { CustomerProofFilePage } from "~/components/customers/CustomerProofFilePage";
import { CustomerListPage } from "~/components/customers/CustomerListPage";
import type {
  CustomerChangesRequestedCard,
  CustomerProofCard,
  CustomerProofFile,
} from "~/domain/customers/customer-query.server";

function card(overrides: Partial<CustomerProofCard> = {}): CustomerProofCard {
  return {
    versionId: "v1",
    assetId: "asset_1",
    mimeType: "image/png",
    orderId: "order_1",
    orderNumber: "#40001",
    groupName: "Left chest",
    decorationMethod: "EMBROIDERY",
    versionNumber: 2,
    at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function changes(
  overrides: Partial<CustomerChangesRequestedCard> = {},
): CustomerChangesRequestedCard {
  return {
    ...card({ versionId: "v0", assetId: "asset_0", orderId: "order_2", orderNumber: "#40002" }),
    customerNote: "Make it bigger",
    categories: ["SIZE", "PRODUCT_ASSIGNMENT"],
    laterApproved: false,
    ...overrides,
  };
}

function renderFile(file: CustomerProofFile) {
  const Stub = createRoutesStub([
    { path: "/customers/:key", Component: () => <CustomerProofFilePage file={file} /> },
  ]);
  return render(<Stub initialEntries={["/customers/s-1"]} />);
}

const customer = { name: "Pat Customer", email: "pat@example.com", phone: null, orderCount: 3 };

describe("CustomerProofFilePage", () => {
  it("shows each accepted proof image with a clickable order number beneath it", () => {
    renderFile({ customer, accepted: [card()], changesRequested: [] });

    const section = screen.getByRole("region", { name: /proofs accepted/i });
    const image = within(section).getByRole("img", { name: /left chest proof, version 2/i });
    expect(image).toHaveAttribute("src", "/proof-assets/asset_1");

    const link = within(section).getByRole("link", { name: "#40001" });
    expect(link).toHaveAttribute("href", "/orders/order_1");
  });

  it("lists change requests with the customer's categories, note and order link", () => {
    renderFile({ customer, accepted: [], changesRequested: [changes()] });

    const section = screen.getByRole("region", { name: /rejected or changes requested/i });
    expect(within(section).getByText("Size, Product assignment")).toBeInTheDocument();
    expect(within(section).getByText("Make it bigger")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "#40002" })).toHaveAttribute(
      "href",
      "/orders/order_2",
    );
    expect(within(section).queryByText(/later version was approved/i)).not.toBeInTheDocument();
  });

  it("flags a change request that a later version has since resolved", () => {
    renderFile({ customer, accepted: [], changesRequested: [changes({ laterApproved: true })] });
    expect(screen.getByText(/a later version was approved/i)).toBeInTheDocument();
  });

  it("falls back to a placeholder for a version with no previewable image", () => {
    renderFile({
      customer,
      accepted: [card({ assetId: null }), card({ versionId: "v9", mimeType: "application/pdf" })],
      changesRequested: [],
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByText("No preview available")).toHaveLength(2);
    // The order link is still there so staff can get to the proof.
    expect(screen.getAllByRole("link", { name: "#40001" })).toHaveLength(2);
  });

  it("shows empty states when there is nothing yet", () => {
    renderFile({ customer, accepted: [], changesRequested: [] });
    expect(screen.getByText("No accepted proofs yet")).toBeInTheDocument();
    expect(screen.getByText("No change requests")).toBeInTheDocument();
  });

  it("shows the customer's name, contact details and order count", () => {
    renderFile({ customer, accepted: [], changesRequested: [] });
    expect(screen.getByRole("heading", { level: 1, name: "Pat Customer" })).toBeInTheDocument();
    expect(screen.getByText(/pat@example\.com · 3 orders/)).toBeInTheDocument();
  });
});

describe("CustomerListPage", () => {
  function renderList(props: Parameters<typeof CustomerListPage>[0]) {
    const Stub = createRoutesStub([
      { path: "/customers", Component: () => <CustomerListPage {...props} /> },
    ]);
    return render(<Stub initialEntries={["/customers"]} />);
  }

  it("links each customer to their file", () => {
    renderList({
      search: "",
      customers: [
        {
          key: "s-1",
          name: "Pat Customer",
          email: "pat@example.com",
          orderCount: 1,
          lastOrderAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    expect(screen.getByRole("link", { name: /pat customer/i })).toHaveAttribute(
      "href",
      "/customers/s-1",
    );
    expect(screen.getByText(/1 order ·/)).toBeInTheDocument();
  });

  it("explains an empty search differently from an empty shop", () => {
    renderList({ search: "zzz", customers: [] });
    expect(screen.getByText("No customers match that search")).toBeInTheDocument();
  });
});
