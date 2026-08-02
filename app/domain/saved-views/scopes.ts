// SavedView.scope values for the non-board queues — shared between each
// queue's route (loader) and action route so they always agree on which
// partition of the SavedView table they're reading/writing.
export const PRODUCTION_SAVED_VIEW_SCOPE = "production";
export const WAREHOUSE_SAVED_VIEW_SCOPE = "warehouse";
export const EXCEPTIONS_SAVED_VIEW_SCOPE = "exceptions";
