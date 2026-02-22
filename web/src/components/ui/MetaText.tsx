import type { ReactNode, HTMLAttributes } from "react";

interface MetaTextProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "xs" | "sm";
  children: ReactNode;
}

export function MetaText({ size = "sm", children, className = "", ...props }: MetaTextProps) {
  const cls = size === "xs" ? "ui-meta-xs" : "ui-meta";
  return (
    <span className={`${cls} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}

/** Section header label (e.g., "Recent Runs", "Disabled (3)") */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`ui-section-label ${className}`.trim()}>
      {children}
    </div>
  );
}
