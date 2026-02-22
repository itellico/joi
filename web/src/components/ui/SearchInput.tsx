import { useState, useEffect, useRef, type ChangeEvent } from "react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  resultCount?: number;
  queryTimeMs?: number;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  debounceMs = 300,
  resultCount,
  queryTimeMs,
  className = "",
}: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isControlled = useRef(false);

  // Sync external value changes
  useEffect(() => {
    if (isControlled.current) {
      isControlled.current = false;
      return;
    }
    setLocal(value);
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocal(next);
    isControlled.current = true;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  };

  const handleClear = () => {
    setLocal("");
    isControlled.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    onChange("");
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className={`search-input-wrap ${className}`.trim()}>
      <svg className="search-input-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="search-input-field"
        autoComplete="off"
      />
      {local && (
        <button
          type="button"
          className="search-input-clear"
          onClick={handleClear}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
      {(resultCount != null || queryTimeMs != null) && (
        <span className="search-input-meta">
          {resultCount != null && <>{resultCount} found</>}
          {resultCount != null && queryTimeMs != null && " · "}
          {queryTimeMs != null && <>{queryTimeMs}ms</>}
        </span>
      )}
    </div>
  );
}
