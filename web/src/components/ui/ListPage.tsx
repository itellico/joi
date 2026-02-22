import { useState, useMemo, type ReactNode } from "react";
import { CardGrid } from "./Card";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";
import { SearchInput } from "./SearchInput";
import { UnifiedList, type UnifiedListColumn } from "./UnifiedList";
import { ViewToggle } from "./ViewToggle";

type ViewMode = "list" | "cards";

interface ListPageProps<T> {
  items: T[];
  columns: UnifiedListColumn<T>[];
  renderCard: (item: T) => ReactNode;
  rowKey: (item: T) => string;

  // Search
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchFilter?: (item: T, query: string) => boolean;

  // View mode
  defaultView?: ViewMode;
  viewStorageKey?: string;
  viewMode?: ViewMode;
  onViewChange?: (mode: ViewMode) => void;

  // Pagination
  pageSize?: number;
  /** Server-side pagination: if set, disables client-side pagination */
  serverPagination?: {
    total: number;
    offset: number;
    onOffsetChange: (offset: number) => void;
  };

  // List props
  defaultSort?: { key: string; direction: "asc" | "desc" };
  onRowClick?: (item: T) => void;
  tableAriaLabel?: string;
  rowClassName?: (item: T) => string;

  // Card props
  cardMinWidth?: number;

  // Slots
  filters?: ReactNode;
  toolbar?: ReactNode;
  emptyMessage?: string;
  emptyIcon?: string;
  className?: string;
}

export function ListPage<T>({
  items,
  columns,
  renderCard,
  rowKey,
  searchPlaceholder = "Search…",
  searchValue,
  onSearchChange,
  searchFilter,
  defaultView = "list",
  viewStorageKey,
  viewMode: controlledView,
  onViewChange,
  pageSize = 50,
  serverPagination,
  defaultSort,
  onRowClick,
  tableAriaLabel,
  rowClassName,
  cardMinWidth,
  filters,
  toolbar,
  emptyMessage = "No items found.",
  emptyIcon,
  className = "",
}: ListPageProps<T>) {
  // Internal search state (only used when not controlled externally)
  const [internalSearch, setInternalSearch] = useState("");
  const searchQ = searchValue ?? internalSearch;
  const setSearchQ = onSearchChange ?? setInternalSearch;

  // View mode
  const [internalView, setInternalView] = useState<ViewMode>(defaultView);
  const view = controlledView ?? internalView;
  const setView = onViewChange ?? setInternalView;

  // Client-side pagination offset
  const [clientOffset, setClientOffset] = useState(0);

  // Client-side search filtering
  const filtered = useMemo(() => {
    const query = searchQ.trim().toLowerCase();
    if (!query || !searchFilter) return items;
    return items.filter((item) => searchFilter(item, query));
  }, [items, searchQ, searchFilter]);

  // Reset pagination when search changes
  useMemo(() => {
    setClientOffset(0);
  }, [searchQ]);

  // Client-side paginated slice
  const useClientPaging = !serverPagination && pageSize > 0;
  const displayItems = useMemo(() => {
    if (!useClientPaging) return filtered;
    return filtered.slice(clientOffset, clientOffset + pageSize);
  }, [filtered, useClientPaging, clientOffset, pageSize]);

  const totalForPagination = serverPagination?.total ?? filtered.length;

  return (
    <div className={`list-page ${className}`.trim()}>
      {/* Toolbar row: search + toggle + extra toolbar items */}
      <div className="list-page-toolbar">
        <SearchInput
          value={searchQ}
          onChange={setSearchQ}
          placeholder={searchPlaceholder}
          resultCount={searchQ.trim() ? filtered.length : undefined}
          className="list-page-search"
        />
        <div className="list-page-toolbar-right">
          {toolbar}
          <ViewToggle
            value={view}
            onChange={(m) => setView(m as ViewMode)}
            storageKey={viewStorageKey}
          />
        </div>
      </div>

      {/* Optional filters slot */}
      {filters && <div className="list-page-filters">{filters}</div>}

      {/* Content */}
      {displayItems.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          message={searchQ.trim() ? `No results for "${searchQ.trim()}"` : emptyMessage}
        />
      ) : view === "list" ? (
        <UnifiedList
          items={displayItems}
          columns={columns}
          rowKey={rowKey}
          onRowClick={onRowClick}
          defaultSort={defaultSort}
          tableAriaLabel={tableAriaLabel}
          rowClassName={rowClassName}
          emptyMessage={emptyMessage}
        />
      ) : (
        <CardGrid minWidth={cardMinWidth}>
          {displayItems.map((item) => (
            <div key={rowKey(item)}>{renderCard(item)}</div>
          ))}
        </CardGrid>
      )}

      {/* Pagination */}
      {serverPagination ? (
        <Pagination
          total={serverPagination.total}
          pageSize={pageSize}
          offset={serverPagination.offset}
          onOffsetChange={serverPagination.onOffsetChange}
        />
      ) : useClientPaging && totalForPagination > pageSize ? (
        <Pagination
          total={totalForPagination}
          pageSize={pageSize}
          offset={clientOffset}
          onOffsetChange={setClientOffset}
        />
      ) : null}
    </div>
  );
}
