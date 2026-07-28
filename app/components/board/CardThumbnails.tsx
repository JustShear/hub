import { ImageOff } from "lucide-react";
import type { BoardCardProductLine } from "~/domain/orders/board-query.server";

const THUMB_PIXELS = 64;
const DEFAULT_MAX_THUMBNAILS = 4;

// Shopify CDN accepts a `width` query param to constrain the delivered
// image size — keeps board payloads small without a separate resizing
// service. Falls back to the original URL if it isn't parseable.
function toThumbnailUrl(url: string, size: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("width", String(size));
    return parsed.toString();
  } catch {
    return url;
  }
}

export interface CardThumbnailsProps {
  lines: BoardCardProductLine[];
  totalLineCount: number;
  maxThumbnails?: number;
}

// Product line separation is preserved (one thumbnail per line, not merged)
// up to maxThumbnails; anything beyond that collapses into a "+N more" chip
// rather than silently disappearing.
export function CardThumbnails({
  lines,
  totalLineCount,
  maxThumbnails = DEFAULT_MAX_THUMBNAILS,
}: CardThumbnailsProps) {
  const shown = lines.slice(0, maxThumbnails);
  const remaining = totalLineCount - shown.length;

  if (shown.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {shown.map((line) => {
        const label = `${line.productTitle}${line.variantTitle ? ` — ${line.variantTitle}` : ""} (qty ${line.quantity})`;
        return line.imageUrl ? (
          <img
            key={line.id}
            src={toThumbnailUrl(line.imageUrl, THUMB_PIXELS)}
            alt={label}
            title={label}
            width={32}
            height={32}
            loading="lazy"
            className="h-8 w-8 rounded border border-border object-cover"
          />
        ) : (
          <span
            key={line.id}
            title={label}
            className="flex h-8 w-8 items-center justify-center rounded border border-border bg-page text-muted"
          >
            <ImageOff aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">{label} — no image available</span>
          </span>
        );
      })}
      {remaining > 0 ? (
        <span className="flex h-8 min-w-8 items-center justify-center rounded border border-border bg-page px-1.5 text-xs text-muted">
          +{remaining} more
        </span>
      ) : null}
    </div>
  );
}
