import type { ReactNode, CSSProperties } from "react";
import JoiOrb from "../JoiOrb";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  showOrb?: boolean;
}

export function PageHeader({ title, subtitle, actions, showOrb = true }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="mt-1">{subtitle}</p>}
      </div>
      {(actions || showOrb) && (
        <div className="page-header-actions">
          {actions}
          {showOrb && (
            <JoiOrb
              className="page-header-orb"
              size={30}
              active
              intensity={0.3}
              variant="firestorm"
              rings={3}
              animated
              ariaLabel="JOI"
            />
          )}
        </div>
      )}
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
