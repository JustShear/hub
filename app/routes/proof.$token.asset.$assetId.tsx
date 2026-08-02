import type { Route } from "./+types/proof.$token.asset.$assetId";
import { db } from "~/lib/db.server";
import { resolveProofRequestByToken } from "~/auth/proof-token.server";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";

// Public, but scoped: the asset must belong to a proof version that this
// exact ProofRequest actually sent (past or present) — never any other
// version, group, order, or request. No customer-facing route ever streams
// bytes based on the asset id alone.
export async function loader({ params }: Route.LoaderArgs) {
  const resolved = await resolveProofRequestByToken(params.token);
  if (resolved.outcome !== "valid") {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This proof link is no longer valid.", { status: 404 });
  }

  const groupProofGroupIds = (
    await db.proofRequestGroup.findMany({
      where: { proofRequestId: resolved.proofRequest.id },
      select: { proofGroupId: true },
    })
  ).map((g) => g.proofGroupId);

  const asset = await db.proofAsset.findFirst({
    where: {
      id: params.assetId,
      proofVersion: {
        proofGroupId: { in: groupProofGroupIds },
        // Only ever a version that was genuinely sent at some point —
        // never a still-internal draft, even if it happens to share a
        // group with this request.
        requestLinks: { some: {} },
      },
    },
  });
  if (!asset) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("File not found", { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.getObjectBuffer(asset.storageKey);
  } catch {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This file is unavailable right now.", { status: 502 });
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": asset.mimeType ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
