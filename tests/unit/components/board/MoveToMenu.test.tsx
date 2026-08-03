import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrderStatus } from "@prisma/client";
import { MoveToMenu } from "~/components/board/MoveToMenu";

// The guaranteed keyboard-accessible alternative to drag-and-drop — every
// destination the transition policy allows must be selectable, and
// everything it disallows must be visibly disabled rather than hidden (so a
// screen reader user knows the option exists but isn't available yet).
describe("MoveToMenu", () => {
  it("lists allowed destinations as enabled and disallowed ones as disabled", async () => {
    const onMove = vi.fn();
    render(
      <MoveToMenu currentWorkflowStatus={OrderStatus.NEW} currentColumnKey="new" onMove={onMove} />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /move to/i }));

    const proofBeingPrepared = await screen.findByRole("menuitem", {
      name: "Proof Being Prepared",
    });
    expect(proofBeingPrepared).not.toHaveAttribute("data-disabled");

    // Exported for Print is interactive too (a drop there syncs a real
    // Shopify tag) — no longer a disabled destination.
    const exportedForPrint = screen.getByRole("menuitem", { name: "Exported for Print" });
    expect(exportedForPrint).not.toHaveAttribute("data-disabled");

    const changesRequested = screen.getByRole("menuitem", { name: "Changes Requested" });
    expect(changesRequested).toHaveAttribute("data-disabled");
  });

  it("does not list the card's current column as a destination", async () => {
    render(
      <MoveToMenu
        currentWorkflowStatus={OrderStatus.NEW}
        currentColumnKey="new"
        onMove={vi.fn()}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: /move to/i }));
    await screen.findByRole("menuitem", { name: "Proof Being Prepared" });
    expect(screen.queryByRole("menuitem", { name: "New" })).not.toBeInTheDocument();
  });

  it("disables every destination for a cancelled order", async () => {
    render(
      <MoveToMenu
        currentWorkflowStatus={OrderStatus.CANCELLED}
        currentColumnKey={null}
        onMove={vi.fn()}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: /move to/i }));
    const item = await screen.findByRole("menuitem", { name: "New" });
    expect(item).toHaveAttribute("data-disabled");
  });

  it("calls onMove when an allowed destination is selected", async () => {
    const onMove = vi.fn();
    render(
      <MoveToMenu currentWorkflowStatus={OrderStatus.NEW} currentColumnKey="new" onMove={onMove} />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: /move to/i }));
    const item = await screen.findByRole("menuitem", { name: "Pack" });
    fireEvent.click(item);
    expect(onMove).toHaveBeenCalledWith("pack");
  });
});
