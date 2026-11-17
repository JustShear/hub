import { describe, expect, it } from "vitest";
import {
  boardFiltersToSearchParams,
  isBoardFiltersEmpty,
  parseBoardSearchParams,
  usesCursorPagination,
} from "~/domain/orders/board-filters";

describe("parseBoardSearchParams", () => {
  it("defaults to an empty board view with no filters and the urgency-default sort", () => {
    const { filters, sort, view } = parseBoardSearchParams(new URLSearchParams());
    expect(view).toBe("board");
    expect(sort.field).toBe("urgency_default");
    expect(isBoardFiltersEmpty(filters)).toBe(true);
  });

  it("parses comma-separated list params", () => {
    const { filters } = parseBoardSearchParams(
      new URLSearchParams("priority=HIGH,URGENT&tags=embroidery,rush"),
    );
    expect(filters.priority).toEqual(["HIGH", "URGENT"]);
    expect(filters.tags).toEqual(["embroidery", "rush"]);
  });

  it("ignores an invalid view or sort field rather than throwing", () => {
    const { view, sort } = parseBoardSearchParams(
      new URLSearchParams("view=not_real&sort=not_real"),
    );
    expect(view).toBe("board");
    expect(sort.field).toBe("urgency_default");
  });

  it("parses boolean flags only when set to '1'", () => {
    const { filters } = parseBoardSearchParams(new URLSearchParams("preorder=1&waiting=0"));
    expect(filters.preorder).toBe(true);
    expect(filters.waitingOnCustomer).toBeUndefined();
  });

  it("round-trips through boardFiltersToSearchParams", () => {
    const original = new URLSearchParams("priority=URGENT&due=overdue&preorder=1&q=cap");
    const { filters, sort, view } = parseBoardSearchParams(original);
    const rebuilt = boardFiltersToSearchParams(filters, sort, view);
    const { filters: reparsed } = parseBoardSearchParams(rebuilt);
    expect(reparsed).toEqual(filters);
  });

  it("defaults visibleColumns to undefined (every column shown) when no columns param is set", () => {
    const { visibleColumns } = parseBoardSearchParams(new URLSearchParams());
    expect(visibleColumns).toBeUndefined();
  });

  it("parses a comma-separated columns param into visibleColumns", () => {
    const { visibleColumns } = parseBoardSearchParams(new URLSearchParams("columns=new,pack"));
    expect(visibleColumns).toEqual(["new", "pack"]);
  });

  it("round-trips visibleColumns through boardFiltersToSearchParams", () => {
    const { filters, sort, view } = parseBoardSearchParams(new URLSearchParams());
    const rebuilt = boardFiltersToSearchParams(filters, sort, view, ["new", "pack"]);
    expect(rebuilt.get("columns")).toBe("new,pack");
    const { visibleColumns: reparsed } = parseBoardSearchParams(rebuilt);
    expect(reparsed).toEqual(["new", "pack"]);
  });

  it("omits the columns param entirely when visibleColumns is undefined", () => {
    const { filters, sort, view } = parseBoardSearchParams(new URLSearchParams());
    const rebuilt = boardFiltersToSearchParams(filters, sort, view, undefined);
    expect(rebuilt.has("columns")).toBe(false);
  });
});

describe("isBoardFiltersEmpty", () => {
  it("is true only when nothing is set", () => {
    const { filters: empty } = parseBoardSearchParams(new URLSearchParams());
    expect(isBoardFiltersEmpty(empty)).toBe(true);

    const { filters: withSearch } = parseBoardSearchParams(new URLSearchParams("q=test"));
    expect(isBoardFiltersEmpty(withSearch)).toBe(false);
  });
});

describe("usesCursorPagination", () => {
  it("is false only for due_date and urgency_default", () => {
    expect(usesCursorPagination("due_date")).toBe(false);
    expect(usesCursorPagination("urgency_default")).toBe(false);
    expect(usesCursorPagination("priority")).toBe(true);
    expect(usesCursorPagination("oldest_order")).toBe(true);
    expect(usesCursorPagination("newest_order")).toBe(true);
    expect(usesCursorPagination("longest_in_state")).toBe(true);
    expect(usesCursorPagination("order_number")).toBe(true);
  });
});

describe("tile colour filter", () => {
  it("parses the tint param, ignoring unknown colours instead of throwing", () => {
    const { filters } = parseBoardSearchParams(new URLSearchParams("tint=pink,purple,green"));
    expect(filters.tints).toEqual(["pink", "green"]);
    expect(parseBoardSearchParams(new URLSearchParams("tint=nope")).filters.tints).toEqual([]);
    expect(parseBoardSearchParams(new URLSearchParams()).filters.tints).toEqual([]);
  });

  it("round-trips through the URL, and only writes the param when a colour is chosen", () => {
    const { filters, sort, view } = parseBoardSearchParams(new URLSearchParams("tint=green"));
    const params = boardFiltersToSearchParams(filters, sort, view);
    expect(params.get("tint")).toBe("green");

    const { filters: none, sort: s2, view: v2 } = parseBoardSearchParams(new URLSearchParams());
    expect(boardFiltersToSearchParams(none, s2, v2).has("tint")).toBe(false);
  });

  it("counts a chosen colour as an active filter", () => {
    const { filters } = parseBoardSearchParams(new URLSearchParams("tint=pink"));
    expect(isBoardFiltersEmpty(filters)).toBe(false);
  });
});
