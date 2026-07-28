import type {
  OrderDetail,
  OrderDetailIntegrationIssue,
} from "~/domain/orders/order-detail-query.server";
import { ORDER_STATUS_LABELS, PROOF_SUMMARY_LABELS } from "~/domain/orders/labels";
import { AssignmentEditor } from "~/components/order-drawer/AssignmentEditor";
import { PriorityEditor } from "~/components/order-drawer/PriorityEditor";
import { DueDatesEditor } from "~/components/order-drawer/DueDatesEditor";
import { ErrorAlert } from "~/components/shared/ErrorAlert";
import { formatAuDateTime } from "~/lib/dates";
import { formatAuDate } from "~/lib/dates";

const ACTION_REQUIRED_STATUSES = new Set(["NEW", "RETRYING", "NEEDS_ATTENTION"]);

function IntegrationIssueCard({ issue }: { issue: OrderDetailIntegrationIssue }) {
  const actionRequired = ACTION_REQUIRED_STATUSES.has(issue.status);
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{issue.summary}</p>
        <span className="shrink-0 text-xs text-muted">{issue.severity}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {issue.integration} · {actionRequired ? "Action required" : "Being handled"} · First seen{" "}
        {formatAuDateTime(issue.firstFailureAt)}, latest {formatAuDateTime(issue.latestFailureAt)}
      </p>
      {issue.technicalDetail !== undefined ? (
        <div className="mt-2 border-t border-border pt-2">
          {issue.technicalDetail ? (
            <p className="text-xs text-muted">{issue.technicalDetail}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {issue.attemptCount} attempt{issue.attemptCount === 1 ? "" : "s"} so far
          </p>
        </div>
      ) : null}
    </div>
  );
}

export interface OverviewTabProps {
  order: OrderDetail;
  assignableStaff: { id: string; name: string }[];
  canEditAssignment: boolean;
  canEditPriority: boolean;
  canEditDueDates: boolean;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-muted">{label}</h4>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  );
}

export function OverviewTab({
  order,
  assignableStaff,
  canEditAssignment,
  canEditPriority,
  canEditDueDates,
}: OverviewTabProps) {
  const latestNote = order.notes[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      {order.integrationIssues.length > 0 ? (
        <section>
          <ErrorAlert
            tone="warning"
            title={`${order.integrationIssues.length} integration issue${order.integrationIssues.length === 1 ? "" : "s"} affecting this order`}
          />
          <div className="mt-2 flex flex-col gap-2">
            {order.integrationIssues.map((issue) => (
              <IntegrationIssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        </section>
      ) : null}

      {order.cancelledAt ? (
        <ErrorAlert
          tone="error"
          title="This order is cancelled"
          description={`Cancelled ${formatAuDate(order.cancelledAt)}${order.cancelReason ? ` — ${order.cancelReason}` : ""}`}
        />
      ) : null}

      <section>
        <h3 className="text-sm font-semibold text-ink">Internal workflow (Production Hub)</h3>
        <p className="mt-0.5 text-xs text-muted">
          Editable here with the right permission — Shopify never overwrites these fields.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Workflow status" value={ORDER_STATUS_LABELS[order.workflowStatus]} />
          <Field
            label="Time in this status"
            value={`${order.daysInState} day${order.daysInState === 1 ? "" : "s"}`}
          />
          <PriorityEditor currentPriority={order.priority} canEdit={canEditPriority} />
          <AssignmentEditor
            currentStaffUserId={order.assignment?.staffUserId ?? null}
            currentStaffUserName={order.assignment?.staffUserName ?? null}
            assignableStaff={assignableStaff}
            canEdit={canEditAssignment}
          />
        </div>
        <div className="mt-4">
          <DueDatesEditor dueDates={order.dueDates} canEdit={canEditDueDates} />
        </div>
        {latestNote ? (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-muted">Latest internal note</h4>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink">
              {latestNote.body}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {latestNote.authorStaffName} · {formatAuDate(latestNote.createdAt)}
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Order summary (from Shopify — read only)</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Proof requirement" value={PROOF_SUMMARY_LABELS[order.proofSummary]} />
          <Field
            label="Order age"
            value={`${order.orderAgeDays} day${order.orderAgeDays === 1 ? "" : "s"}`}
          />
          <Field label="Financial status" value={order.financialStatus ?? "Unknown"} />
          <Field label="Fulfillment status" value={order.fulfillmentStatus ?? "Unfulfilled"} />
          <Field label="Shipping method" value={order.shippingMethod ?? "Not specified"} />
          <Field label="Preorder" value={order.isPreorder ? "Yes" : "No"} />
          {order.isWaitingOnCustomer ? (
            <Field label="Customer response" value="Waiting on customer" />
          ) : null}
          {order.hasCustomerResponseAlert ? (
            <Field label="Customer response" value="Changes requested by customer" />
          ) : null}
        </div>
        {order.tags.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-muted">Shopify tags</h4>
            <div className="mt-1 flex flex-wrap gap-1">
              {order.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-page px-2 py-0.5 text-xs text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {order.noteFromCustomer ? (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-muted">Customer note (from Shopify)</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{order.noteFromCustomer}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
