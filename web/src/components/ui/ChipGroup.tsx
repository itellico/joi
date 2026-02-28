interface ChipOption {
  value: string;
  label: string;
  count?: number;
  metric?: number;
}

interface ChipGroupProps {
  options: ChipOption[];
  value: string;
  onChange: (value: string) => void;
  variant?: "pill" | "stat";
  className?: string;
}

export function ChipGroup({ options, value, onChange, variant = "pill", className }: ChipGroupProps) {
  if (variant === "stat") {
    return (
      <div className={`pill-group pill-group--stats ${className ?? ""}`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`pill pill--stat stat-chip ${value === opt.value ? "is-active stat-chip-active" : ""} cursor-pointer`}
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
          >
            <span className="pill-label stat-chip-label">{opt.label}</span>
            <span className="pill-value stat-chip-value">{opt.count ?? opt.metric ?? 0}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`pill-group pill-group--chips crm-status-chips ${className ?? ""}`}>
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          className={`pill pill--filter crm-chip ${value === opt.value ? "is-active crm-chip-active" : ""}`}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {opt.label}
          {opt.count != null && <span className="pill-count crm-chip-count">{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}
