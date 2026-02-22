import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, PageHeader, PageBody, Button, EmptyState, FilterGroup, MetaText, Pagination, Row, UnifiedList, type UnifiedListColumn } from "../components/ui";

interface LogEntry {
  id: number;
  level: string;
  source: string;
  message: string;
  metadata: unknown;
  created_at: string;
}

type Level = "all" | "debug" | "info" | "warn" | "error";
type Source = "all" | "gateway" | "agent" | "cron" | "knowledge" | "obsidian" | "outline" | "pty" | "autolearn" | "access";
const LEVEL_OPTIONS: readonly Level[] = ["all", "debug", "info", "warn", "error"];
const SOURCE_OPTIONS: readonly Source[] = ["all", "gateway", "agent", "cron", "knowledge", "obsidian", "outline", "pty", "autolearn", "access"];
const VIEW_OPTIONS = ["list", "stream"] as const;

function isLevel(value: string | null): value is Level {
  return value !== null && (LEVEL_OPTIONS as readonly string[]).includes(value);
}

function isSource(value: string | null): value is Source {
  return value !== null && (SOURCE_OPTIONS as readonly string[]).includes(value);
}

function isView(value: string | null): value is "list" | "stream" {
  return value === "list" || value === "stream";
}

export default function Logs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<Level>(() => {
    const value = searchParams.get("level");
    return isLevel(value) ? value : "all";
  });
  const [source, setSource] = useState<Source>(() => {
    const value = searchParams.get("source");
    return isSource(value) ? value : "all";
  });
  const [viewMode, setViewMode] = useState<"list" | "stream">(() => {
    const value = searchParams.get("view");
    return isView(value) ? value : "list";
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [logOffset, setLogOffset] = useState(0);
  const LOG_PAGE_SIZE = 50;
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (level !== "all") params.set("level", level);
      if (source !== "all") params.set("source", source);
      params.set("limit", "200");
      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      setLogs((data.logs || []).reverse()); // oldest first
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  }, [level, source]);

  useEffect(() => {
    fetchLogs();
    // Poll every 3 seconds
    pollRef.current = setInterval(fetchLogs, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && viewMode === "stream") {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, viewMode]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (level === "all") next.delete("level");
    else next.set("level", level);

    if (source === "all") next.delete("source");
    else next.set("source", source);

    if (viewMode === "list") next.delete("view");
    else next.set("view", viewMode);

    const query = searchQuery.trim();
    if (!query) next.delete("q");
    else next.set("q", query);

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [level, searchParams, searchQuery, setSearchParams, source, viewMode]);

  const handleClear = async () => {
    await fetch("/api/logs", { method: "DELETE" });
    fetchLogs();
  };

  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((entry) => (
      entry.message.toLowerCase().includes(query)
      || entry.source.toLowerCase().includes(query)
      || entry.level.toLowerCase().includes(query)
    ));
  }, [logs, searchQuery]);

  // Reset page when filters change
  useMemo(() => { setLogOffset(0); }, [searchQuery, level, source]);

  const paginatedLogs = useMemo(
    () => filteredLogs.slice(logOffset, logOffset + LOG_PAGE_SIZE),
    [filteredLogs, logOffset],
  );

  const listColumns: UnifiedListColumn<LogEntry>[] = [
    {
      key: "created_at",
      header: "Time",
      render: (entry) => (
        <MetaText size="xs">{new Date(entry.created_at).toLocaleTimeString()}</MetaText>
      ),
      sortValue: (entry) => new Date(entry.created_at),
      width: 100,
    },
    {
      key: "level",
      header: "Level",
      render: (entry) => (
        <Badge status={badgeLevel(entry.level)} className="text-xs">{entry.level.toUpperCase()}</Badge>
      ),
      sortValue: (entry) => entry.level,
      width: 92,
    },
    {
      key: "source",
      header: "Source",
      render: (entry) => (
        <span className="text-accent text-sm">{entry.source}</span>
      ),
      sortValue: (entry) => entry.source,
      width: 120,
    },
    {
      key: "message",
      header: "Message",
      render: (entry) => entry.message,
      sortValue: (entry) => entry.message,
      className: "unified-list-cell-break",
    },
  ];

  return (
    <>
      <PageHeader
        title="Logs"
        actions={
          <>
            {viewMode === "stream" && (
              <label className="logs-autoscroll-label">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Auto-scroll
              </label>
            )}
            <Button variant="danger" size="sm" onClick={handleClear}>
              Clear
            </Button>
          </>
        }
      />

      <PageBody gap={12} className="logs-page-body">
        {/* Filters */}
        <Row gap={3} className="flex-shrink-0">
          <FilterGroup
            options={VIEW_OPTIONS}
            value={viewMode}
            onChange={(v) => setViewMode(v as "list" | "stream")}
            labelFn={(v) => v === "list" ? "List View" : "Stream View"}
          />
          <FilterGroup
            options={LEVEL_OPTIONS}
            value={level}
            onChange={(v) => setLevel(v as Level)}
            labelFn={(l) => l === "all" ? "All Levels" : l}
          />
          <FilterGroup
            options={SOURCE_OPTIONS}
            value={source}
            onChange={(v) => setSource(v as Source)}
            labelFn={(s) => s === "all" ? "All Sources" : s}
          />
          <input
            type="text"
            name="log_search"
            aria-label="Search logs"
            autoComplete="off"
            placeholder="Search logs…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="knowledge-search-input"
          />
        </Row>

        {/* Log viewer */}
        {loading ? (
          <div className="logs-viewer">
            <MetaText className="block p-4">Loading…</MetaText>
          </div>
        ) : viewMode === "stream" ? (
          <div className="logs-viewer">
            {filteredLogs.length === 0 ? (
              <EmptyState message="No logs matching filters." />
            ) : (
              filteredLogs.map((entry) => (
                <div
                  key={entry.id}
                  className={`logs-entry${entry.level === "error" ? " logs-entry-error" : ""}`}
                  style={{ borderLeft: `3px solid ${levelColor(entry.level)}` }}
                >
                  <span className="logs-time">
                    {new Date(entry.created_at).toLocaleTimeString()}
                  </span>
                  <span className="logs-level" style={{ color: levelColor(entry.level) }}>
                    {entry.level.toUpperCase().padEnd(5)}
                  </span>
                  <span className="logs-source">
                    [{entry.source}]
                  </span>
                  <span className="logs-message">
                    {entry.message}
                  </span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        ) : (
          <>
            <UnifiedList
              items={paginatedLogs}
              columns={listColumns}
              rowKey={(entry) => String(entry.id)}
              emptyMessage="No logs matching filters."
              defaultSort={{ key: "created_at", direction: "desc" }}
              tableAriaLabel="Logs list"
            />
            <Pagination
              total={filteredLogs.length}
              pageSize={LOG_PAGE_SIZE}
              offset={logOffset}
              onOffsetChange={setLogOffset}
            />
          </>
        )}
      </PageBody>
    </>
  );
}

function levelColor(level: string): string {
  switch (level) {
    case "debug": return "var(--text-muted)";
    case "info": return "#22c55e";
    case "warn": return "#f59e0b";
    case "error": return "#ef4444";
    default: return "var(--text-secondary)";
  }
}

function badgeLevel(level: string): "success" | "warning" | "error" | "muted" {
  switch (level) {
    case "info": return "success";
    case "warn": return "warning";
    case "error": return "error";
    default: return "muted";
  }
}
