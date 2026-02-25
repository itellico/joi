import React, { useState, useEffect, useCallback } from "react";
import {
  PageHeader,
  PageBody,
  Card,
  CardGrid,
  Badge,
  Button,
  Tabs,
  Modal,
  FormField,
  FormGrid,
  Row,
  Stack,
  MetaText,
  SectionLabel,
  EmptyState,
  StatusDot,
  UnifiedList,
  type UnifiedListColumn,
  SearchInput,
} from "../components/ui";

// ─── Types ───

interface SyncProvider {
  id: string;
  name: string;
  type: string;
  rclone_remote: string | null;
  config: Record<string, unknown>;
  status: string;
  status_message: string | null;
}

interface SyncPair {
  id: string;
  name: string;
  source_provider_id: string;
  source_path: string;
  target_provider_id: string;
  target_path: string;
  direction: string;
  schedule: string;
  enabled: boolean;
  exclude_patterns: string[];
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  files_synced: number;
  source_provider?: SyncProvider;
  target_provider?: SyncProvider;
}

interface SyncRun {
  id: string;
  pair_id: string;
  pair_name?: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  direction: string;
  files_transferred: number;
  files_deleted: number;
  bytes_transferred: number;
  error_message: string | null;
}

interface SyncStats {
  total_pairs: number;
  active_pairs: number;
  running: number;
  total_runs: number;
  providers: number;
  rclone_installed: boolean;
}

interface BrowseEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
}

interface QuickLocation {
  label: string;
  path: string;
  icon: string;
  group: string;
}

// ─── Helpers ───

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function directionLabel(dir: string): string {
  switch (dir) {
    case "push": return "Push";
    case "pull": return "Pull";
    case "bisync": return "Bidirectional";
    default: return dir;
  }
}

function directionArrow(dir: string): string {
  switch (dir) {
    case "push": return "\u2192";
    case "pull": return "\u2190";
    case "bisync": return "\u21C4";
    default: return "\u2192";
  }
}

function providerIcon(type: string): string {
  switch (type) {
    case "gdrive": return "GDrive";
    case "icloud": return "iCloud";
    case "dropbox": return "Dropbox";
    case "s3": return "S3";
    case "sftp": return "SFTP";
    case "local": return "Local";
    case "onedrive": return "OneDrive";
    default: return type;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function syncStatusBadge(status: string | null): React.ReactElement {
  switch (status) {
    case "success": return <Badge status="success">Synced</Badge>;
    case "running": return <Badge status="info">Syncing</Badge>;
    case "error": return <Badge status="error">Error</Badge>;
    default: return <Badge status="muted">Pending</Badge>;
  }
}

const PROVIDER_TYPES = [
  { value: "local", label: "Local Filesystem" },
  { value: "gdrive", label: "Google Drive" },
  { value: "icloud", label: "iCloud (via SFTP)" },
  { value: "sftp", label: "SFTP" },
  { value: "dropbox", label: "Dropbox" },
  { value: "s3", label: "Amazon S3" },
  { value: "onedrive", label: "OneDrive" },
];

const SCHEDULES = [
  { value: "manual", label: "Manual only" },
  { value: "1m", label: "Every 1 minute" },
  { value: "5m", label: "Every 5 minutes" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "2h", label: "Every 2 hours" },
  { value: "daily", label: "Daily" },
];

// ─── Component ───

export default function CloudSync() {
  const [pairs, setPairs] = useState<SyncPair[]>([]);
  const [providers, setProviders] = useState<SyncProvider[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());

  // Modals
  const [showPairModal, setShowPairModal] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [showBrowseModal, setShowBrowseModal] = useState(false);
  const [editingPair, setEditingPair] = useState<SyncPair | null>(null);

  // Pair form
  const [pairForm, setPairForm] = useState({
    name: "",
    source_provider_id: "local",
    source_path: "",
    target_provider_id: "",
    target_path: "",
    direction: "bisync",
    schedule: "manual",
    exclude_patterns: ".DS_Store, ._*, .Trash, Thumbs.db, .git",
  });

  // Provider form
  const [providerForm, setProviderForm] = useState({
    id: "gdrive",
    name: "Google Drive",
    type: "gdrive",
    rclone_remote: "gdrive:",
  });

  // Browse state
  const [browseProvider, setBrowseProvider] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<"source" | "target">("source");

  // Quick locations
  const [quickLocations, setQuickLocations] = useState<QuickLocation[]>([]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // ─── Data fetching ───

  const fetchAll = useCallback(async () => {
    try {
      const [pairsRes, providersRes, runsRes, statsRes] = await Promise.all([
        fetch("/api/cloud-sync/pairs").then((r) => r.json()),
        fetch("/api/cloud-sync/providers").then((r) => r.json()),
        fetch("/api/cloud-sync/runs?limit=50").then((r) => r.json()),
        fetch("/api/cloud-sync/stats").then((r) => r.json()),
      ]);
      setPairs(pairsRes.pairs || []);
      setProviders(providersRes.providers || []);
      setRuns(runsRes.runs || []);
      setStats(statsRes);
    } catch (err) {
      console.error("Failed to fetch cloud sync data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ─── Actions ───

  const triggerSync = useCallback(async (pairId: string) => {
    setSyncing((prev) => new Set(prev).add(pairId));
    try {
      await fetch(`/api/cloud-sync/pairs/${pairId}/sync`, { method: "POST" });
      setTimeout(fetchAll, 2000);
    } catch (err) {
      console.error("Sync trigger failed:", err);
    } finally {
      setTimeout(() => {
        setSyncing((prev) => {
          const next = new Set(prev);
          next.delete(pairId);
          return next;
        });
      }, 3000);
    }
  }, [fetchAll]);

  const togglePair = useCallback(async (pair: SyncPair) => {
    await fetch(`/api/cloud-sync/pairs/${pair.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !pair.enabled }),
    });
    fetchAll();
  }, [fetchAll]);

  const removePair = useCallback(async (pairId: string) => {
    await fetch(`/api/cloud-sync/pairs/${pairId}`, { method: "DELETE" });
    fetchAll();
  }, [fetchAll]);

  const savePair = useCallback(async () => {
    const body = {
      ...pairForm,
      exclude_patterns: pairForm.exclude_patterns.split(",").map((s) => s.trim()).filter(Boolean),
    };

    if (editingPair) {
      await fetch(`/api/cloud-sync/pairs/${editingPair.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/cloud-sync/pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    setShowPairModal(false);
    setEditingPair(null);
    fetchAll();
  }, [pairForm, editingPair, fetchAll]);

  const saveProvider = useCallback(async () => {
    await fetch("/api/cloud-sync/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerForm),
    });
    setShowProviderModal(false);
    fetchAll();
  }, [providerForm, fetchAll]);

  const [checkingProvider, setCheckingProvider] = useState<string | null>(null);

  const checkProviderStatus = useCallback(async (id: string) => {
    setCheckingProvider(id);
    try {
      await fetch(`/api/cloud-sync/providers/${id}/check`, { method: "POST" });
      await fetchAll();
    } finally {
      setCheckingProvider(null);
    }
  }, [fetchAll]);

  const removeProvider = useCallback(async (id: string) => {
    await fetch(`/api/cloud-sync/providers/${id}`, { method: "DELETE" });
    fetchAll();
  }, [fetchAll]);

  // ─── Browse ───

  const openBrowser = useCallback((providerId: string, target: "source" | "target", currentPath: string) => {
    setBrowseProvider(providerId);
    setBrowsePath(currentPath || (providerId === "local" ? "/" : ""));
    setBrowseTarget(target);
    setShowBrowseModal(true);
    loadBrowse(providerId, currentPath || (providerId === "local" ? "/" : ""));
    // Fetch quick locations for local provider
    if (providerId === "local") {
      fetch("/api/cloud-sync/quick-locations").then(r => r.json()).then(d => setQuickLocations(d.locations || [])).catch(() => {});
    }
  }, []);

  const loadBrowse = useCallback(async (providerId: string, path: string) => {
    setBrowseLoading(true);
    try {
      const res = await fetch(`/api/cloud-sync/browse?provider=${providerId}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setBrowseEntries(data.entries || []);
      setBrowsePath(path);
    } catch (err) {
      console.error("Browse failed:", err);
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const selectBrowsePath = useCallback(() => {
    if (browseTarget === "source") {
      setPairForm((f) => ({ ...f, source_path: browsePath }));
    } else {
      setPairForm((f) => ({ ...f, target_path: browsePath }));
    }
    setShowBrowseModal(false);
  }, [browseTarget, browsePath]);

  // ─── Edit pair ───

  const openEditPair = useCallback((pair: SyncPair) => {
    setEditingPair(pair);
    setPairForm({
      name: pair.name,
      source_provider_id: pair.source_provider_id,
      source_path: pair.source_path,
      target_provider_id: pair.target_provider_id,
      target_path: pair.target_path,
      direction: pair.direction,
      schedule: pair.schedule,
      exclude_patterns: (pair.exclude_patterns || []).join(", "),
    });
    setShowPairModal(true);
  }, []);

  const openNewPair = useCallback(() => {
    setEditingPair(null);
    setPairForm({
      name: "",
      source_provider_id: "local",
      source_path: "",
      target_provider_id: providers.find((p) => p.type === "gdrive")?.id || "",
      target_path: "",
      direction: "bisync",
      schedule: "manual",
      exclude_patterns: ".DS_Store, ._*, .Trash, Thumbs.db, .git",
    });
    setShowPairModal(true);
  }, [providers]);

  // ─── Filtered pairs ───

  const filteredPairs = pairs.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.source_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.target_path.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // ─── Run columns ───

  const runColumns: UnifiedListColumn<SyncRun>[] = [
    {
      key: "status",
      header: "Status",
      width: 90,
      render: (run) => syncStatusBadge(run.status),
      sortValue: (run) => run.status,
    },
    {
      key: "pair",
      header: "Pair",
      render: (run) => <span>{run.pair_name || run.pair_id.slice(0, 8)}</span>,
      sortValue: (run) => run.pair_name || run.pair_id,
    },
    {
      key: "direction",
      header: "Direction",
      width: 100,
      render: (run) => <MetaText size="sm">{directionLabel(run.direction)}</MetaText>,
    },
    {
      key: "files",
      header: "Files",
      width: 80,
      align: "right" as const,
      render: (run) => (
        <MetaText size="sm">
          {run.files_transferred > 0 ? `+${run.files_transferred}` : "0"}
          {run.files_deleted > 0 ? ` -${run.files_deleted}` : ""}
        </MetaText>
      ),
    },
    {
      key: "started",
      header: "Started",
      width: 110,
      align: "right" as const,
      render: (run) => <MetaText size="xs">{timeAgo(run.started_at)}</MetaText>,
      sortValue: (run) => new Date(run.started_at).getTime(),
    },
    {
      key: "duration",
      header: "Duration",
      width: 80,
      align: "right" as const,
      render: (run) => {
        if (!run.completed_at) return <MetaText size="xs">Running...</MetaText>;
        const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
        return <MetaText size="xs">{ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}</MetaText>;
      },
    },
  ];

  // ─── Render ───

  if (loading) {
    return (
      <>
        <PageHeader title="Cloud Sync" subtitle="Loading..." />
        <PageBody><Card><MetaText size="sm">Loading sync data...</MetaText></Card></PageBody>
      </>
    );
  }

  const subtitle = stats
    ? `${stats.active_pairs} active pair${stats.active_pairs !== 1 ? "s" : ""} \u00B7 ${stats.providers} provider${stats.providers !== 1 ? "s" : ""}${stats.running > 0 ? ` \u00B7 ${stats.running} running` : ""}`
    : "";

  return (
    <>
      <PageHeader
        title="Cloud Sync"
        subtitle={subtitle}
        actions={
          <Row gap={2}>
            <Button variant="ghost" onClick={() => setShowProviderModal(true)}>
              + Provider
            </Button>
            <Button variant="primary" onClick={openNewPair}>
              + Sync Pair
            </Button>
          </Row>
        }
      />
      <PageBody>
        {!stats?.rclone_installed && (
          <Card accent="var(--warning)">
            <Row gap={3} align="center">
              <StatusDot status="warning" />
              <div>
                <strong>rclone not installed</strong>
                <MetaText size="sm">Install with: <code>brew install rclone</code></MetaText>
              </div>
            </Row>
          </Card>
        )}

        <Tabs
          defaultValue="pairs"
          tabs={[
            {
              value: "pairs",
              label: `Sync Pairs (${pairs.length})`,
              content: (
                <Stack gap={4}>
                  {pairs.length > 3 && (
                    <SearchInput
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="Search pairs..."
                      resultCount={filteredPairs.length}
                    />
                  )}

                  {filteredPairs.length === 0 ? (
                    <Card>
                      <EmptyState
                        icon="🔄"
                        message="No sync pairs configured yet"
                        action={
                          <Button variant="primary" onClick={openNewPair}>
                            Create First Pair
                          </Button>
                        }
                      />
                    </Card>
                  ) : (
                    <CardGrid minWidth={380}>
                      {filteredPairs.map((pair) => (
                        <Card
                          key={pair.id}
                          dimmed={!pair.enabled}
                          accent={
                            pair.last_sync_status === "error"
                              ? "var(--error)"
                              : pair.last_sync_status === "running"
                                ? "var(--cyan)"
                                : undefined
                          }
                        >
                          <Stack gap={3}>
                            <Row justify="between" align="center">
                              <Row gap={2} align="center">
                                <strong className="text-sm">{pair.name}</strong>
                                {syncStatusBadge(pair.last_sync_status)}
                              </Row>
                              <Row gap={1}>
                                <Button
                                  size="sm"
                                  onClick={() => triggerSync(pair.id)}
                                  disabled={syncing.has(pair.id) || !pair.enabled}
                                >
                                  {syncing.has(pair.id) ? "Syncing..." : "Sync Now"}
                                </Button>
                              </Row>
                            </Row>

                            <div style={{ padding: "8px 0" }}>
                              <Row gap={2} align="center">
                                <Badge status="muted">{providerIcon(pair.source_provider?.type || "local")}</Badge>
                                <code className="text-xs truncate" style={{ maxWidth: 140 }} title={pair.source_path}>
                                  {pair.source_path}
                                </code>
                                <span className="text-accent font-semibold" style={{ fontSize: 16 }}>
                                  {directionArrow(pair.direction)}
                                </span>
                                <Badge status="muted">{providerIcon(pair.target_provider?.type || "unknown")}</Badge>
                                <code className="text-xs truncate" style={{ maxWidth: 140 }} title={pair.target_path}>
                                  {pair.target_path}
                                </code>
                              </Row>
                            </div>

                            <Row justify="between" align="center">
                              <Row gap={3}>
                                <MetaText size="xs">
                                  {directionLabel(pair.direction)} \u00B7 {SCHEDULES.find((s) => s.value === pair.schedule)?.label || pair.schedule}
                                </MetaText>
                                {pair.last_sync_at && (
                                  <MetaText size="xs">Last: {timeAgo(pair.last_sync_at)}</MetaText>
                                )}
                              </Row>
                              <Row gap={1}>
                                <button
                                  className="btn-small"
                                  onClick={() => togglePair(pair)}
                                  title={pair.enabled ? "Pause" : "Resume"}
                                >
                                  {pair.enabled ? "Pause" : "Resume"}
                                </button>
                                <button className="btn-small" onClick={() => openEditPair(pair)}>Edit</button>
                                <button className="btn-small ui-btn-danger" onClick={() => removePair(pair.id)}>Delete</button>
                              </Row>
                            </Row>

                            {pair.last_sync_message && (
                              <MetaText size="xs">
                                {pair.last_sync_status === "error" ? (
                                  <span className="text-error">{pair.last_sync_message}</span>
                                ) : (
                                  pair.last_sync_message
                                )}
                              </MetaText>
                            )}
                          </Stack>
                        </Card>
                      ))}
                    </CardGrid>
                  )}
                </Stack>
              ),
            },
            {
              value: "activity",
              label: `Activity (${runs.length})`,
              content: (
                <Stack gap={3}>
                  {runs.length === 0 ? (
                    <Card>
                      <EmptyState
                        icon="📋"
                        message="No sync runs yet"
                      />
                    </Card>
                  ) : (
                    <UnifiedList
                      items={runs}
                      columns={runColumns}
                      rowKey={(run) => run.id}
                      defaultSort={{ key: "started", direction: "desc" }}
                      tableAriaLabel="Sync run history"
                      emptyMessage="No sync runs recorded."
                    />
                  )}
                </Stack>
              ),
            },
            {
              value: "providers",
              label: `Providers (${providers.length})`,
              content: (
                <Stack gap={3}>
                  <Row justify="end">
                    <Button variant="ghost" onClick={() => setShowProviderModal(true)}>
                      + Add Provider
                    </Button>
                  </Row>

                  {providers.length === 0 ? (
                    <Card>
                      <EmptyState
                        icon="🔌"
                        message="No providers configured"
                        action={
                          <Button variant="primary" onClick={() => setShowProviderModal(true)}>
                            Add Provider
                          </Button>
                        }
                      />
                    </Card>
                  ) : (
                    <CardGrid minWidth={300}>
                      {providers.map((prov) => (
                        <Card key={prov.id}>
                          <Stack gap={2}>
                            <Row justify="between" align="center">
                              <Row gap={2} align="center">
                                <strong className="text-sm">{prov.name}</strong>
                                <Badge status={prov.status === "connected" ? "success" : prov.status === "error" ? "error" : "warning"}>
                                  {prov.status}
                                </Badge>
                              </Row>
                              <Badge status="muted">{providerIcon(prov.type)}</Badge>
                            </Row>

                            {prov.rclone_remote && (
                              <MetaText size="xs">Remote: <code>{prov.rclone_remote}</code></MetaText>
                            )}
                            {prov.status_message && (
                              <MetaText size="xs">{prov.status_message}</MetaText>
                            )}

                            <Row gap={1} justify="end">
                              <button
                                className="btn-small"
                                onClick={() => checkProviderStatus(prov.id)}
                                disabled={checkingProvider === prov.id}
                              >
                                {checkingProvider === prov.id ? "Testing..." : "Test"}
                              </button>
                              {prov.id !== "local" && (
                                <button className="btn-small ui-btn-danger" onClick={() => removeProvider(prov.id)}>
                                  Remove
                                </button>
                              )}
                            </Row>
                          </Stack>
                        </Card>
                      ))}
                    </CardGrid>
                  )}
                </Stack>
              ),
            },
          ]}
        />

        {/* ─── Create/Edit Pair Modal ─── */}
        {showPairModal && (
          <Modal
            open
            onClose={() => { setShowPairModal(false); setEditingPair(null); }}
            title={editingPair ? "Edit Sync Pair" : "New Sync Pair"}
            width={560}
          >
            <Stack gap={4}>
              <FormGrid>
                <FormField label="Name" span>
                  <input
                    type="text"
                    value={pairForm.name}
                    onChange={(e) => setPairForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g., Obsidian Vault"
                  />
                </FormField>
              </FormGrid>

              <SectionLabel>Source</SectionLabel>
              <FormGrid>
                <FormField label="Provider">
                  <select
                    value={pairForm.source_provider_id}
                    onChange={(e) => setPairForm((f) => ({ ...f, source_provider_id: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({providerIcon(p.type)})
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Path">
                  <Row gap={1}>
                    <input
                      type="text"
                      value={pairForm.source_path}
                      onChange={(e) => setPairForm((f) => ({ ...f, source_path: e.target.value }))}
                      placeholder="/Volumes/ExtSSD/folder"
                      style={{ flex: 1 }}
                    />
                    {pairForm.source_provider_id && (
                      <Button
                        size="sm"
                        onClick={() => openBrowser(pairForm.source_provider_id, "source", pairForm.source_path)}
                      >
                        Browse
                      </Button>
                    )}
                  </Row>
                </FormField>
              </FormGrid>

              <SectionLabel>Target</SectionLabel>
              <FormGrid>
                <FormField label="Provider">
                  <select
                    value={pairForm.target_provider_id}
                    onChange={(e) => setPairForm((f) => ({ ...f, target_provider_id: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({providerIcon(p.type)})
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Path">
                  <Row gap={1}>
                    <input
                      type="text"
                      value={pairForm.target_path}
                      onChange={(e) => setPairForm((f) => ({ ...f, target_path: e.target.value }))}
                      placeholder="SharedFolder/Documents"
                      style={{ flex: 1 }}
                    />
                    {pairForm.target_provider_id && (
                      <Button
                        size="sm"
                        onClick={() => openBrowser(pairForm.target_provider_id, "target", pairForm.target_path)}
                      >
                        Browse
                      </Button>
                    )}
                  </Row>
                </FormField>
              </FormGrid>

              <SectionLabel>Settings</SectionLabel>
              <FormGrid>
                <FormField label="Direction">
                  <select
                    value={pairForm.direction}
                    onChange={(e) => setPairForm((f) => ({ ...f, direction: e.target.value }))}
                  >
                    <option value="push">Push (Source {"\u2192"} Target)</option>
                    <option value="pull">Pull (Target {"\u2192"} Source)</option>
                    <option value="bisync">Bidirectional ({"\u21C4"})</option>
                  </select>
                </FormField>
                <FormField label="Schedule">
                  <select
                    value={pairForm.schedule}
                    onChange={(e) => setPairForm((f) => ({ ...f, schedule: e.target.value }))}
                  >
                    {SCHEDULES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Exclude Patterns" span hint="Comma-separated patterns">
                  <input
                    type="text"
                    value={pairForm.exclude_patterns}
                    onChange={(e) => setPairForm((f) => ({ ...f, exclude_patterns: e.target.value }))}
                    placeholder=".DS_Store, ._*, .Trash"
                  />
                </FormField>
              </FormGrid>

              <Row justify="end" gap={2}>
                <Button onClick={() => { setShowPairModal(false); setEditingPair(null); }}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={savePair}
                  disabled={!pairForm.name || !pairForm.source_provider_id || !pairForm.source_path || !pairForm.target_provider_id || !pairForm.target_path}
                >
                  {editingPair ? "Save Changes" : "Create Pair"}
                </Button>
              </Row>
            </Stack>
          </Modal>
        )}

        {/* ─── Add Provider Modal ─── */}
        {showProviderModal && (
          <Modal
            open
            onClose={() => setShowProviderModal(false)}
            title="Add Provider"
            width={440}
          >
            <Stack gap={4}>
              <FormGrid>
                <FormField label="Type" span>
                  <select
                    value={providerForm.type}
                    onChange={(e) => {
                      const type = e.target.value;
                      setProviderForm((f) => ({
                        ...f,
                        type,
                        id: type,
                        name: PROVIDER_TYPES.find((t) => t.value === type)?.label || type,
                        rclone_remote: type === "local" ? "" : type + ":",
                      }));
                    }}
                  >
                    {PROVIDER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="ID" hint="Unique identifier">
                  <input
                    type="text"
                    value={providerForm.id}
                    onChange={(e) => setProviderForm((f) => ({ ...f, id: e.target.value }))}
                    placeholder="gdrive"
                  />
                </FormField>
                <FormField label="Name">
                  <input
                    type="text"
                    value={providerForm.name}
                    onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Google Drive"
                  />
                </FormField>
                {providerForm.type !== "local" && (
                  <FormField label="rclone Remote" span hint="The rclone remote name (e.g., gdrive:)">
                    <input
                      type="text"
                      value={providerForm.rclone_remote}
                      onChange={(e) => setProviderForm((f) => ({ ...f, rclone_remote: e.target.value }))}
                      placeholder="gdrive:"
                    />
                  </FormField>
                )}
              </FormGrid>

              <Row justify="end" gap={2}>
                <Button onClick={() => setShowProviderModal(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={saveProvider}
                  disabled={!providerForm.id || !providerForm.name}
                >
                  Add Provider
                </Button>
              </Row>
            </Stack>
          </Modal>
        )}

        {/* ─── Browse Modal (Finder-style) ─── */}
        {showBrowseModal && (
          <Modal
            open
            onClose={() => setShowBrowseModal(false)}
            title="Browse Files"
            width={780}
          >
            <Stack gap={3}>
              {/* Path bar */}
              <Row gap={2} align="center">
                <Button size="sm" onClick={() => {
                  const parent = browsePath.replace(/\/[^/]+\/?$/, "") || "/";
                  loadBrowse(browseProvider, parent);
                }}>
                  &larr;
                </Button>
                <code className="text-sm" style={{ flex: 1, padding: "6px 10px", background: "var(--bg-primary)", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {browsePath || "/"}
                </code>
              </Row>

              {/* Sidebar + File list layout */}
              <div style={{ display: "flex", gap: 0, height: 420, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                {/* Sidebar */}
                {browseProvider === "local" && quickLocations.length > 0 && (
                  <div className="browse-sidebar" style={{
                    width: 200, minWidth: 200, borderRight: "1px solid var(--border)", overflowY: "auto",
                    background: "var(--bg-secondary)", padding: "8px 0",
                  }}>
                    {(() => {
                      const groups = [...new Set(quickLocations.map(l => l.group))];
                      return groups.map(group => (
                        <div key={group}>
                          <div style={{ padding: "6px 12px 4px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                            {group}
                          </div>
                          {quickLocations.filter(l => l.group === group).map(loc => (
                            <div
                              key={loc.path}
                              onClick={() => loadBrowse(browseProvider, loc.path)}
                              style={{
                                padding: "5px 12px", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8,
                                background: browsePath === loc.path ? "var(--accent-subtle)" : "transparent",
                                color: browsePath === loc.path ? "var(--accent)" : "var(--text-primary)",
                                borderRadius: 4, margin: "1px 4px",
                              }}
                            >
                              <span style={{ fontSize: 14, width: 18, textAlign: "center", flexShrink: 0 }}>
                                {loc.icon === "desktop" ? "\uD83D\uDDA5" :
                                 loc.icon === "documents" ? "\uD83D\uDCC1" :
                                 loc.icon === "downloads" ? "\u2B07\uFE0F" :
                                 loc.icon === "home" ? "\uD83C\uDFE0" :
                                 loc.icon === "code" ? "\uD83D\uDCBB" :
                                 loc.icon === "icloud" ? "\u2601\uFE0F" :
                                 loc.icon === "obsidian" ? "\uD83D\uDC8E" :
                                 loc.icon === "gdrive" ? "\uD83D\uDFE2" :
                                 loc.icon === "dropbox" ? "\uD83D\uDCE6" :
                                 loc.icon === "onedrive" ? "\uD83D\uDD35" :
                                 loc.icon === "disk" ? "\uD83D\uDCBF" : "\uD83D\uDCC2"}
                              </span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loc.label}</span>
                            </div>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                )}

                {/* File list */}
                <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
                  {browseLoading ? (
                    <div style={{ padding: 20 }}><MetaText size="sm">Loading...</MetaText></div>
                  ) : browseEntries.length === 0 ? (
                    <div style={{ padding: 20 }}><MetaText size="sm">Empty folder</MetaText></div>
                  ) : (
                    <table className="data-table" style={{ width: "100%" }}>
                      <tbody>
                        {browseEntries.map((entry) => (
                          <tr
                            key={entry.path}
                            style={{ cursor: entry.is_dir ? "pointer" : "default" }}
                            onClick={() => entry.is_dir && loadBrowse(browseProvider, entry.path)}
                          >
                            <td style={{ width: 28, paddingLeft: 12 }}>{entry.is_dir ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}</td>
                            <td className="text-sm">{entry.name}</td>
                            <td className="text-xs text-muted" style={{ textAlign: "right", paddingRight: 12 }}>
                              {entry.is_dir ? "" : formatBytes(entry.size)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <Row justify="end" gap={2}>
                <Button onClick={() => setShowBrowseModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={selectBrowsePath}>
                  Select: {browsePath.split("/").pop() || "/"}
                </Button>
              </Row>
            </Stack>
          </Modal>
        )}
      </PageBody>
    </>
  );
}
