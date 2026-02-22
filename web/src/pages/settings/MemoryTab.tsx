import { useEffect, useState } from "react";
import { Badge, Button, Card, FormField, FormGrid, MetaText, Switch } from "../../components/ui";
import type { SettingsData } from "./types";

interface MemoryTabProps {
  settings: SettingsData;
  setSettings: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  memoryStats: Array<{ area: string; count: number; avg_confidence: number }>;
}

interface KnowledgeAudit {
  facts: {
    active: number;
    archived: number;
    duplicateRows: number;
    duplicateGroups: number;
  };
  memories: {
    operationalActive: number;
    legacyIdentityActive: number;
    legacyPreferencesActive: number;
  };
  reviews: {
    pendingTotal: number;
    pendingTriage: number;
    pendingVerifyFact: number;
  };
  _meta?: {
    generatedAt?: string;
    health?: "healthy" | "warning";
    healthReasons?: string[];
    repair?: {
      running?: boolean;
      runCount?: number;
      lastStartedAt?: string | null;
      lastFinishedAt?: string | null;
      lastDurationMs?: number | null;
      lastError?: string | null;
    };
  };
}

interface KnowledgeRepairStatus {
  running: boolean;
  runCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastReport?: {
    merged: number;
    decayed: number;
    deleted: number;
    dedupedFacts: number;
    conflictingFacts: number;
    noisyFacts: number;
    cleanedLegacyIdentity: number;
    queuedFactReviews: number;
    staleReviews: number;
  } | null;
  health?: "healthy" | "warning";
  healthReasons?: string[];
}

export default function MemoryTab({
  settings,
  setSettings,
  memoryStats,
}: MemoryTabProps) {
  const [audit, setAudit] = useState<KnowledgeAudit | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState<string | null>(null);
  const [repairState, setRepairState] = useState<KnowledgeRepairStatus | null>(null);

  const fmtTs = (value: string | null | undefined): string => {
    if (!value) return "never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "never";
    return date.toLocaleString();
  };

  const fetchAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/knowledge/audit");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAudit(data);
      if (data?._meta?.repair) {
        setRepairState((prev) => ({
          running: Boolean(data._meta.repair.running),
          runCount: Number(data._meta.repair.runCount || prev?.runCount || 0),
          lastStartedAt: data._meta.repair.lastStartedAt ?? prev?.lastStartedAt ?? null,
          lastFinishedAt: data._meta.repair.lastFinishedAt ?? prev?.lastFinishedAt ?? null,
          lastDurationMs: data._meta.repair.lastDurationMs ?? prev?.lastDurationMs ?? null,
          lastError: data._meta.repair.lastError ?? prev?.lastError ?? null,
          lastReport: prev?.lastReport ?? null,
          health: data._meta.health,
          healthReasons: Array.isArray(data._meta.healthReasons)
            ? data._meta.healthReasons
            : (prev?.healthReasons ?? []),
        }));
      }
    } catch (err) {
      console.error("Failed to load knowledge audit:", err);
    } finally {
      setAuditLoading(false);
    }
  };

  const fetchRepairStatus = async () => {
    try {
      const res = await fetch("/api/knowledge/repair/status");
      if (!res.ok) return;
      const data = await res.json();
      setRepairState(data);
    } catch {
      // non-critical
    }
  };

  const runRepair = async () => {
    const confirmed = window.confirm(
      "Run knowledge repair now? This cleans low-signal legacy memories and triage noise.",
    );
    if (!confirmed) return;

    setRepairing(true);
    setRepairStatus(null);
    try {
      const res = await fetch("/api/knowledge/repair", { method: "POST" });
      if (res.status === 409) {
        setRepairStatus("Repair is already running. Waiting for completion...");
        await fetchRepairStatus();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.audit) setAudit(data.audit as KnowledgeAudit);
      await fetchRepairStatus();
      const cleaned = Number(data?.report?.cleanedLegacyIdentity || 0);
      const stale = Number(data?.report?.staleReviews || 0);
      setRepairStatus(
        `Repair finished. Cleaned legacy memories: ${cleaned}. Stale triage auto-cleaned: ${stale}.`,
      );
    } catch (err) {
      console.error("Knowledge repair failed:", err);
      setRepairStatus("Repair failed. Check gateway logs and try again.");
    } finally {
      setRepairing(false);
    }
  };

  useEffect(() => {
    void fetchAudit();
    void fetchRepairStatus();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchRepairStatus();
      if (repairState?.running) {
        void fetchAudit();
      }
    }, repairState?.running ? 3000 : 20000);
    return () => window.clearInterval(interval);
  }, [repairState?.running]);

  return (
    <div className="flex-col gap-6">
      {/* Memory Settings */}
      <Card>
        <h3 className="mb-1">Memory System</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          5-area structured memory with hybrid search, temporal decay, and MMR diversity.
        </MetaText>

        {memoryStats.length > 0 && (
          <div className="flex-row gap-3 mb-4 flex-wrap">
            {memoryStats.map((s) => (
              <div key={s.area} className="stat-chip">
                <span className="stat-chip-label">{s.area}</span>
                <span className="stat-chip-value">{s.count}</span>
              </div>
            ))}
          </div>
        )}

        <FormGrid>
          <FormField label="Auto-Learn" hint="Automatically extract facts and solutions from conversations">
            <Switch
              checked={settings.memory.autoLearn}
              onCheckedChange={(checked) =>
                setSettings((s) => s ? { ...s, memory: { ...s.memory, autoLearn: checked } } : s)
              }
            />
          </FormField>

          <FormField label={`Vector Weight: ${settings.memory.vectorWeight}`} hint="Balance between semantic (vector) and keyword (BM25) search">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.memory.vectorWeight}
              onChange={(e) =>
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        memory: {
                          ...s.memory,
                          vectorWeight: Number(e.target.value),
                          textWeight: Math.round((1 - Number(e.target.value)) * 10) / 10,
                        },
                      }
                    : s,
                )
              }
            />
          </FormField>

          <FormField label="MMR Re-ranking (diversity)" hint={`Prevents near-duplicate results. Lambda: ${settings.memory.mmr.lambda}`}>
            <Switch
              checked={settings.memory.mmr.enabled}
              onCheckedChange={(checked) =>
                setSettings((s) =>
                  s ? { ...s, memory: { ...s.memory, mmr: { ...s.memory.mmr, enabled: checked } } } : s,
                )
              }
            />
          </FormField>

          <FormField label="Temporal Decay" hint="Newer memories score higher. Per-area half-life configured in DB.">
            <Switch
              checked={settings.memory.temporalDecay.enabled}
              onCheckedChange={(checked) =>
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        memory: {
                          ...s.memory,
                          temporalDecay: { ...s.memory.temporalDecay, enabled: checked },
                        },
                      }
                    : s,
                )
              }
            />
          </FormField>
        </FormGrid>
      </Card>

      {/* Mem0 Engine */}
      <Card>
        <h3 className="mb-1">Memory Engine</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          Mem0 OSS local integration with JOI memory as fallback/shadow-write.
        </MetaText>

        <div className="flex-row gap-3 mb-4 flex-wrap">
          <Badge status={settings.memory.mem0.enabled ? "success" : "muted"}>
            {settings.memory.mem0.enabled ? "Mem0 Enabled" : "Mem0 Disabled"}
          </Badge>
          <Badge status="accent">Local OSS Mode</Badge>
        </div>

        <FormGrid>
          <FormField label="Enable Mem0" hint="Use Mem0 as primary memory engine for recall and updates.">
            <Switch
              checked={settings.memory.mem0.enabled}
              onCheckedChange={(checked) =>
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        memory: { ...s.memory, mem0: { ...s.memory.mem0, enabled: checked } },
                      }
                    : s,
                )
              }
            />
          </FormField>

          <FormField label="User ID" hint="Stable identity key for Mem0 memory scoping.">
            <input
              type="text"
              value={settings.memory.mem0.userId || ""}
              onChange={(e) =>
                setSettings((s) =>
                  s
                    ? { ...s, memory: { ...s.memory, mem0: { ...s.memory.mem0, userId: e.target.value } } }
                    : s,
                )
              }
              placeholder="primary-user"
            />
          </FormField>

          <FormField label="App ID" hint="Optional Mem0 app scope (local namespace).">
            <input
              type="text"
              value={settings.memory.mem0.appId || ""}
              onChange={(e) =>
                setSettings((s) =>
                  s
                    ? { ...s, memory: { ...s.memory, mem0: { ...s.memory.mem0, appId: e.target.value } } }
                    : s,
                )
              }
              placeholder="joi"
            />
          </FormField>

          <FormField label="Shadow-write local memories" hint="Also write to JOI Postgres memory tables during rollout.">
            <Switch
              checked={settings.memory.mem0.shadowWriteLocal}
              onCheckedChange={(checked) =>
                setSettings((s) =>
                  s
                    ? {
                        ...s,
                        memory: {
                          ...s.memory,
                          mem0: { ...s.memory.mem0, shadowWriteLocal: checked },
                        },
                      }
                    : s,
                )
              }
            />
          </FormField>

          <FormField label="Session Context Limit" hint="How many Mem0 recalls feed agent system context (3-20).">
            <input
              type="number"
              min={3}
              max={20}
              step={1}
              value={settings.memory.mem0.sessionContextLimit}
              onChange={(e) =>
                setSettings((s) => {
                  if (!s) return s;
                  const raw = Number(e.target.value);
                  const safe = Number.isFinite(raw) ? Math.max(3, Math.min(20, raw)) : 8;
                  return {
                    ...s,
                    memory: { ...s.memory, mem0: { ...s.memory.mem0, sessionContextLimit: safe } },
                  };
                })
              }
            />
          </FormField>
        </FormGrid>
      </Card>

      {/* Knowledge Audit */}
      <Card>
        <h3 className="mb-1">Knowledge Audit</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          High-priority controls for memory quality: refresh audit, run repair, and monitor cleanup health.
        </MetaText>

        {auditLoading ? (
          <MetaText size="sm">Loading audit...</MetaText>
        ) : audit ? (
          <div className="flex-col gap-3 mb-4">
            <div className="flex-row gap-3 flex-wrap">
              <Badge status="accent">Facts active: {audit.facts.active}</Badge>
              <Badge status={audit._meta?.health === "warning" ? "warning" : "success"}>
                Health: {audit._meta?.health === "warning" ? "Needs Attention" : "Healthy"}
              </Badge>
              <Badge status={audit.facts.duplicateRows > 0 ? "warning" : "success"}>
                Fact duplicates: {audit.facts.duplicateRows}
              </Badge>
              <Badge status={audit.memories.legacyIdentityActive > 0 ? "warning" : "success"}>
                Legacy identity: {audit.memories.legacyIdentityActive}
              </Badge>
              <Badge status={audit.memories.legacyPreferencesActive > 0 ? "warning" : "success"}>
                Legacy preferences: {audit.memories.legacyPreferencesActive}
              </Badge>
              <Badge status="info">Pending reviews: {audit.reviews.pendingTotal}</Badge>
            </div>
            <MetaText size="xs">
              Pending triage: {audit.reviews.pendingTriage} · Pending fact verify: {audit.reviews.pendingVerifyFact}
            </MetaText>
            <MetaText size="xs">
              Last audit refresh: {fmtTs(audit._meta?.generatedAt)}
            </MetaText>
            {audit._meta?.health === "warning" && (audit._meta?.healthReasons?.length || 0) > 0 && (
              <MetaText size="xs">
                Needs attention: {audit._meta?.healthReasons?.join(" · ")}
              </MetaText>
            )}
          </div>
        ) : (
          <MetaText size="sm">Audit unavailable.</MetaText>
        )}

        {repairState && (
          <div className="flex-col gap-2 mb-4">
            <div className="flex-row gap-2 flex-wrap">
              <Badge status={repairState.running ? "warning" : "success"}>
                Repair: {repairState.running ? "Running" : "Idle"}
              </Badge>
              <Badge status="info">Runs: {repairState.runCount}</Badge>
              <Badge status="muted">Last run: {fmtTs(repairState.lastFinishedAt)}</Badge>
            </div>
            {repairState.lastDurationMs != null && (
              <MetaText size="xs">Last duration: {(repairState.lastDurationMs / 1000).toFixed(1)}s</MetaText>
            )}
            {repairState.lastError && (
              <MetaText size="xs">Last error: {repairState.lastError}</MetaText>
            )}
            {repairState.lastReport && (
              <MetaText size="xs">
                Last report: cleaned {repairState.lastReport.cleanedLegacyIdentity} legacy memories, deduped{" "}
                {repairState.lastReport.dedupedFacts} facts, cleaned {repairState.lastReport.staleReviews} stale triage.
              </MetaText>
            )}
            {repairState.health === "warning" && (repairState.healthReasons?.length || 0) > 0 && (
              <MetaText size="xs">
                Current priority: {repairState.healthReasons?.join(" · ")}
              </MetaText>
            )}
          </div>
        )}

        <div className="flex-row gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={fetchAudit} disabled={auditLoading || repairState?.running}>
            Refresh Audit
          </Button>
          <Button size="sm" variant="primary" onClick={runRepair} disabled={repairing || repairState?.running}>
            {repairing || repairState?.running ? "Repairing..." : "Run Knowledge Repair"}
          </Button>
        </div>
        {repairStatus && (
          <MetaText size="sm" className="block mt-3">{repairStatus}</MetaText>
        )}
      </Card>

      {/* Obsidian */}
      <Card>
        <h3 className="mb-4">Obsidian Vault</h3>
        <FormGrid>
          <FormField label="Vault Path">
            <input
              type="text"
              value={settings.obsidian.vaultPath || ""}
              onChange={(e) =>
                setSettings((s) => s ? { ...s, obsidian: { ...s.obsidian, vaultPath: e.target.value } } : s)
              }
              placeholder="~/Library/Mobile Documents/iCloud~md~obsidian/Documents"
            />
          </FormField>
          <FormField label="Auto-sync vault to knowledge base" hint="Watch for changes and re-index automatically">
            <Switch
              checked={settings.obsidian.syncEnabled}
              onCheckedChange={(checked) =>
                setSettings((s) =>
                  s ? { ...s, obsidian: { ...s.obsidian, syncEnabled: checked } } : s,
                )
              }
            />
          </FormField>
        </FormGrid>
      </Card>
    </div>
  );
}
