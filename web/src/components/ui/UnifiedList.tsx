import { useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";

type SortDirection = "asc" | "desc";
type SortableValue = string | number | boolean | Date | null | undefined;

export interface UnifiedListColumn<T> {
  key: string;
  header: ReactNode;
  render: (item: T) => ReactNode;
  sortValue?: (item: T) => SortableValue;
  width?: string | number;
  align?: "left" | "center" | "right";
  className?: string;
}

interface UnifiedListProps<T> {
  items: T[];
  columns: UnifiedListColumn<T>[];
  rowKey: (item: T) => string;
  emptyMessage?: string;
  className?: string;
  rowClassName?: (item: T) => string;
  toolbar?: ReactNode;
  onRowClick?: (item: T) => void;
  tableAriaLabel?: string;
  defaultSort?: { key: string; direction?: SortDirection };
}

function compareSortValues(a: SortableValue, b: SortableValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const aValue = a instanceof Date ? a.getTime() : a;
  const bValue = b instanceof Date ? b.getTime() : b;

  if (typeof aValue === "number" && typeof bValue === "number") {
    return aValue - bValue;
  }
  if (typeof aValue === "boolean" && typeof bValue === "boolean") {
    return Number(aValue) - Number(bValue);
  }

  return String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
}

export function UnifiedList<T>({
  items,
  columns,
  rowKey,
  emptyMessage = "No items found",
  className = "",
  rowClassName,
  toolbar,
  onRowClick,
  tableAriaLabel = "List",
  defaultSort,
}: UnifiedListProps<T>) {
  const initialSortable = defaultSort?.key || columns.find((col) => col.sortValue)?.key || null;
  const [sortKey, setSortKey] = useState<string | null>(initialSortable);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSort?.direction || "desc");

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
    const sortColumn = columns.find((col) => col.key === sortKey && col.sortValue);
    if (!sortColumn?.sortValue) return items;

    const mapped = items.map((item, index) => ({
      item,
      index,
      value: sortColumn.sortValue?.(item),
    }));

    mapped.sort((left, right) => {
      const result = compareSortValues(left.value, right.value);
      if (result !== 0) {
        return sortDirection === "asc" ? result : -result;
      }
      return left.index - right.index;
    });

    return mapped.map((entry) => entry.item);
  }, [columns, items, sortDirection, sortKey]);

  const handleSort = (key: string) => {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("desc");
      return key;
    });
  };

  return (
    <div className={`unified-list ${className}`.trim()}>
      {toolbar && <div className="unified-list-toolbar">{toolbar}</div>}

      {sortedItems.length === 0 ? (
        <EmptyState message={emptyMessage} className="unified-list-empty" />
      ) : (
        <div className="unified-list-table-wrap">
          <table className="unified-list-table" aria-label={tableAriaLabel}>
            <thead>
              <tr>
                {columns.map((column) => {
                  const active = column.key === sortKey;
                  return (
                    <th
                      key={column.key}
                      style={{
                        ...(column.align ? { textAlign: column.align } : {}),
                        ...(column.width ? { width: column.width } : {}),
                      }}
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          className={`unified-list-sort-btn${active ? " unified-list-sort-btn-active" : ""}`}
                          onClick={() => handleSort(column.key)}
                          aria-label={`Sort by ${typeof column.header === "string" ? column.header : column.key}`}
                        >
                          <span>{column.header}</span>
                          <span className="unified-list-sort-indicator" aria-hidden="true">
                            {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                          </span>
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => {
                const interactive = Boolean(onRowClick);
                const rowClasses = [
                  interactive ? "unified-list-row-clickable" : "",
                  rowClassName ? rowClassName(item) : "",
                ].filter(Boolean).join(" ");

                return (
                  <tr
                    key={rowKey(item)}
                    className={rowClasses || undefined}
                    onClick={interactive ? () => onRowClick?.(item) : undefined}
                    onKeyDown={interactive ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick?.(item);
                      }
                    } : undefined}
                    tabIndex={interactive ? 0 : undefined}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.className}
                        style={column.align ? { textAlign: column.align } : undefined}
                      >
                        {column.render(item)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
