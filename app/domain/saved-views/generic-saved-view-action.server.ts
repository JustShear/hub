import { formString } from "~/lib/form-data";
import {
  createGenericSavedView,
  deleteGenericSavedView,
  updateGenericSavedView,
  type GenericSavedViewSummary,
} from "~/domain/saved-views/generic-saved-view.server";

export type GenericSavedViewActionResult =
  | { intent: string; ok: true; view: GenericSavedViewSummary }
  | { intent: string; ok: true }
  | { intent: string; ok: false; error: string };

/**
 * Shared createSavedView/updateSavedView/deleteSavedView intent handling for
 * every non-board queue's action route (Production, Warehouse, Exceptions) —
 * each route's own action() calls this after its own intents fall through,
 * passing its own scope constant. Returns null when the intent isn't one of
 * these three, so the caller can fall through to its "unknown intent" case.
 */
export async function handleGenericSavedViewAction(input: {
  intent: FormDataEntryValue | null;
  formData: FormData;
  staffUserId: string;
  shopId: string;
  scope: string;
}): Promise<GenericSavedViewActionResult | null> {
  const { intent, formData, staffUserId, shopId, scope } = input;

  if (intent === "createSavedView" || intent === "updateSavedView") {
    const name = formString(formData, "name").trim();
    const isDefault = formData.get("isDefault") === "1";
    const paramsRaw = formString(formData, "params") || "{}";
    let params: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(paramsRaw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      params = parsed as Record<string, string>;
    } catch {
      return { intent, ok: false, error: "That saved view's settings couldn't be read." };
    }
    if (!name) {
      return { intent, ok: false, error: "A view name is required." };
    }

    if (intent === "createSavedView") {
      const view = await createGenericSavedView({
        staffUserId,
        shopId,
        scope,
        name,
        params,
        isDefault,
      });
      return { intent, ok: true, view };
    }

    const viewId = formString(formData, "viewId");
    const result = await updateGenericSavedView({
      staffUserId,
      shopId,
      viewId,
      name,
      params,
      isDefault,
    });
    if (result.outcome !== "updated") {
      return {
        intent,
        ok: false,
        error:
          result.outcome === "forbidden"
            ? "You can't edit another staff member's saved view."
            : "Saved view not found.",
      };
    }
    return { intent, ok: true, view: result.view };
  }

  if (intent === "deleteSavedView") {
    const viewId = formString(formData, "viewId");
    const result = await deleteGenericSavedView({ staffUserId, shopId, viewId });
    if (result.outcome !== "deleted") {
      return {
        intent,
        ok: false,
        error:
          result.outcome === "forbidden"
            ? "You can't delete another staff member's saved view."
            : "Saved view not found.",
      };
    }
    return { intent, ok: true };
  }

  return null;
}
