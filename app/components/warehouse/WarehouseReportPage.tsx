import { Link, useSearchParams } from "react-router";
import { PageHeader } from "~/components/shared/PageHeader";
import { WAREHOUSE_ISSUE_TYPE_LABELS } from "~/domain/warehouse/labels";
import { formatAuDate } from "~/lib/dates";
import type { WarehouseReport } from "~/domain/warehouse/report.server";

export interface WarehouseReportPageProps {
  report: WarehouseReport;
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

export function WarehouseReportPage({ report }: WarehouseReportPageProps) {
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
        title="Warehouse Reporting"
        description="Basic warehouse-picking metrics for a date range — no productivity scoring or targets, real counts only."
        secondaryActions={
          <Link
            to="/warehouse"
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
        <StatCard label="Jobs handed over" value={report.jobsHandedOver} />
        <StatCard
          label="Average time to handover (days)"
          value={report.averageTimeToHandoverDays ?? "—"}
        />
        <StatCard label="Items picked" value={report.itemsPicked} />
        <StatCard label="Items short" value={report.itemsShort} />
        <StatCard
          label="Short rate"
          value={report.shortRatePercent === null ? "—" : `${report.shortRatePercent}%`}
        />
        <StatCard label="Currently queued jobs" value={report.currentQueuedJobCount} />
        <StatCard label="Currently in-progress jobs" value={report.currentInProgressJobCount} />
      </div>

      <section>
        <h3 className="text-sm font-semibold text-ink">Issues reported by type</h3>
        {report.byIssueType.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No issues reported in this date range.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Issue type</th>
                  <th className="p-2 font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {report.byIssueType.map((row) => (
                  <tr key={row.issueType} className="border-b border-border last:border-b-0">
                    <td className="p-2 text-ink">{WAREHOUSE_ISSUE_TYPE_LABELS[row.issueType]}</td>
                    <td className="p-2 text-ink">{row.count}</td>
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
