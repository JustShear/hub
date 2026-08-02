import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { markProofVersionReady } from "~/domain/proofs/mark-proof-version-ready.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { recordCustomerProofResponse } from "~/domain/proofs/record-customer-proof-response.server";

/** Shared fixture helpers for Milestone 10 (production artwork / export) integration tests. */
export function createProductionTestTracker() {
  const orderIds: string[] = [];
  const staffUserIds: string[] = [];

  async function cleanup() {
    if (orderIds.length > 0) {
      const groupIds = (
        await db.proofGroup.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })
      ).map((g) => g.id);

      // Milestone 11 rows — createExportBatch automatically creates
      // ProductionJob/ProductionTask rows as a follow-up, so these must be
      // cleared before ExportBatchItem/ProductionArtwork (which they
      // reference) and before the ShopifyOrder itself.
      const jobIds = (
        await db.productionJob.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((j) => j.id);
      if (jobIds.length > 0) {
        const taskIds = (
          await db.productionTask.findMany({
            where: { productionJobId: { in: jobIds } },
            select: { id: true },
          })
        ).map((t) => t.id);
        if (taskIds.length > 0) {
          await db.productionQuantityUpdate.deleteMany({
            where: { productionTaskId: { in: taskIds } },
          });
          const qualityCheckIds = (
            await db.productionQualityCheck.findMany({
              where: { productionTaskId: { in: taskIds } },
              select: { id: true },
            })
          ).map((q) => q.id);
          if (qualityCheckIds.length > 0) {
            await db.productionQualityCheckAttachment.deleteMany({
              where: { qualityCheckId: { in: qualityCheckIds } },
            });
            await db.productionQualityCheck.deleteMany({ where: { id: { in: qualityCheckIds } } });
          }
          await db.productionNote.deleteMany({
            where: {
              OR: [{ productionTaskId: { in: taskIds } }, { productionJobId: { in: jobIds } }],
            },
          });
          const issueIds = (
            await db.productionIssue.findMany({
              where: {
                OR: [{ productionTaskId: { in: taskIds } }, { productionJobId: { in: jobIds } }],
              },
              select: { id: true },
            })
          ).map((i) => i.id);
          if (issueIds.length > 0) {
            await db.productionIssueAttachment.deleteMany({ where: { issueId: { in: issueIds } } });
            await db.productionIssue.deleteMany({ where: { id: { in: issueIds } } });
          }
          await db.productionTask.updateMany({
            where: { id: { in: taskIds } },
            data: { dependsOnTaskId: null },
          });
          await db.productionTask.deleteMany({ where: { id: { in: taskIds } } });
        }
        await db.productionJob.deleteMany({ where: { id: { in: jobIds } } });
      }

      const batchIds = (
        await db.exportBatch.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((b) => b.id);
      if (batchIds.length > 0) {
        await db.exportBatchItem.deleteMany({ where: { exportBatchId: { in: batchIds } } });
        await db.exportBatch.updateMany({
          where: { id: { in: batchIds } },
          data: { previousBatchId: null },
        });
        await db.exportBatch.deleteMany({ where: { id: { in: batchIds } } });
      }

      if (groupIds.length > 0) {
        const artworkIds = (
          await db.productionArtwork.findMany({
            where: { proofGroupId: { in: groupIds } },
            select: { id: true },
          })
        ).map((a) => a.id);
        if (artworkIds.length > 0) {
          await db.productionArtworkOrderLine.deleteMany({
            where: { productionArtworkId: { in: artworkIds } },
          });
          await db.productionArtwork.updateMany({
            where: { id: { in: artworkIds } },
            data: { supersededByArtworkId: null },
          });
          await db.productionArtwork.deleteMany({ where: { id: { in: artworkIds } } });
        }
      }

      const requestIds = (
        await db.proofRequest.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (requestIds.length > 0) {
        const responseIds = (
          await db.customerProofResponse.findMany({
            where: { proofRequestId: { in: requestIds } },
            select: { id: true },
          })
        ).map((r) => r.id);
        if (responseIds.length > 0) {
          await db.customerResponseAsset.deleteMany({ where: { responseId: { in: responseIds } } });
          await db.customerProofResponse.deleteMany({ where: { id: { in: responseIds } } });
        }
        await db.proofReminder.deleteMany({ where: { proofRequestId: { in: requestIds } } });
        const dispatchIds = (
          await db.klaviyoDispatch.findMany({
            where: { proofRequestId: { in: requestIds } },
            select: { id: true },
          })
        ).map((d) => d.id);
        if (dispatchIds.length > 0) {
          const failureIds = (
            await db.integrationFailure.findMany({
              where: { relatedOrderId: { in: orderIds } },
              select: { id: true },
            })
          ).map((f) => f.id);
          if (failureIds.length > 0) {
            await db.integrationAttempt.deleteMany({ where: { failureId: { in: failureIds } } });
          }
        }
        await db.klaviyoDispatch.deleteMany({ where: { proofRequestId: { in: requestIds } } });
        await db.proofRequestGroup.deleteMany({ where: { proofRequestId: { in: requestIds } } });
        await db.proofRequest.deleteMany({ where: { id: { in: requestIds } } });
      }

      if (groupIds.length > 0) {
        const versionIds = (
          await db.proofVersion.findMany({
            where: { proofGroupId: { in: groupIds } },
            select: { id: true },
          })
        ).map((v) => v.id);
        if (versionIds.length > 0) {
          await db.proofVersionSourceAsset.deleteMany({
            where: { proofVersionId: { in: versionIds } },
          });
          await db.proofAsset.deleteMany({ where: { proofVersionId: { in: versionIds } } });
          await db.proofNote.deleteMany({ where: { proofVersionId: { in: versionIds } } });
          await db.proofVersion.updateMany({
            where: { id: { in: versionIds } },
            data: { supersededByVersionId: null },
          });
          await db.proofVersion.deleteMany({ where: { id: { in: versionIds } } });
        }
        await db.proofGroupArtworkAsset.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.proofGroupOrderLine.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.proofNote.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.proofRequirement.deleteMany({ where: { proofGroupId: { in: groupIds } } });
        await db.integrationFailure.deleteMany({
          where: { relatedProofGroupId: { in: groupIds } },
        });
        await db.manualOverride.deleteMany({ where: { relatedEntityId: { in: groupIds } } });
        await db.proofGroup.deleteMany({ where: { id: { in: groupIds } } });
      }

      const lineIds = (
        await db.shopifyOrderLine.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((l) => l.id);
      if (lineIds.length > 0) {
        await db.productionArtworkOrderLine.deleteMany({ where: { orderLineId: { in: lineIds } } });
        await db.artworkOrderLineLink.deleteMany({ where: { orderLineId: { in: lineIds } } });
        await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
        await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
      }

      // Milestone 13 — a WarehousePickJob is auto-created the moment
      // productionSummary reaches COMPLETE, so any test that completes
      // production work needs its own cleanup here too.
      const pickJobIds = (
        await db.warehousePickJob.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((j) => j.id);
      if (pickJobIds.length > 0) {
        await db.warehousePickQuantityUpdate.deleteMany({
          where: { warehousePickItem: { warehousePickJobId: { in: pickJobIds } } },
        });
        await db.warehouseIssue.deleteMany({ where: { warehousePickJobId: { in: pickJobIds } } });
        await db.warehouseNote.deleteMany({ where: { warehousePickJobId: { in: pickJobIds } } });
        await db.warehousePickItem.deleteMany({
          where: { warehousePickJobId: { in: pickJobIds } },
        });
        await db.warehousePickJob.deleteMany({ where: { id: { in: pickJobIds } } });
      }

      await db.activityEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      const orderFailureIds = (
        await db.integrationFailure.findMany({
          where: { relatedOrderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((f) => f.id);
      if (orderFailureIds.length > 0) {
        await db.integrationAttempt.deleteMany({ where: { failureId: { in: orderFailureIds } } });
      }
      await db.integrationFailure.deleteMany({ where: { relatedOrderId: { in: orderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (staffUserIds.length > 0) {
      // Milestone 16 — notification creation (case assignment, blocking
      // warehouse/production issues) targets these same tracked staff
      // users, so their notifications must go first.
      await db.notification.deleteMany({ where: { staffUserId: { in: staffUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: staffUserIds } } });
    }
  }

  async function createOrder(overrides: { cancelledAt?: Date } = {}) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#production-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        customerEmail: `customer-${randomUUID()}@example.test`,
        customerName: "Test Customer",
        cancelledAt: overrides.cancelledAt,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function createOrderLine(orderId: string, quantity = 10) {
    return db.shopifyOrderLine.create({
      data: {
        orderId,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Test Product",
        quantity,
      },
    });
  }

  async function createStaffUser() {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: "irrelevant",
      },
    });
    staffUserIds.push(staffUser.id);
    return staffUser;
  }

  /** Creates a proof group whose current version is genuinely customer-approved, via the real send/response pipeline. */
  async function createApprovedGroup(params: {
    orderId: string;
    shopId: string;
    staffUserId: string;
    orderLineId: string;
    name?: string;
  }) {
    const group = await createProofGroup({
      shopId: params.shopId,
      orderId: params.orderId,
      name: params.name ?? "Test approved group",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [params.orderLineId],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: params.staffUserId,
    });
    if (group.outcome !== "created") {
      throw new Error(`createApprovedGroup: failed to create group — ${JSON.stringify(group)}`);
    }
    const version = await createProofVersion({
      shopId: params.shopId,
      proofGroupId: group.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: params.staffUserId,
    });
    if (version.outcome !== "created") {
      throw new Error(`createApprovedGroup: failed to create version — ${JSON.stringify(version)}`);
    }
    const ready = await markProofVersionReady({
      shopId: params.shopId,
      proofVersionId: version.proofVersionId,
      staffUserId: params.staffUserId,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`createApprovedGroup: failed to mark ready — ${JSON.stringify(ready)}`);
    }
    const send = await sendProofRequest({
      shopId: params.shopId,
      orderId: params.orderId,
      proofGroupIds: [group.proofGroupId],
      staffMessage: null,
      staffUserId: params.staffUserId,
    });
    if (send.outcome !== "sent") {
      throw new Error(`createApprovedGroup: failed to send — ${JSON.stringify(send)}`);
    }
    const approve = await recordCustomerProofResponse({
      rawToken: send.rawToken,
      proofGroupId: group.proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: `test-approve-${group.proofGroupId}`,
      requestIp: null,
      requestUserAgent: "test",
      files: [],
    });
    if (approve.outcome === "rejected") {
      throw new Error(`createApprovedGroup: failed to approve — ${approve.reason}`);
    }
    return { proofGroupId: group.proofGroupId, proofVersionId: version.proofVersionId };
  }

  /** Creates a legitimately NO_PROOF_REQUIRED group with a documented reason. */
  async function createNoProofRequiredGroup(params: {
    orderId: string;
    shopId: string;
    staffUserId: string;
    orderLineId: string;
    name?: string;
  }) {
    const group = await createProofGroup({
      shopId: params.shopId,
      orderId: params.orderId,
      name: params.name ?? "Test no-proof-required group",
      decorationMethod: "EMBROIDERY",
      placement: "Front badge",
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: "APPROVED_STANDARD_LOGO",
      noProofReasonNote: "Standard logo.",
      orderLineIds: [params.orderLineId],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: params.staffUserId,
    });
    if (group.outcome !== "created") {
      throw new Error(
        `createNoProofRequiredGroup: failed to create group — ${JSON.stringify(group)}`,
      );
    }
    return group.proofGroupId;
  }

  return {
    cleanup,
    createOrder,
    createOrderLine,
    createStaffUser,
    createApprovedGroup,
    createNoProofRequiredGroup,
  };
}

export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
export const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
