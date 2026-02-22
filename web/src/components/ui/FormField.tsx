import type { ReactNode, CSSProperties } from "react";

interface FormFieldProps {
  label: string;
  hint?: string;
  span?: boolean;   // gridColumn: 1 / -1
  children: ReactNode;
  style?: CSSProperties;
}

export function FormField({ label, hint, span, children, style }: FormFieldProps) {
  return (
    <div
      className="settings-field"
      style={{ ...(span ? { gridColumn: "1 / -1" } : {}), ...style }}
    >
      <label>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** A standard 2-column form grid */
export function FormGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="settings-grid" style={style}>
      {children}
    </div>
  );
}
