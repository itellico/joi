type HealthStatus = "green" | "orange" | "red";

interface SidebarHealthRowProps {
  label: string;
  status?: HealthStatus;
  detail?: string;
  onRestart?: () => void;
  restarting?: boolean;
  onClick?: () => void;
}

export function SidebarHealthRow({
  label,
  status = "red",
  detail,
  onRestart,
  restarting = false,
  onClick,
}: SidebarHealthRowProps) {
  const clickable = Boolean(onClick);

  return (
    <div className={`sidebar-health-row${clickable ? " sidebar-health-clickable" : ""}`} onClick={onClick}>
      <span className={`sidebar-health-dot ${status}`} />
      <span>{label}</span>
      {detail && <span className="sidebar-health-detail" title={detail}>{detail}</span>}
      {onRestart && (
        <button
          type="button"
          className={`sidebar-health-restart${restarting ? " spinning" : ""}`}
          title={`Restart ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onRestart();
          }}
        >
          ↻
        </button>
      )}
    </div>
  );
}
