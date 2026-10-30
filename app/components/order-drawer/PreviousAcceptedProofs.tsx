import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { ImageOff } from "lucide-react";
import type { PreviousAcceptedProofs as PreviousAcceptedProofsData } from "~/domain/customers/customer-query.server";
import { formatAuDate } from "~/lib/dates";

export interface PreviousAcceptedProofsProps {
  orderId: string;
}

// Shows this customer's accepted proofs from their other orders, so a repeat
// order can be matched against artwork already made and approved. Fetched
// after the drawer opens (not part of its loader) to keep opening fast; any
// failure just hides the section rather than disturbing the rest of the tab.
export function PreviousAcceptedProofs({ orderId }: PreviousAcceptedProofsProps) {
  const fetcher = useFetcher<PreviousAcceptedProofsData>();
  const { load } = fetcher;

  useEffect(() => {
    void load(`/orders/${orderId}/previous-proofs`);
  }, [load, orderId]);

  const data = fetcher.data;
  if (!data?.customerKey) {
    return null;
  }

  const hiddenCount = data.totalCount - data.proofs.length;

  return (
    <section aria-labelledby="previous-proofs-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="previous-proofs-heading" className="text-sm font-semibold text-ink">
          Previously accepted proofs
        </h3>
        <Link
          to={`/customers/${data.customerKey}`}
          className="rounded text-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          View customer file
        </Link>
      </div>

      {data.proofs.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          No accepted proofs yet from this customer&apos;s other orders.
        </p>
      ) : (
        <>
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.proofs.map((proof) => {
              const isImage = proof.assetId !== null && (proof.mimeType ?? "").startsWith("image/");
              return (
                <li
                  key={proof.versionId}
                  className="rounded-lg border border-border bg-surface p-2"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-page">
                    {isImage ? (
                      <img
                        src={`/proof-assets/${proof.assetId}`}
                        alt={`${proof.groupName} proof, version ${proof.versionNumber}`}
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ImageOff aria-label="No preview available" className="h-5 w-5 text-muted" />
                    )}
                  </div>
                  <Link
                    to={`/orders/${proof.orderId}`}
                    className="mt-1 block w-fit rounded text-sm font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                  >
                    {proof.orderNumber}
                  </Link>
                  <p className="truncate text-xs text-muted">{proof.groupName}</p>
                  <p className="text-xs text-muted">{formatAuDate(proof.at)}</p>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 ? (
            <p className="mt-2 text-xs text-muted">
              and {hiddenCount} more in the{" "}
              <Link
                to={`/customers/${data.customerKey}`}
                className="underline underline-offset-2 hover:text-ink"
              >
                customer file
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
