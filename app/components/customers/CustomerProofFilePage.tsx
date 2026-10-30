import { Link } from "react-router";
import { CircleCheck, ImageOff, MessageSquareWarning } from "lucide-react";
import type {
  CustomerChangesRequestedCard,
  CustomerProofCard,
  CustomerProofFile,
} from "~/domain/customers/customer-query.server";
import { DECORATION_METHOD_LABELS } from "~/domain/proofs/labels";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { formatAuDate } from "~/lib/dates";

function categoryLabel(category: string): string {
  const spaced = category.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ProofImage({ card }: { card: CustomerProofCard }) {
  // Only images can be shown inline - a PDF or other file type falls back to
  // the same "no preview" tile, with the order link still beneath it.
  const isImage = card.assetId !== null && (card.mimeType ?? "").startsWith("image/");
  return (
    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-page">
      {isImage ? (
        <img
          src={`/proof-assets/${card.assetId}`}
          alt={`${card.groupName} proof, version ${card.versionNumber}`}
          loading="lazy"
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="flex flex-col items-center gap-1 text-xs text-muted">
          <ImageOff aria-hidden="true" className="h-6 w-6" />
          No preview available
        </span>
      )}
    </div>
  );
}

function CardFooter({ card, dateLabel }: { card: CustomerProofCard; dateLabel: string }) {
  return (
    <div className="mt-2 flex flex-col gap-0.5">
      <Link
        to={`/orders/${card.orderId}`}
        className="w-fit rounded font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
      >
        {card.orderNumber}
      </Link>
      <p className="text-sm text-ink">{card.groupName}</p>
      <p className="text-xs text-muted">
        {DECORATION_METHOD_LABELS[card.decorationMethod]} · v{card.versionNumber} · {dateLabel}{" "}
        {formatAuDate(card.at)}
      </p>
    </div>
  );
}

function AcceptedCard({ card }: { card: CustomerProofCard }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <ProofImage card={card} />
      <CardFooter card={card} dateLabel="Accepted" />
    </li>
  );
}

function ChangesRequestedCard({ card }: { card: CustomerChangesRequestedCard }) {
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <ProofImage card={card} />
      <CardFooter card={card} dateLabel="Requested" />
      {card.categories.length > 0 ? (
        <p className="mt-1 text-xs font-medium text-ink">
          {card.categories.map(categoryLabel).join(", ")}
        </p>
      ) : null}
      {card.customerNote ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{card.customerNote}</p>
      ) : null}
      {card.laterApproved ? (
        <p className="mt-2 inline-block rounded bg-accent-green px-2 py-0.5 text-xs text-ink">
          A later version was approved
        </p>
      ) : null}
    </li>
  );
}

export interface CustomerProofFilePageProps {
  file: CustomerProofFile;
}

export function CustomerProofFilePage({ file }: CustomerProofFilePageProps) {
  const { customer, accepted, changesRequested } = file;
  const description = [
    customer.email,
    customer.phone,
    `${customer.orderCount} order${customer.orderCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={customer.name ?? "Customer with no name on file"}
        description={description}
        breadcrumbs={[
          { label: "Customers", href: "/customers" },
          { label: customer.name ?? "Customer" },
        ]}
      />

      <section aria-labelledby="proofs-accepted">
        <h2 id="proofs-accepted" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <CircleCheck aria-hidden="true" className="h-5 w-5 text-success" />
          Proofs accepted
          <span className="text-sm font-normal text-muted">({accepted.length})</span>
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          The final approved proof for each artwork. Click an order number to open the order.
        </p>
        {accepted.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No accepted proofs yet"
              description="Once a proof for this customer is approved it will appear here."
            />
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {accepted.map((card) => (
              <AcceptedCard key={card.versionId} card={card} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="proofs-changes-requested">
        <h2
          id="proofs-changes-requested"
          className="flex items-center gap-2 text-lg font-semibold text-ink"
        >
          <MessageSquareWarning aria-hidden="true" className="h-5 w-5 text-warning" />
          Rejected or changes requested
          <span className="text-sm font-normal text-muted">({changesRequested.length})</span>
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          Every proof version this customer sent back, with what they asked for.
        </p>
        {changesRequested.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No change requests"
              description="This customer has not sent any proof back for changes."
            />
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {changesRequested.map((card) => (
              <ChangesRequestedCard key={card.versionId} card={card} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
