import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { PreviousAcceptedProofs } from "~/components/order-drawer/PreviousAcceptedProofs";
import type { PreviousAcceptedProofs as Data } from "~/domain/customers/customer-query.server";

function renderWith(data: Data) {
  const Stub = createRoutesStub([
    {
      path: "/orders/:orderId",
      Component: () => <PreviousAcceptedProofs orderId="order_1" />,
    },
    { path: "/orders/:orderId/previous-proofs", loader: () => data },
  ]);
  return render(<Stub initialEntries={["/orders/order_1"]} />);
}

const proof = {
  versionId: "v1",
  assetId: "asset_1",
  mimeType: "image/png",
  orderId: "order_0",
  orderNumber: "#39000",
  groupName: "Left chest",
  decorationMethod: "EMBROIDERY" as const,
  versionNumber: 2,
  at: "2026-09-01T00:00:00.000Z",
};

describe("PreviousAcceptedProofs", () => {
  it("shows earlier accepted proofs with order links and a link to the customer file", async () => {
    renderWith({ customerKey: "s-1", proofs: [proof], totalCount: 1 });

    expect(await screen.findByRole("img", { name: /left chest proof/i })).toHaveAttribute(
      "src",
      "/proof-assets/asset_1",
    );
    expect(screen.getByRole("link", { name: "#39000" })).toHaveAttribute("href", "/orders/order_0");
    expect(screen.getByRole("link", { name: "View customer file" })).toHaveAttribute(
      "href",
      "/customers/s-1",
    );
    expect(screen.queryByText(/and \d+ more/)).not.toBeInTheDocument();
  });

  it("says how many more there are when the list is capped", async () => {
    renderWith({ customerKey: "s-1", proofs: [proof], totalCount: 6 });
    expect(await screen.findByText(/and 5 more in the/)).toBeInTheDocument();
  });

  it("says so plainly when the customer has no earlier accepted proofs", async () => {
    renderWith({ customerKey: "s-1", proofs: [], totalCount: 0 });
    expect(await screen.findByText(/no accepted proofs yet/i)).toBeInTheDocument();
  });

  it("renders nothing for an order with no customer to look up", async () => {
    const { container } = renderWith({ customerKey: null, proofs: [], totalCount: 0 });
    await waitFor(() => {
      expect(container.querySelector("section")).toBeNull();
    });
    expect(screen.queryByText("Previously accepted proofs")).not.toBeInTheDocument();
  });
});
