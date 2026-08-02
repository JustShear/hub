import { describe, expect, it } from "vitest";
import {
  EMPTY_PRODUCTION_QUEUE_FILTERS,
  isProductionQueueFiltersEmpty,
  parseProductionQueueSearchParams,
  productionQueueFiltersToSearchParams,
} from "~/domain/production/queue-filters";

describe("parseProductionQueueSearchParams", () => {
  it("defaults to empty filters and the priority sort when no params are present", () => {
    const { filters, sort } = parseProductionQueueSearchParams(new URLSearchParams());
    expect(filters).toEqual(EMPTY_PRODUCTION_QUEUE_FILTERS);
    expect(sort).toBe("priority");
  });

  it("parses a named view and rejects an unrecognised one", () => {
    expect(parseProductionQueueSearchParams(new URLSearchParams("view=blocked")).filters.view).toBe(
      "blocked",
    );
    expect(
      parseProductionQueueSearchParams(new URLSearchParams("view=not_a_real_view")).filters.view,
    ).toBeNull();
  });

  it("parses comma-separated list filters", () => {
    const { filters } = parseProductionQueueSearchParams(
      new URLSearchParams("decorationMethod=EMBROIDERY,SCREEN_PRINT&status=BLOCKED,PAUSED"),
    );
    expect(filters.decorationMethods).toEqual(["EMBROIDERY", "SCREEN_PRINT"]);
    expect(filters.statuses).toEqual(["BLOCKED", "PAUSED"]);
  });

  it("parses boolean flags strictly (only the literal string 'true')", () => {
    expect(
      parseProductionQueueSearchParams(new URLSearchParams("overdue=true")).filters.overdueOnly,
    ).toBe(true);
    expect(
      parseProductionQueueSearchParams(new URLSearchParams("overdue=yes")).filters.overdueOnly,
    ).toBe(false);
  });
});

describe("productionQueueFiltersToSearchParams / parseProductionQueueSearchParams round trip", () => {
  it("round-trips a fully populated filter set", () => {
    const filters = {
      ...EMPTY_PRODUCTION_QUEUE_FILTERS,
      view: "overdue" as const,
      assignedStaffId: "staff_1",
      decorationMethods: ["EMBROIDERY", "UNPRINTED"],
      statuses: ["BLOCKED"],
      priorities: ["URGENT", "HIGH"],
      overdueOnly: true,
      orderNumber: "#1001",
      hasIssue: true,
    };
    const params = productionQueueFiltersToSearchParams(filters, "due_date", 2);
    const parsed = parseProductionQueueSearchParams(params);
    expect(parsed.sort).toBe("due_date");
    expect(parsed.filters).toEqual(filters);
    expect(params.get("page")).toBe("2");
  });

  it("omits the page param entirely for page 0", () => {
    const params = productionQueueFiltersToSearchParams(
      EMPTY_PRODUCTION_QUEUE_FILTERS,
      "priority",
      0,
    );
    expect(params.has("page")).toBe(false);
  });
});

describe("isProductionQueueFiltersEmpty", () => {
  it("is true for the empty filters constant", () => {
    expect(isProductionQueueFiltersEmpty(EMPTY_PRODUCTION_QUEUE_FILTERS)).toBe(true);
  });

  it("is false once any single field is set", () => {
    expect(
      isProductionQueueFiltersEmpty({ ...EMPTY_PRODUCTION_QUEUE_FILTERS, hasIssue: true }),
    ).toBe(false);
  });
});
