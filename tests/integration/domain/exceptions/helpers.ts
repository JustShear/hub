import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { createProductionTestTracker, PDF_BYTES } from "../production/helpers";

/**
 * Shared fixture helpers for Milestone 14 (exception cases) integration
 * tests — wraps the Milestone 10 production tracker (order/staff/approved-
 * proof-group creation) since REPRINT/EXCHANGE resolutions call the same
 * createExportBatch machinery those tests already exercise.
 */
export function createExceptionTestTracker() {
  const productionTracker = createProductionTestTracker();
  const exceptionCaseIds: string[] = [];

  async function cleanup() {
    if (exceptionCaseIds.length > 0) {
      await db.exceptionCaseResolution.deleteMany({
        where: { exceptionCaseId: { in: exceptionCaseIds } },
      });
      await db.exceptionCaseNote.deleteMany({
        where: { exceptionCaseId: { in: exceptionCaseIds } },
      });
      await db.exceptionCaseAttachment.deleteMany({
        where: { exceptionCaseId: { in: exceptionCaseIds } },
      });
      await db.exceptionCase.deleteMany({ where: { id: { in: exceptionCaseIds } } });
    }
    await productionTracker.cleanup();
  }

  /** Creates a proof group with genuine production artwork ready for export — the precondition createExportBatch requires. */
  async function createReadyToExportGroup(params: {
    orderId: string;
    shopId: string;
    staffUserId: string;
  }) {
    const line = await productionTracker.createOrderLine(params.orderId);
    const approved = await productionTracker.createApprovedGroup({
      orderId: params.orderId,
      shopId: params.shopId,
      staffUserId: params.staffUserId,
      orderLineId: line.id,
    });
    const artwork = await createProductionArtwork({
      shopId: params.shopId,
      proofGroupId: approved.proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "artwork.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: params.staffUserId,
      idempotencyKey: null,
    });
    if (artwork.outcome !== "created") throw new Error("setup failed: createProductionArtwork");
    const allocation = await setProductionArtworkOrderLines({
      shopId: params.shopId,
      productionArtworkId: artwork.productionArtworkId,
      allocations: [{ orderLineId: line.id, quantity: line.quantity }],
      staffUserId: params.staffUserId,
    });
    if (allocation.outcome !== "set")
      throw new Error("setup failed: setProductionArtworkOrderLines");
    const ready = await markProductionArtworkReady({
      shopId: params.shopId,
      productionArtworkId: artwork.productionArtworkId,
      staffUserId: params.staffUserId,
    });
    if (ready.outcome !== "ready") throw new Error("setup failed: markProductionArtworkReady");

    return { proofGroupId: approved.proofGroupId, line };
  }

  function trackExceptionCase(exceptionCaseId: string) {
    exceptionCaseIds.push(exceptionCaseId);
  }

  return {
    cleanup,
    createOrder: productionTracker.createOrder,
    createOrderLine: productionTracker.createOrderLine,
    createStaffUser: productionTracker.createStaffUser,
    createReadyToExportGroup,
    trackExceptionCase,
  };
}
