export interface GraphQLConnectionPage<TNode> {
  edges: { node: TNode }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

// Generic Shopify GraphQL connection paginator. Never assume a connection
// fits in one page — this loops until hasNextPage is false, with a hard cap
// so a misbehaving API (or a bug in a caller's cursor handling) can't spin
// forever.
export async function paginateConnection<TNode>(
  fetchPage: (cursor: string | null) => Promise<GraphQLConnectionPage<TNode>>,
  options: { maxPages?: number } = {},
): Promise<TNode[]> {
  const maxPages = options.maxPages ?? 50;
  const nodes: TNode[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    nodes.push(...result.edges.map((edge) => edge.node));

    if (!result.pageInfo.hasNextPage) {
      return nodes;
    }

    cursor = result.pageInfo.endCursor;
  }

  throw new Error(
    `paginateConnection exceeded the ${maxPages}-page safety limit — the connection either has ` +
      "an unexpectedly large number of records or pageInfo.hasNextPage never became false.",
  );
}
