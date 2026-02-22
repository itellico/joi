import { useCallback, useSyncExternalStore } from "react";

interface DebugEntry {
  time: string;
  source: string;
  message: string;
  level: "info" | "warn" | "error";
}

const MAX_ENTRIES = 200;

let entries: DebugEntry[] = [];
let listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function getSnapshot() {
  return entries;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Add a debug entry from anywhere */
export function debugLog(source: string, message: string, level: "info" | "warn" | "error" = "info") {
  const time = new Date().toLocaleTimeString("en", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { time, source, message, level }];
  emit();
}

/** Clear all entries */
export function debugClear() {
  entries = [];
  emit();
}

/** Read debug enabled from localStorage */
function isEnabled(): boolean {
  try {
    return localStorage.getItem("joi-debug") === "true";
  } catch {
    return false;
  }
}

let debugEnabled = isEnabled();
let enabledListeners = new Set<() => void>();

function getEnabledSnapshot() {
  return debugEnabled;
}

function subscribeEnabled(listener: () => void) {
  enabledListeners.add(listener);
  return () => enabledListeners.delete(listener);
}

export function useDebug() {
  const enabled = useSyncExternalStore(subscribeEnabled, getEnabledSnapshot);
  const log = useSyncExternalStore(subscribe, getSnapshot);

  const toggle = useCallback(() => {
    debugEnabled = !debugEnabled;
    try {
      localStorage.setItem("joi-debug", String(debugEnabled));
    } catch {}
    for (const l of enabledListeners) l();
  }, []);

  return { enabled, log, toggle, clear: debugClear };
}
