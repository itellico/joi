import type { ReactNode, CSSProperties } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

interface PageBodyProps {
  children: ReactNode;
  gap?: number;
  style?: CSSProperties;
  className?: string;
}

export function PageBody({ children, gap = 12, style, className = "" }: PageBodyProps) {
  return (
    <div
      className={`page-body ${className}`.trim()}
      style={{ gap, ...style }}
    >
      {children}
    </div>
  );
}
