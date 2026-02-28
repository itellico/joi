import { useState } from "react";
import type { ReactNode } from "react";

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function SidebarSection({ label, children, defaultOpen = true }: SidebarSectionProps) {
  const storageKey = `sidebar-section:${label}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === "1" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // Ignore storage write failures.
    }
  };

  return (
    <>
      <div className="sidebar-section" onClick={toggle}>
        <span className={`sidebar-section-chevron${open ? " is-open" : ""}`}>›</span>
        {label}
      </div>
      {open && children}
    </>
  );
}
