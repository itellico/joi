import type { CSSProperties } from "react";

interface StatusDotProps {
  status: "ok" | "error" | "running" | "warning" | "muted";
  size?: number;
  pulse?: boolean;
  className?: string;
  /** Only for dynamic colors (e.g., provider-specific) */
  style?: CSSProperties;
}

export function StatusDot({ status, size, pulse, className = "", style }: StatusDotProps) {
  const cls = `ui-dot ui-dot-${status}${pulse ? " ui-dot-pulse" : ""} ${className}`.trim();
  const sizeStyle = size && size !== 8 ? { width: size, height: size, ...style } : style;

  return <span className={cls} style={sizeStyle} />;
}
