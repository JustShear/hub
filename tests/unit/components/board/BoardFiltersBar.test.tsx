import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import { BoardFiltersBar } from "~/components/board/BoardFiltersBar";
import { EMPTY_BOARD_FILTERS, type BoardFilters } from "~/domain/orders/board-filters";

function CurrentSearch() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderBar(filters: BoardFilters = EMPTY_BOARD_FILTERS, initial = "/orders") {
  const Stub = createRoutesStub([
    {
      path: "/orders",
      Component: () => (
        <>
          <BoardFiltersBar
            filters={filters}
            sort={{ field: "urgency_default" }}
            view="board"
            visibleColumns={undefined}
            filterOptions={{ staff: [], tags: [] }}
          />
          <CurrentSearch />
        </>
      ),
    },
  ]);
  return render(<Stub initialEntries={[initial]} />);
}

describe("BoardFiltersBar tile colour buttons", () => {
  it("offers a pink and a green button, neither pressed by default", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Pink (printing)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Green (tail names)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("puts the colour in the URL when a button is clicked, so the board reloads filtered", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Pink (printing)" }));
    expect(screen.getByTestId("search").textContent).toBe("?tint=pink");
  });

  it("shows a chosen colour as pressed and as a removable chip, and removing it clears the URL param", () => {
    renderBar({ ...EMPTY_BOARD_FILTERS, tints: ["green"] }, "/orders?tint=green");
    expect(screen.getByRole("button", { name: "Green (tail names)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Colour: Green (tail names)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Green (tail names)" }));
    expect(screen.getByTestId("search").textContent).toBe("");
  });
});
