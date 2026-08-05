import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ApproveForm } from "~/routes/proof.$token";
import type { CustomerProofPortalGroup } from "~/domain/proofs/proof-portal-query.server";

const GROUP: CustomerProofPortalGroup = {
  proofGroupId: "group_1",
  name: "Left chest logo",
  decorationMethod: "EMBROIDERY",
  placement: "Left chest",
  products: [],
  sentVersion: { id: "version_1", versionNumber: 1, assets: [] },
  previousVersions: [],
  responseStatus: "AWAITING_RESPONSE",
  response: null,
};

function renderApproveForm(actionResponse: unknown = { ok: true }) {
  const Stub = createRoutesStub([
    {
      path: "/proof/test-token/respond",
      Component: () => (
        <ApproveForm token="test-token" group={GROUP} onCancel={() => undefined} />
      ),
      action: () => actionResponse,
    },
  ]);
  return render(<Stub initialEntries={["/proof/test-token/respond"]} />);
}

// Regression test for a real customer-reported bug: "Confirm approval" was
// disabled whenever the acknowledgement checkbox was unticked, with no
// explanation — a customer who hadn't noticed the small checkbox would click
// the greyed-out button and see nothing happen, reasonably reporting the
// approve button as broken. Fixed by keeping the button always clickable and
// showing an explicit message instead of silently disabling it.
describe("ApproveForm", () => {
  it("never disables Confirm approval based on the acknowledgement checkbox", () => {
    renderApproveForm();
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
  });

  it("shows an explicit message instead of submitting when clicked without ticking the checkbox", async () => {
    renderApproveForm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Please confirm you've reviewed the proof before approving it.",
      );
    });
    // No success message — the click never actually submitted.
    expect(screen.queryByText(/proof is now approved/i)).not.toBeInTheDocument();
  });

  it("submits and shows the success message once the checkbox is ticked", async () => {
    renderApproveForm({ ok: true });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(screen.getByText(/proof is now approved/i)).toBeInTheDocument();
    });
  });

  it("clears the missing-acknowledgement message once the checkbox is ticked", () => {
    renderApproveForm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
