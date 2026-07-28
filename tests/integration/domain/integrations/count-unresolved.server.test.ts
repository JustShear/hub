import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { IntegrationFailureStatus, IntegrationType, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { countUnresolvedIntegrationFailures } from "~/domain/integrations/count-unresolved.server";

describe("countUnresolvedIntegrationFailures (integration)", () => {
  const createdFailureIds: string[] = [];

  // A dedicated shop, not the shared dev-seed one — other integration test
  // files create/delete IntegrationFailure rows against the shared shop
  // concurrently, which would make an exact-count assertion here flaky.
  const createdShopIds: string[] = [];

  afterAll(async () => {
    if (createdFailureIds.length > 0) {
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
    }
    if (createdShopIds.length > 0) {
      await db.shop.deleteMany({ where: { id: { in: createdShopIds } } });
    }
  });

  async function createIsolatedShop() {
    const shop = await db.shop.create({
      data: {
        shopifyDomain: `test-${randomUUID()}.myshopify.com`,
        shopifyShopGid: `gid://shopify/Shop/${randomUUID()}`,
        adminApiToken: "test-token",
        scopes: "read_orders",
      },
    });
    createdShopIds.push(shop.id);
    return shop;
  }

  async function createFailure(shopId: string, status: IntegrationFailureStatus) {
    const failure = await db.integrationFailure.create({
      data: {
        shopId,
        integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
        action: `test-action-${randomUUID()}`,
        summary: "test failure",
        severity: Severity.LOW,
        status,
      },
    });
    createdFailureIds.push(failure.id);
    return failure;
  }

  it("counts only open statuses, scoped to the given shop", async () => {
    const shop = await createIsolatedShop();

    await createFailure(shop.id, IntegrationFailureStatus.NEW);
    await createFailure(shop.id, IntegrationFailureStatus.RETRYING);
    await createFailure(shop.id, IntegrationFailureStatus.NEEDS_ATTENTION);
    await createFailure(shop.id, IntegrationFailureStatus.ASSIGNED);
    await createFailure(shop.id, IntegrationFailureStatus.RESOLVED);
    await createFailure(shop.id, IntegrationFailureStatus.IGNORED);

    const count = await countUnresolvedIntegrationFailures(shop.id);

    expect(count).toBe(4);
  });

  it("does not count another shop's failures", async () => {
    const shopA = await createIsolatedShop();
    const shopB = await createIsolatedShop();

    await createFailure(shopA.id, IntegrationFailureStatus.NEW);

    expect(await countUnresolvedIntegrationFailures(shopB.id)).toBe(0);
    expect(await countUnresolvedIntegrationFailures(shopA.id)).toBe(1);
  });

  it("returns zero for a shop with no failures", async () => {
    const count = await countUnresolvedIntegrationFailures("nonexistent-shop-id");
    expect(count).toBe(0);
  });
});
