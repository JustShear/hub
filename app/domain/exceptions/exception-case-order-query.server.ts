import type {
  ExceptionCaseCategory,
  ExceptionCaseInitiator,
  ExceptionCaseStatus,
  ExceptionResolutionStatus,
  ExceptionResolutionType,
  Severity,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

export interface OrderDetailExceptionResolution {
  id: string;
  resolutionType: ExceptionResolutionType;
  status: ExceptionResolutionStatus;
  reason: string;
  amount: string | null;
  currencyCode: string | null;
  exportBatchId: string | null;
  decidedByStaffName: string;
  decidedAt: string;
  completedByStaffName: string | null;
  completedAt: string | null;
}

export interface OrderDetailExceptionCase {
  id: string;
  caseNumber: number;
  category: ExceptionCaseCategory;
  initiatedBy: ExceptionCaseInitiator;
  status: ExceptionCaseStatus;
  severity: Severity;
  summary: string;
  customerNote: string | null;
  orderLineId: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  createdByStaffName: string;
  createdAt: string;
  updatedAt: string;
  investigationStartedAt: string | null;
  returnLabelProvidedAt: string | null;
  returnLabelNote: string | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  resolutions: OrderDetailExceptionResolution[];
}

export async function loadExceptionCasesForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailExceptionCase[]> {
  const cases = await db.exceptionCase.findMany({
    where: { orderId: params.orderId, shopId: params.shopId },
    orderBy: { caseNumber: "desc" },
    include: { resolutions: { orderBy: { decidedAt: "desc" } } },
  });
  if (cases.length === 0) return [];

  const staffNames = await resolveStaffNames([
    ...cases.map((c) => c.assignedStaffId),
    ...cases.map((c) => c.createdByStaffId),
    ...cases.flatMap((c) => c.resolutions.map((r) => r.decidedByStaffId)),
    ...cases.flatMap((c) => c.resolutions.map((r) => r.completedByStaffId)),
  ]);

  return cases.map((c) => ({
    id: c.id,
    caseNumber: c.caseNumber,
    category: c.category,
    initiatedBy: c.initiatedBy,
    status: c.status,
    severity: c.severity,
    summary: c.summary,
    customerNote: c.customerNote,
    orderLineId: c.orderLineId,
    assignedStaffId: c.assignedStaffId,
    assignedStaffName: c.assignedStaffId ? (staffNames.get(c.assignedStaffId) ?? null) : null,
    createdByStaffName: staffNames.get(c.createdByStaffId) ?? "Unknown staff member",
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    investigationStartedAt: c.investigationStartedAt?.toISOString() ?? null,
    returnLabelProvidedAt: c.returnLabelProvidedAt?.toISOString() ?? null,
    returnLabelNote: c.returnLabelNote,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    cancelReason: c.cancelReason,
    resolutions: c.resolutions.map((r) => ({
      id: r.id,
      resolutionType: r.resolutionType,
      status: r.status,
      reason: r.reason,
      amount: r.amount?.toString() ?? null,
      currencyCode: r.currencyCode,
      exportBatchId: r.exportBatchId,
      decidedByStaffName: staffNames.get(r.decidedByStaffId) ?? "Unknown staff member",
      decidedAt: r.decidedAt.toISOString(),
      completedByStaffName: r.completedByStaffId
        ? (staffNames.get(r.completedByStaffId) ?? null)
        : null,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
  }));
}
