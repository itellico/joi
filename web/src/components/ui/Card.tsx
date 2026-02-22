import type { CSSProperties, ReactNode, HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional left-border accent color */
  accent?: string;
  /** Reduce opacity (for disabled states) */
  dimmed?: boolean;
  children: ReactNode;
}

export function Card({ accent, dimmed, children, className = "", style, ...props }: CardProps) {
  const cls = `card${dimmed ? " card-dimmed" : ""} ${className}`.trim();
  const accentStyle: CSSProperties | undefined = accent
    ? { borderLeft: `3px solid ${accent}`, ...style }
    : style;

  return (
    <div className={cls} style={accentStyle} {...props}>
      {children}
    </div>
  );
}

export function CardGrid({ children, minWidth = 260, className = "", style, ...props }: {
  children: ReactNode;
  minWidth?: number;
  className?: string;
  style?: CSSProperties;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`card-grid ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, ...style }}
      {...props}
    >
      {children}
    </div>
  );
}
