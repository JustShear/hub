import type { ChangeRequestCategory } from "@prisma/client";
import type { Route } from "./+types/proof.$token.respond";
import { formString, formStringOrNull } from "~/lib/form-data";
import { recordProofView } from "~/domain/proofs/record-proof-view.server";
import { recordCustomerProofResponse } from "~/domain/proofs/record-customer-proof-response.server";

// Every meaningful customer action goes through this ONE action route,
// gated entirely by the token (no staff session involved) — a GET request
// can never reach any of this; React Router only calls `action` on
// POST/PUT/PATCH/DELETE. The "view" intent is fired by client-side JS after
// the portal has actually rendered (see proof.$token.tsx), never from the
// page's own loader, so a mail-security scanner issuing a bare GET never
// registers a view or touches any of this.
export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "view") {
    const result = await recordProofView(params.token);
    return { ok: result.outcome === "recorded" };
  }

  if (intent === "approve" || intent === "requestChanges") {
    const files: { buffer: Buffer; originalFilename: string }[] = [];
    for (const value of formData.getAll("file")) {
      if (value instanceof File && value.size > 0) {
        files.push({
          buffer: Buffer.from(await value.arrayBuffer()),
          originalFilename: value.name,
        });
      }
    }
    // A simple, honest cap — not a rate limiter, just a sane per-submission
    // bound so a single request can't be used to upload an unbounded number
    // of files.
    if (files.length > 5) {
      return { ok: false, error: "You can attach at most 5 files." };
    }

    const result = await recordCustomerProofResponse({
      rawToken: params.token,
      proofGroupId: formString(formData, "proofGroupId"),
      responseType: intent === "approve" ? "APPROVED" : "CHANGES_REQUESTED",
      customerNote: formStringOrNull(formData, "customerNote"),
      changeCategories: formData.getAll("changeCategory").map(String) as ChangeRequestCategory[],
      acknowledgedApproval: formString(formData, "acknowledgedApproval") === "true",
      idempotencyKey: formString(formData, "idempotencyKey"),
      requestIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      requestUserAgent: request.headers.get("user-agent"),
      files,
    });

    if (result.outcome === "rejected") {
      return { ok: false, error: result.reason };
    }
    return { ok: true, outcome: result.outcome };
  }

  return { ok: false, error: "Unknown action." };
}
