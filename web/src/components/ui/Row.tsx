import type { ReactNode, HTMLAttributes } from "react";

interface RowProps extends HTMLAttributes<HTMLDivElement> {
  gap?: number;
  justify?: "between" | "end" | "center" | "start";
  align?: "start" | "center" | "baseline" | "end";
  wrap?: boolean;
  children: ReactNode;
}

const justifyMap = {
  between: "space-between",
  end: "flex-end",
  center: "center",
  start: "flex-start",
} as const;

const alignMap = {
  start: "flex-start",
  center: "center",
  baseline: "baseline",
  end: "flex-end",
} as const;

export function Row({ gap = 2, justify, align = "center", wrap, children, className = "", style, ...props }: RowProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: alignMap[align],
        gap: `var(--space-${gap})`,
        ...(justify ? { justifyContent: justifyMap[justify] } : {}),
        ...(wrap ? { flexWrap: "wrap" } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
