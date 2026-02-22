import { useState, useEffect } from "react";

type ViewMode = "list" | "cards";

interface ViewToggleProps {
  value?: ViewMode;
  onChange: (mode: ViewMode) => void;
  storageKey?: string;
  className?: string;
}

export function ViewToggle({
  value,
  onChange,
  storageKey,
  className = "",
}: ViewToggleProps) {
  const [mode, setMode] = useState<ViewMode>(() => {
    if (value) return value;
    if (storageKey) {
      const stored = localStorage.getItem(`view-toggle:${storageKey}`);
      if (stored === "list" || stored === "cards") return stored;
    }
    return "list";
  });

  // Sync controlled value
  useEffect(() => {
    if (value && value !== mode) setMode(value);
  }, [value]);

  const toggle = (next: ViewMode) => {
    setMode(next);
    onChange(next);
    if (storageKey) {
      localStorage.setItem(`view-toggle:${storageKey}`, next);
    }
  };

  return (
    <div className={`view-toggle ${className}`.trim()} role="group" aria-label="View mode">
      <button
        type="button"
        className={`view-toggle-btn ${mode === "list" ? "view-toggle-btn-active" : ""}`}
        onClick={() => toggle("list")}
        aria-label="List view"
        aria-pressed={mode === "list"}
        title="List view"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor" />
          <rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" />
          <rect x="1" y="12" width="14" height="2" rx="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={`view-toggle-btn ${mode === "cards" ? "view-toggle-btn-active" : ""}`}
        onClick={() => toggle("cards")}
        aria-label="Card view"
        aria-pressed={mode === "cards"}
        title="Card view"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" />
          <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" />
          <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
