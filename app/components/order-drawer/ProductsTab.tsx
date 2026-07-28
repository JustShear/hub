import { useState } from "react";
import { ImageOff } from "lucide-react";
import type {
  OrderDetail,
  OrderDetailLine,
  OrderDetailLineProperty,
} from "~/domain/orders/order-detail-query.server";
import { EmptyState } from "~/components/shared/EmptyState";

const VALUE_EXPAND_THRESHOLD = 80;

function ExpandableValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > VALUE_EXPAND_THRESHOLD;
  if (!isLong || expanded) {
    return (
      <span className="whitespace-pre-wrap break-words">
        {value}
        {isLong ? (
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
            }}
            className="ml-2 text-xs text-brand-navy hover:underline"
          >
            Show less
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="whitespace-pre-wrap break-words">
      {value.slice(0, VALUE_EXPAND_THRESHOLD)}…
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
        }}
        className="ml-2 text-xs text-brand-navy hover:underline"
      >
        Show more
      </button>
    </span>
  );
}

const DETECTED_TYPE_LABELS: Record<OrderDetailLineProperty["detectedType"], string> = {
  TEXT: "Text",
  SELECTION: "Selection",
  URL: "Link",
  FILE_UPLOAD: "File upload",
  UNKNOWN: "Uncertain",
};

function PropertyRow({ property }: { property: OrderDetailLineProperty }) {
  const uncertain = property.detectedType === "UNKNOWN";
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-1.5 text-sm last:border-b-0 sm:flex-row sm:gap-3">
      <span className="font-medium text-ink sm:w-40 sm:shrink-0">{property.name}</span>
      <span className="text-ink">
        {property.detectedType === "URL" ? (
          <a
            href={property.value}
            target="_blank"
            rel="noreferrer"
            className="text-brand-navy hover:underline"
          >
            {property.value}
          </a>
        ) : (
          <ExpandableValue value={property.value} />
        )}
      </span>
      <span className="text-xs text-muted sm:ml-auto">
        {DETECTED_TYPE_LABELS[property.detectedType]}
        {uncertain ? " — parsing uncertain" : ""}
      </span>
    </div>
  );
}

function ProductImage({ line }: { line: OrderDetailLine }) {
  const label = `${line.productTitle}${line.variantTitle ? ` — ${line.variantTitle}` : ""}`;
  if (!line.imageUrl) {
    return (
      <span
        title={label}
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-page text-muted"
      >
        <ImageOff aria-hidden="true" className="h-6 w-6" />
        <span className="sr-only">{label} — no image available</span>
      </span>
    );
  }
  return (
    <img
      src={line.imageUrl}
      alt={label}
      width={64}
      height={64}
      loading="lazy"
      className="h-16 w-16 shrink-0 rounded border border-border object-cover"
    />
  );
}

function LineRow({ line }: { line: OrderDetailLine }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex gap-4">
        <ProductImage line={line} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{line.productTitle}</p>
          {line.variantTitle ? <p className="text-sm text-muted">{line.variantTitle}</p> : null}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
            {line.sku ? <span>SKU {line.sku}</span> : null}
            {line.barcode ? <span>Barcode {line.barcode}</span> : null}
            <span>
              Qty {line.quantity}
              {line.fulfilledQuantity !== null ? ` (${line.fulfilledQuantity} fulfilled)` : ""}
            </span>
            {line.shopifyProductGid ? <span>Product {line.shopifyProductGid}</span> : null}
            {line.shopifyVariantGid ? <span>Variant {line.shopifyVariantGid}</span> : null}
          </div>
        </div>
      </div>

      {line.properties.length > 0 ? (
        <div className="mt-3 border-t border-border pt-2">
          {line.properties.map((property) => (
            <PropertyRow key={property.id} property={property} />
          ))}
        </div>
      ) : null}

      {line.artworkLinks.length > 0 ? (
        <div className="mt-3 border-t border-border pt-2">
          <h5 className="text-xs font-medium text-muted">Linked artwork</h5>
          <ul className="mt-1 flex flex-col gap-1">
            {line.artworkLinks.map((link) => (
              <li key={link.id} className="text-sm text-ink">
                {link.asset.originalFilename ?? "Untitled file"}
                {link.asset.sourceUrl ? (
                  <a
                    href={link.asset.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-xs text-brand-navy hover:underline"
                  >
                    Open
                  </a>
                ) : null}
                {link.asset.parsingUncertain ? (
                  <span className="ml-2 text-xs text-warning">Parsing uncertain</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProductsTab({ order }: { order: OrderDetail }) {
  if (order.lines.length === 0) {
    return (
      <EmptyState title="No product lines" description="This order has no line items on record." />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {order.lines.map((line) => (
        <LineRow key={line.id} line={line} />
      ))}
    </div>
  );
}
