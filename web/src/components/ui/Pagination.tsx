import { Button } from "./Button";
import { MetaText } from "./MetaText";

interface PaginationProps {
  total: number;
  pageSize: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  className?: string;
}

export function Pagination({
  total,
  pageSize,
  offset,
  onOffsetChange,
  className = "",
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;

  if (totalPages <= 1) return null;

  return (
    <div className={`ui-pagination ${className}`.trim()}>
      <Button
        size="sm"
        disabled={offset === 0}
        onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
      >
        ← Previous
      </Button>
      <MetaText size="sm" className="text-secondary">
        Page {currentPage} of {totalPages}
      </MetaText>
      <Button
        size="sm"
        disabled={offset + pageSize >= total}
        onClick={() => onOffsetChange(offset + pageSize)}
      >
        Next →
      </Button>
    </div>
  );
}
