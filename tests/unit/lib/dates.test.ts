import { describe, expect, it } from "vitest";
import { classifyDueDate, daysSince, formatAuDate } from "~/lib/dates";

const NOW = new Date("2026-07-27T10:00:00Z");
const DAY_MS = 86_400_000;

describe("classifyDueDate", () => {
  it("returns 'none' when there is no due date", () => {
    expect(classifyDueDate(null, NOW)).toBe("none");
  });

  it("returns 'overdue' for a date in the past", () => {
    expect(classifyDueDate(new Date(NOW.getTime() - DAY_MS), NOW)).toBe("overdue");
  });

  it("returns 'due_today' for today's date", () => {
    expect(classifyDueDate(new Date(NOW.getTime()), NOW)).toBe("due_today");
  });

  it("returns 'due_soon' within the soon window", () => {
    expect(classifyDueDate(new Date(NOW.getTime() + 2 * DAY_MS), NOW)).toBe("due_soon");
  });

  it("returns 'future' beyond the soon window", () => {
    expect(classifyDueDate(new Date(NOW.getTime() + 10 * DAY_MS), NOW)).toBe("future");
  });
});

describe("formatAuDate", () => {
  it("formats as DD/MM/YYYY", () => {
    expect(formatAuDate(new Date("2026-01-05T00:00:00Z"))).toBe("05/01/2026");
  });
});

describe("daysSince", () => {
  it("computes whole days between two dates", () => {
    expect(daysSince(new Date(NOW.getTime() - 3 * DAY_MS), NOW)).toBe(3);
  });

  it("never returns a negative number", () => {
    expect(daysSince(new Date(NOW.getTime() + 3 * DAY_MS), NOW)).toBe(0);
  });
});
