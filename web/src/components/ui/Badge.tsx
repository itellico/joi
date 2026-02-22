import type { ReactNode } from "react";

type BadgeStatus = "success" | "warning" | "error" | "accent" | "info" | "muted";

interface BadgeProps {
  status?: BadgeStatus;
  children: ReactNode;
  className?: string;
}

const statusClasses: Record<BadgeStatus, string> = {
  success: "badge badge-success",
  warning: "badge badge-warning",
  error: "badge badge-error",
  accent: "badge badge-accent",
  info: "badge badge-info",
  muted: "badge badge-muted",
};

export function Badge({ status = "muted", children, className = "" }: BadgeProps) {
  return (
    <span className={`${statusClasses[status]} ${className}`.trim()}>
      {children}
    </span>
  );
}
