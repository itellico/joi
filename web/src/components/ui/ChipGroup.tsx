import { Row } from "./Row";

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
      <Row gap={2} wrap className={className}>
        {options.map((opt) => (
          <div
            key={opt.value}
            className={`stat-chip ${value === opt.value ? "stat-chip-active" : ""} cursor-pointer`}
            onClick={() => onChange(opt.value)}
          >
            <span className="stat-chip-label">{opt.label}</span>
            <span className="stat-chip-value">{opt.count ?? opt.metric ?? 0}</span>
          </div>
        ))}
      </Row>
    );
  }

  return (
    <div className={`crm-status-chips ${className ?? ""}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`crm-chip ${value === opt.value ? "crm-chip-active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
          {opt.count != null && <span className="crm-chip-count">{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}
