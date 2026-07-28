import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import {
  AssignmentEditor,
  type AssignmentEditorProps,
} from "~/components/order-drawer/AssignmentEditor";

const assignableStaff = [
  { id: "staff_1", name: "Priya Nair" },
  { id: "staff_2", name: "Jordan Lee" },
];

function renderEditor(
  props: Partial<AssignmentEditorProps> = {},
  actionResponse: unknown = { ok: true },
) {
  const Stub = createRoutesStub([
    {
      path: "/orders/order_1",
      Component: () => (
        <AssignmentEditor
          currentStaffUserId={null}
          currentStaffUserName={null}
          assignableStaff={assignableStaff}
          canEdit={true}
          {...props}
        />
      ),
      action: () => actionResponse,
    },
  ]);
  return render(<Stub initialEntries={["/orders/order_1"]} />);
}

describe("AssignmentEditor", () => {
  it("shows a read-only name (or 'Unassigned') when the staff member can't edit", () => {
    renderEditor({ canEdit: false, currentStaffUserName: "Priya Nair" });
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows 'Unassigned' honestly when there is no assignment and no edit permission", () => {
    renderEditor({ canEdit: false, currentStaffUserName: null });
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows a dropdown with every assignable staff member when the user can edit", () => {
    renderEditor({ canEdit: true });
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Priya Nair" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Jordan Lee" })).toBeInTheDocument();
  });

  it("shows a server-side error message when the action rejects the change", async () => {
    renderEditor(
      { canEdit: true },
      { ok: false, error: "That staff member is not active or doesn't exist." },
    );
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "staff_1" } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That staff member is not active or doesn't exist.",
      );
    });
  });
});
