import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalSearch } from "~/components/shell/GlobalSearch";

describe("GlobalSearch", () => {
  it("shows an honest 'not available yet' message instead of fake search results", async () => {
    render(<GlobalSearch />);

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(await screen.findByText("Search isn't available yet")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("opens on Ctrl+K", async () => {
    render(<GlobalSearch />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(await screen.findByText("Search isn't available yet")).toBeInTheDocument();
  });
});
