import { useEffect, useRef, useState, useCallback } from "react";
import { useDebug } from "../hooks/useDebug";

export default function DebugPanel() {
  const { enabled, log, clear } = useDebug();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  const copyLog = useCallback(async () => {
    if (log.length === 0) return;
    const text = log
      .map((e) => `[${e.time}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [log]);

  if (!enabled) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <span className="debug-panel-title">Debug</span>
        <span className="debug-panel-count">{log.length}</span>
        <button className="debug-panel-copy" onClick={copyLog}>
          {copied ? "Copied!" : "Copy"}
        </button>
        <button className="debug-panel-clear" onClick={clear}>
          Clear
        </button>
      </div>
      <div className="debug-panel-log" ref={scrollRef}>
        {log.length === 0 && (
          <div className="debug-panel-empty">No debug output yet</div>
        )}
        {log.map((entry, i) => (
          <div key={i} className={`debug-entry debug-entry--${entry.level}`}>
            <span className="debug-entry-time">{entry.time}</span>
            <span className="debug-entry-source">{entry.source}</span>
            <span className="debug-entry-msg">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
