import { Link, useSearchParams } from "react-router";
import { PageHeader } from "~/components/shared/PageHeader";
import {
  EXCEPTION_CASE_CATEGORY_LABELS,
  EXCEPTION_RESOLUTION_TYPE_LABELS,
} from "~/domain/exceptions/labels";
import { formatAuDate } from "~/lib/dates";
import type { ExceptionsReport } from "~/domain/exceptions/report.server";

export interface ExceptionsReportPageProps {
  report: ExceptionsReport;
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

export function ExceptionsReportPage({ report }: ExceptionsReportPageProps) {
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
        title="Exceptions Reporting"
        description="Basic returns/warranty/defect metrics for a date range — no productivity scoring or targets, real counts only."
        secondaryActions={
          <Link
            to="/exceptions"
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
        <StatCard label="Cases opened" value={report.casesOpened} />
        <StatCard label="Cases resolved" value={report.casesResolved} />
        <StatCard
          label="Average time to resolution (days)"
          value={report.averageTimeToResolutionDays ?? "—"}
        />
        <StatCard label="Currently open cases" value={report.currentOpenCaseCount} />
        <StatCard
          label="Recorded credit/refund total"
          value={`$${report.totalRecordedCreditRefundAmount}`}
        />
      </div>
      <p className="text-xs text-muted">
        The recorded credit/refund total reflects decisions recorded in the Hub, not confirmation
        that a refund or credit was actually processed in Shopify — see ADR-0010.
      </p>

      <section>
        <h3 className="text-sm font-semibold text-ink">Cases by category</h3>
        {report.byCategory.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No cases opened in this date range.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Category</th>
                  <th className="p-2 font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {report.byCategory.map((row) => (
                  <tr key={row.category} className="border-b border-border last:border-b-0">
                    <td className="p-2 text-ink">{EXCEPTION_CASE_CATEGORY_LABELS[row.category]}</td>
                    <td className="p-2 text-ink">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Resolutions by type</h3>
        {report.byResolutionType.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No resolutions recorded in this date range.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th className="p-2 font-medium">Resolution</th>
                  <th className="p-2 font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {report.byResolutionType.map((row) => (
                  <tr key={row.resolutionType} className="border-b border-border last:border-b-0">
                    <td className="p-2 text-ink">
                      {EXCEPTION_RESOLUTION_TYPE_LABELS[row.resolutionType]}
                    </td>
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
