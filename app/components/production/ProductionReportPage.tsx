import { Link, useSearchParams } from "react-router";
import { PageHeader } from "~/components/shared/PageHeader";
import { DECORATION_WORKSTREAM_LABELS } from "~/domain/production/labels";
import { formatAuDate } from "~/lib/dates";
import type { ProductionReport } from "~/domain/production/report.server";

export interface ProductionReportPageProps {
  report: ProductionReport;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export function ProductionReportPage({ report }: ProductionReportPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  function apply(from: string, to: string) {
    const params = new URLSearchParams(searchParams);
    params.set("from", from);
    params.set("to", to);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Production Reporting"
        description="Basic production metrics for a date range — no productivity scoring or targets, real counts only."
        secondaryActions={
          <Link
            to="/production"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-page"
          >
            Back to queue
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          From
          <input
            type="date"
            defaultValue={toDateInputValue(report.from)}
            onChange={(e) => {
              apply(e.target.value, toDateInputValue(report.to));
            }}
            className="rounded border border-border bg-page px-2 py-1 text-xs text-ink"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          To
          <input
            type="date"
            defaultValue={toDateInputValue(report.to)}
            onChange={(e) => {
              apply(toDateInputValue(report.from), e.target.value);
            }}
            className="rounded border border-border bg-page px-2 py-1 text-xs text-ink"
          />
        </label>
        <span className="text-xs text-muted">
          {formatAuDate(report.from)} – {formatAuDate(report.to)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Jobs created" value={report.jobsCreated} />
        <StatCard label="Jobs completed" value={report.jobsCompleted} />
        <StatCard label="Average lead time (days)" value={report.averageLeadTimeDays ?? "—"} />
        <StatCard label="Quantity produced" value={report.quantityProduced} />
        <StatCard label="Quantity failed" value={report.quantityFailed} />
        <StatCard label="Quantity reworked" value={report.quantityReworked} />
        <StatCard label="Currently blocked jobs" value={report.currentBlockedJobCount} />
        <StatCard label="Currently overdue jobs" value={report.currentOverdueJobCount} />
      </div>

      <section>
        <h3 className="text-sm font-semibold text-ink">Jobs created by decoration method</h3>
        {report.byDecorationMethod.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No jobs created in this date range.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Decoration method</th>
                  <th className="p-2 font-medium">Jobs created</th>
                </tr>
              </thead>
              <tbody>
                {report.byDecorationMethod.map((row) => (
                  <tr key={row.decorationMethod} className="border-b border-border last:border-b-0">
                    <td className="p-2 text-ink">
                      {DECORATION_WORKSTREAM_LABELS[row.decorationMethod]}
                    </td>
                    <td className="p-2 text-ink">{row.jobsCreated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Current active-job assignment counts</h3>
        {report.staffAssignmentCounts.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            No staff currently have active production jobs assigned.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Staff member</th>
                  <th className="p-2 font-medium">Active jobs</th>
                </tr>
              </thead>
              <tbody>
                {report.staffAssignmentCounts.map((row) => (
                  <tr key={row.staffUserId} className="border-b border-border last:border-b-0">
                    <td className="p-2 text-ink">{row.staffUserName}</td>
                    <td className="p-2 text-ink">{row.activeJobCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
