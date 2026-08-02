import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useFetcher, useNavigate } from "react-router";
import { Bookmark, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { SavedViewSummary } from "~/domain/orders/saved-views.server";
import {
  boardFiltersToSearchParams,
  type BoardFilters,
  type BoardSort,
  type BoardView,
  type SavedViewConfig,
} from "~/domain/orders/board-filters";

export interface SavedViewsMenuProps {
  savedViews: SavedViewSummary[];
  currentFilters: BoardFilters;
  currentSort: BoardSort;
  currentView: BoardView;
  currentVisibleColumns: string[] | undefined;
}

type ViewMutationResponse =
  { ok: true; view: SavedViewSummary } | { ok: false; error: string } | undefined;

// Views are staff-specific: this component only ever shows/edits the
// current staff member's own views (the loader already scopes
// listSavedViews to staffUserId, and the action re-checks ownership too).
export function SavedViewsMenu({
  savedViews,
  currentFilters,
  currentSort,
  currentView,
  currentVisibleColumns,
}: SavedViewsMenuProps) {
  const navigate = useNavigate();
  const deleteFetcher = useFetcher();
  const [editing, setEditing] = useState<SavedViewSummary | null>(null);
  const [creating, setCreating] = useState(false);

  function applyView(view: SavedViewSummary) {
    const params = boardFiltersToSearchParams(
      view.config.filters,
      view.config.sort,
      view.config.view,
      view.config.visibleColumns,
    );
    void navigate(`/orders?${params.toString()}`);
  }

  function deleteView(viewId: string) {
    void deleteFetcher.submit({ _intent: "deleteView", viewId }, { method: "post" });
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
          config={{
            filters: currentFilters,
            sort: currentSort,
            view: currentView,
            visibleColumns: currentVisibleColumns,
            density: "comfortable",
          }}
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
          config={editing.config}
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
  config,
  onClose,
}: {
  mode: "create" | "edit";
  viewId?: string;
  initialName?: string;
  initialIsDefault?: boolean;
  config: SavedViewConfig;
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
          <fetcher.Form method="post" className="mt-3 flex flex-col gap-3">
            <input
              type="hidden"
              name="_intent"
              value={mode === "create" ? "createView" : "updateView"}
            />
            {viewId ? <input type="hidden" name="viewId" value={viewId} /> : null}
            <input type="hidden" name="config" value={JSON.stringify(config)} />
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
