import { Row } from "./Row";

interface FilterGroupProps {
  options: readonly string[] | readonly number[];
  value: string | number | null;
  onChange: (value: string) => void;
  labelFn?: (option: string) => string;
  className?: string;
}

export function FilterGroup({ options, value, onChange, labelFn, className }: FilterGroupProps) {
  return (
    <Row gap={1} className={className}>
      {options.map((opt) => {
        const key = String(opt);
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`filter-btn ${String(value) === key ? "filter-btn-active" : ""}`}
          >
            {labelFn ? labelFn(key) : key}
          </button>
        );
      })}
    </Row>
  );
}
