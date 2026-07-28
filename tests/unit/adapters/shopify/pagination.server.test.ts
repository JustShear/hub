import { describe, expect, it, vi } from "vitest";
import {
  paginateConnection,
  type GraphQLConnectionPage,
} from "~/adapters/shopify/pagination.server";

function page(
  nodes: number[],
  hasNextPage: boolean,
  endCursor: string | null,
): GraphQLConnectionPage<number> {
  return {
    edges: nodes.map((node) => ({ node })),
    pageInfo: { hasNextPage, endCursor },
  };
}

describe("paginateConnection", () => {
  it("returns all nodes from a single page", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([1, 2, 3], false, null));

    const nodes = await paginateConnection(fetchPage);

    expect(nodes).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it("follows cursors across multiple pages and stops when hasNextPage is false", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], true, "cursor-1"))
      .mockResolvedValueOnce(page([3, 4], true, "cursor-2"))
      .mockResolvedValueOnce(page([5], false, null));

    const nodes = await paginateConnection(fetchPage);

    expect(nodes).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "cursor-1");
    expect(fetchPage).toHaveBeenNthCalledWith(3, "cursor-2");
  });

  it("returns an empty array for an empty connection", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([], false, null));

    const nodes = await paginateConnection(fetchPage);

    expect(nodes).toEqual([]);
  });

  it("throws rather than looping forever if hasNextPage never becomes false", async () => {
    const fetchPage = vi.fn().mockImplementation((cursor: string | null) => {
      const next = cursor === null ? 1 : Number(cursor) + 1;
      return Promise.resolve(page([next], true, String(next)));
    });

    await expect(paginateConnection(fetchPage, { maxPages: 5 })).rejects.toThrow(/safety limit/);
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });
});
