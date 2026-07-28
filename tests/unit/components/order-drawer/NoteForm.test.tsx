import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { NoteForm } from "~/components/order-drawer/NoteForm";

function renderForm(actionResponse: unknown = { ok: true }) {
  const Stub = createRoutesStub([
    {
      path: "/orders/order_1",
      Component: () => <NoteForm />,
      action: () => actionResponse,
    },
  ]);
  return render(<Stub initialEntries={["/orders/order_1"]} />);
}

describe("NoteForm", () => {
  it("disables Add note until the textarea has non-whitespace content", () => {
    renderForm();
    const addButton = screen.getByRole("button", { name: "Add note" });
    expect(addButton).toBeDisabled();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(addButton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "Real content." } });
    expect(addButton).toBeEnabled();
  });

  it("clears the textarea after a successful submission", async () => {
    renderForm({ ok: true });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Called the customer." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  it("shows a server-side error and keeps the text when the action rejects the note", async () => {
    renderForm({ ok: false, error: "A note cannot be empty." });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Some content." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("A note cannot be empty.");
    });
    expect(textarea).toHaveValue("Some content.");
  });
});
