import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

export async function loadExceptionCaseDetail(params: { shopId: string; exceptionCaseId: string }) {
  const exceptionCase = await db.exceptionCase.findFirst({
    where: { id: params.exceptionCaseId, shopId: params.shopId },
    include: {
      order: { select: { id: true, orderNumber: true, customerName: true } },
      orderLine: { select: { id: true, productTitle: true, variantTitle: true, sku: true } },
      resolutions: { orderBy: { decidedAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!exceptionCase) return null;

  const [activity, proofGroups] = await Promise.all([
    db.activityEvent.findMany({
      where: {
        orderId: exceptionCase.orderId,
        entityType: "ExceptionCase",
        entityId: exceptionCase.id,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.proofGroup.findMany({
      where: { orderId: exceptionCase.orderId, status: { notIn: ["CANCELLED"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const staffIds = [
    exceptionCase.assignedStaffId,
    exceptionCase.createdByStaffId,
    exceptionCase.cancelledByStaffId,
    exceptionCase.returnLabelProvidedByStaffId,
    ...exceptionCase.resolutions.map((r) => r.decidedByStaffId),
    ...exceptionCase.resolutions.map((r) => r.completedByStaffId),
    ...exceptionCase.notes.map((n) => n.authorStaffId),
    ...activity.map((a) => a.actorStaffId),
  ];
  const staffNames = await resolveStaffNames(staffIds);

  return {
    exceptionCase: {
      ...exceptionCase,
      // Decimal doesn't survive the loader-to-component serialization
      // boundary with its class identity intact — stringify here, same as
      // the order-detail-scoped query (exception-case-order-query.server.ts)
      // already does.
      resolutions: exceptionCase.resolutions.map((r) => ({
        ...r,
        amount: r.amount?.toString() ?? null,
      })),
    },
    proofGroups,
    activity,
    staffNames: Object.fromEntries(staffNames),
  };
}

export type ExceptionCaseDetail = NonNullable<Awaited<ReturnType<typeof loadExceptionCaseDetail>>>;
