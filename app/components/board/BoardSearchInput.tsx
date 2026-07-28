import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useSearchParams } from "react-router";
import {
  boardFiltersToSearchParams,
  type BoardFilters,
  type BoardSort,
  type BoardView,
} from "~/domain/orders/board-filters";

const DEBOUNCE_MS = 300;

export interface BoardSearchInputProps {
  filters: BoardFilters;
  sort: BoardSort;
  view: BoardView;
}

// Board-level search across whatever the current filters already match —
// not the full global search promised for a later milestone. Debounced so
// typing doesn't trigger a navigation per keystroke.
export function BoardSearchInput({ filters, sort, view }: BoardSearchInputProps) {
  const [, setSearchParams] = useSearchParams();

  // Adjust local state during render when the prop actually changes (e.g. a
  // saved view was applied) — React's documented pattern for this, rather
  // than an effect that mirrors a prop into state one render late.
  const [prevSearch, setPrevSearch] = useState(filters.search);
  const [value, setValue] = useState(filters.search);
  if (filters.search !== prevSearch) {
    setPrevSearch(filters.search);
    setValue(filters.search);
  }

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setSearchParams(boardFiltersToSearchParams({ ...filters, search: next }, sort, view), {
        replace: true,
      });
    }, DEBOUNCE_MS);
  }

  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-page px-3 text-sm text-ink">
      <Search aria-hidden="true" className="h-4 w-4 text-muted" />
      <span className="sr-only">Search orders</span>
      <input
        type="search"
        value={value}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        placeholder="Order #, customer, product, SKU, tag…"
        className="w-64 bg-transparent focus:outline-none"
      />
    </label>
  );
}
