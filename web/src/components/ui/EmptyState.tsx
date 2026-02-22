import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: string;
  message: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, message, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`ui-empty-state ${className}`.trim()}>
      {icon && <div className="ui-empty-state-icon">{icon}</div>}
      <div>{message}</div>
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
