import { useState, useEffect } from "react";

interface ViewMode {
  value: string;
  label: string;
  icon: "list" | "cards" | "board" | "stream";
}

interface ViewToggleProps {
  modes?: ViewMode[];
  value?: string;
  onChange: (mode: string) => void;
  storageKey?: string;
  className?: string;
}

const ICONS: Record<string, React.ReactNode> = {
  list: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor" />
      <rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" />
      <rect x="1" y="12" width="14" height="2" rx="1" fill="currentColor" />
    </svg>
  ),
  cards: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
    </svg>
  ),
  board: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="6" y="1" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="11" y="1" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  ),
  stream: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="6" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="1" y="5.5" width="10" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="1" y="9" width="8" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="1" y="12.5" width="12" height="1.5" rx="0.75" fill="currentColor" />
    </svg>
  ),
};

const DEFAULT_MODES: ViewMode[] = [
  { value: "list", label: "List view", icon: "list" },
  { value: "cards", label: "Card view", icon: "cards" },
];

export function ViewToggle({
  modes = DEFAULT_MODES,
  value,
  onChange,
  storageKey,
  className = "",
}: ViewToggleProps) {
  const [current, setCurrent] = useState<string>(() => {
    if (value) return value;
    if (storageKey) {
      const stored = localStorage.getItem(`view-toggle:${storageKey}`);
      if (stored && modes.some((m) => m.value === stored)) return stored;
    }
    return modes[0]?.value ?? "list";
  });

  // Sync controlled value
  useEffect(() => {
    if (value && value !== current) setCurrent(value);
  }, [value]);

  const toggle = (next: string) => {
    setCurrent(next);
    onChange(next);
    if (storageKey) {
      localStorage.setItem(`view-toggle:${storageKey}`, next);
    }
  };

  return (
    <div className={`view-toggle ${className}`.trim()} role="group" aria-label="View mode">
      {modes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={`view-toggle-btn ${current === mode.value ? "view-toggle-btn-active" : ""}`}
          onClick={() => toggle(mode.value)}
          aria-label={mode.label}
          aria-pressed={current === mode.value}
          title={mode.label}
        >
          {ICONS[mode.icon]}
        </button>
      ))}
    </div>
  );
}
