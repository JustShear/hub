import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useFetcher, useNavigate } from "react-router";
import { Bookmark, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { GenericSavedViewSummary } from "~/domain/saved-views/generic-saved-view.server";

export interface GenericSavedViewsMenuProps {
  savedViews: GenericSavedViewSummary[];
  /** The current URL's search params, verbatim — this is the entire "view" that gets saved. */
  currentParams: Record<string, string>;
  /** The queue's own page path, e.g. "/production" — views are applied by navigating here. */
  basePath: string;
  /** The resource route saved-view intents (createSavedView/updateSavedView/deleteSavedView) post to. */
  actionPath: string;
}

type ViewMutationResponse =
  { ok: true; view: GenericSavedViewSummary } | { ok: false; error: string } | undefined;

// A trimmed, queue-agnostic sibling of ~/components/board/SavedViewsMenu —
// the board's own filters/sort/view shape is too specific to reuse here, so
// this version treats "the view" as an opaque bag of query-string params,
// applied by navigating back to basePath with them restored.
export function GenericSavedViewsMenu({
  savedViews,
  currentParams,
  basePath,
  actionPath,
}: GenericSavedViewsMenuProps) {
  const navigate = useNavigate();
  const deleteFetcher = useFetcher();
  const [editing, setEditing] = useState<GenericSavedViewSummary | null>(null);
  const [creating, setCreating] = useState(false);

  function applyView(view: GenericSavedViewSummary) {
    const params = new URLSearchParams(view.params);
    void navigate(`${basePath}?${params.toString()}`);
  }

  function deleteView(viewId: string) {
    void deleteFetcher.submit(
      { _intent: "deleteSavedView", viewId },
      { method: "post", action: actionPath },
    );
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink hover:bg-surface"
          >
            <Bookmark aria-hidden="true" className="h-4 w-4" />
            Saved views
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-72 rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            {savedViews.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted">No saved views yet.</p>
            ) : (
              savedViews.map((view) => (
                <div
                  key={view.id}
                  className="flex items-center gap-1 rounded-md px-1 hover:bg-page"
                >
                  <DropdownMenu.Item
                    onSelect={() => {
                      applyView(view);
                    }}
                    className="flex-1 cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink outline-none"
                  >
                    {view.isDefault ? (
                      <Star aria-hidden="true" className="mr-1 inline h-3 w-3 text-warning" />
                    ) : null}
                    {view.name}
                  </DropdownMenu.Item>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(view);
                    }}
                    aria-label={`Rename ${view.name}`}
                    className="rounded p-1 text-muted hover:text-ink"
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      deleteView(view.id);
                    }}
                    aria-label={`Delete ${view.name}`}
                    className="rounded p-1 text-muted hover:text-error"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => {
                setCreating(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink outline-none hover:bg-page"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Save current view…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {creating ? (
        <SavedViewFormDialog
          mode="create"
          params={currentParams}
          actionPath={actionPath}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {editing ? (
        <SavedViewFormDialog
          mode="edit"
          viewId={editing.id}
          initialName={editing.name}
          initialIsDefault={editing.isDefault}
          params={editing.params}
          actionPath={actionPath}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function SavedViewFormDialog({
  mode,
  viewId,
  initialName = "",
  initialIsDefault = false,
  params,
  actionPath,
  onClose,
}: {
  mode: "create" | "edit";
  viewId?: string;
  initialName?: string;
  initialIsDefault?: boolean;
  params: Record<string, string>;
  actionPath: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const [name, setName] = useState(initialName);
  const [isDefault, setIsDefault] = useState(initialIsDefault);
  const response = fetcher.data as ViewMutationResponse;

  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      onClose();
    }
    // Only re-run when the fetcher actually settles — including onClose
    // would re-run this every render since it's a fresh closure each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, response]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-full max-w-sm -translate-x-1/2 rounded-lg border border-border bg-surface p-4 shadow-lg">
          <Dialog.Title className="text-sm font-semibold text-ink">
            {mode === "create" ? "Save current view" : "Rename saved view"}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Saved view name and default setting
          </Dialog.Description>
          <fetcher.Form method="post" action={actionPath} className="mt-3 flex flex-col gap-3">
            <input
              type="hidden"
              name="_intent"
              value={mode === "create" ? "createSavedView" : "updateSavedView"}
            />
            {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
            <input type="hidden" name="params" value={JSON.stringify(params)} />
            <label className="flex flex-col gap-1 text-sm text-ink">
              Name
              <input
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                required
                className="rounded border border-border px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                name="isDefault"
                value="1"
                checked={isDefault}
                onChange={(e) => {
                  setIsDefault(e.target.checked);
                }}
                className="h-4 w-4 rounded border-border"
              />
              Make this my default view
            </label>
            {response && !response.ok ? (
              <p role="alert" className="text-sm text-error">
                {response.error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:bg-page"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white"
              >
                Save
              </button>
            </div>
          </fetcher.Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
