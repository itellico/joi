import type { ReactNode, HTMLAttributes } from "react";

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: number;
  children: ReactNode;
}

export function Stack({ gap = 3, children, className = "", style, ...props }: StackProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: `var(--space-${gap})`,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
