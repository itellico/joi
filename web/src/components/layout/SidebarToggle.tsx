interface SidebarToggleProps {
  label: string;
  active: boolean;
  onToggle: () => void;
}

export function SidebarToggle({ label, active, onToggle }: SidebarToggleProps) {
  return (
    <button type="button" className="sidebar-toggle" onClick={onToggle}>
      <span className={`sidebar-toggle-track${active ? " is-on" : ""}`}>
        <span className="sidebar-toggle-thumb" />
      </span>
      <span className={`sidebar-toggle-label${active ? " is-on" : ""}`}>{label}</span>
    </button>
  );
}
