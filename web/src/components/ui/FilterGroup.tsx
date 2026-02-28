interface FilterGroupProps {
  options: readonly string[] | readonly number[];
  value: string | number | null;
  onChange: (value: string) => void;
  labelFn?: (option: string) => string;
  className?: string;
}

export function FilterGroup({ options, value, onChange, labelFn, className }: FilterGroupProps) {
  return (
    <div className={`pill-group pill-group--filter ${className ?? ""}`}>
      {options.map((opt) => {
        const key = String(opt);
        const active = String(value) === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`pill pill--filter filter-btn ${active ? "is-active filter-btn-active" : ""}`}
            aria-pressed={active}
          >
            {labelFn ? labelFn(key) : key}
          </button>
        );
      })}
    </div>
  );
}
