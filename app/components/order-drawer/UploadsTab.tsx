import { File as FileIcon } from "lucide-react";
import type {
  OrderDetail,
  OrderDetailArtworkLink,
  OrderDetailLine,
} from "~/domain/orders/order-detail-query.server";
import { EmptyState } from "~/components/shared/EmptyState";
import { formatAuDate } from "~/lib/dates";

const PREVIEWABLE_MIME_PREFIXES = ["image/"];

function isPreviewable(mimeType: string | null): boolean {
  return (
    mimeType !== null && PREVIEWABLE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STORAGE_STATUS_LABELS: Record<string, string> = {
  EXTERNAL_REFERENCE: "Referenced from source (not yet copied to storage)",
  STORED: "Stored",
};

function sourcePropertyName(line: OrderDetailLine, assetId: string): string | null {
  return line.properties.find((property) => property.parsedAssetId === assetId)?.name ?? null;
}

function UploadCard({ line, link }: { line: OrderDetailLine; link: OrderDetailArtworkLink }) {
  const asset = link.asset;
  const propertyName = sourcePropertyName(line, asset.id);

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-surface p-3">
      {isPreviewable(asset.mimeType) && asset.sourceUrl ? (
        <img
          src={asset.sourceUrl}
          alt={asset.originalFilename ?? "Uploaded file preview"}
          className="h-16 w-16 shrink-0 rounded border border-border object-cover"
        />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-page text-muted">
          <FileIcon aria-hidden="true" className="h-6 w-6" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{asset.originalFilename ?? "Untitled file"}</p>
        <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
          <span>
            {asset.mimeType ?? "Unknown file type"} · {formatSize(asset.sizeBytes)}
          </span>
          {propertyName ? <span>From property: {propertyName}</span> : null}
          <span>Uploaded {formatAuDate(asset.createdAt)}</span>
          <span>{STORAGE_STATUS_LABELS[asset.sourceType] ?? asset.sourceType}</span>
          {asset.parsingUncertain ? <span className="text-warning">Parsing uncertain</span> : null}
          {link.isManualReassignment ? (
            <span>
              Manually reassigned{link.reassignmentReason ? ` — ${link.reassignmentReason}` : ""}
            </span>
          ) : null}
        </div>
        {asset.sourceUrl ? (
          <a
            href={asset.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-brand-navy hover:underline"
          >
            Open source
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function UploadsTab({ order }: { order: OrderDetail }) {
  const linesWithUploads = order.lines.filter((line) => line.artworkLinks.length > 0);

  if (linesWithUploads.length === 0) {
    return (
      <EmptyState
        title="No customer uploads"
        description="No files were detected on this order's line items."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {linesWithUploads.map((line) => (
        <section key={line.id}>
          <h4 className="text-sm font-semibold text-ink">
            {line.productTitle}
            {line.variantTitle ? ` — ${line.variantTitle}` : ""}
          </h4>
          <div className="mt-2 flex flex-col gap-2">
            {line.artworkLinks.map((link) => (
              <UploadCard key={link.id} line={line} link={link} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
