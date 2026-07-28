import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { PriorityEditor, type PriorityEditorProps } from "~/components/order-drawer/PriorityEditor";

function renderEditor(
  props: Partial<PriorityEditorProps> = {},
  actionResponse: unknown = { ok: true },
) {
  const Stub = createRoutesStub([
    {
      path: "/orders/order_1",
      Component: () => <PriorityEditor currentPriority="NORMAL" canEdit={true} {...props} />,
      action: () => actionResponse,
    },
  ]);
  return render(<Stub initialEntries={["/orders/order_1"]} />);
}

describe("PriorityEditor", () => {
  it("shows a read-only badge when the staff member can't edit", () => {
    renderEditor({ canEdit: false, currentPriority: "HIGH" });
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("hides the Save button until the selection actually changes", () => {
    renderEditor({ canEdit: true, currentPriority: "NORMAL" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "LOW" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("requires a reason before Save is enabled when switching to HIGH", () => {
    renderEditor({ canEdit: true, currentPriority: "NORMAL" });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "HIGH" } });
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Client escalated." } });
    expect(saveButton).toBeEnabled();
  });

  it("does not require a reason when switching to LOW", () => {
    renderEditor({ canEdit: true, currentPriority: "NORMAL" });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "LOW" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument();
  });

  it("shows a server-side error message when the action rejects the change", async () => {
    renderEditor(
      { canEdit: true, currentPriority: "NORMAL" },
      {
        ok: false,
        error: "Priority changed since you last saw it. Refresh to see the current value.",
      },
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "LOW" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/changed since you last saw it/i);
    });
  });
});
