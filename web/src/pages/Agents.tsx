import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import MarkdownField from "../components/MarkdownField";
import { Badge, Button, Card, EmptyState, ListPage, MetaText, Modal, PageBody, PageHeader, Row, SectionLabel, Stack, StatusDot, Tabs, type UnifiedListColumn } from "../components/ui";
import { getCapabilities, getAllCapabilities, CORE_TOOLS, CAPABILITY_TO_SKILLS, getToolCapability } from "../lib/agentCapabilities";
import { AGENT_META } from "../lib/agentMeta";

interface Agent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  model: string | null;
  enabled: boolean;
  skills: string[] | null;
  config?: Record<string, unknown> | null;
}

interface AgentStats {
  summary: {
    total_calls: number;
    total_cost: number;
    total_input_tokens: number;
    total_output_tokens: number;
    avg_latency_ms: number;
  };
  daily: { day: string; calls: number; cost: number }[];
}

interface ModelInfo {
  id: string;
  name: string;
  tier: string;
  costPer1kIn: number;
  costPer1kOut: number;
}

interface AvailableModels {
  anthropic: ModelInfo[];
  openrouter: ModelInfo[];
  ollama: ModelInfo[];
}

interface Skill {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string | null;
  enabled: boolean;
  agent_ids: string[];
  created_at: string;
  kind?: "tool" | "instruction";
  runtime?: "gateway" | "claude" | "codex" | "gemini";
  scope?: "system" | "user" | "project";
}

interface SoulValidation {
  valid: boolean;
  score: number;
  wordCount: number;
  presentSections: string[];
  missingSections: string[];
  issues: string[];
}

interface SoulVersion {
  id: string;
  agent_id: string;
  content: string;
  source: string;
  author: string;
  review_id: string | null;
  quality_run_id: string | null;
  quality_status: "not_run" | "passed" | "failed";
  change_summary: string | null;
  parent_version_id: string | null;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
}

interface SoulRollout {
  id: string;
  status: "canary_active" | "promoted" | "rolled_back" | "cancelled";
  traffic_percent: number;
  minimum_sample_size: number;
  metrics: Record<string, unknown>;
  decision_reason: string | null;
  started_at: string;
}

// AGENT_META is now imported from ../lib/agentMeta

const CATEGORY_META: Record<string, { title: string; subtitle: string; icon: string }> = {
  combined:   { title: "Combined Agents",  subtitle: "Multi-skill agents that orchestrate across platforms", icon: "🤖" },
  operations: { title: "Operations",       subtitle: "Automated accounting & invoice pipeline", icon: "⚙️" },
  system:     { title: "System",           subtitle: "Core assistant", icon: "💻" },
};

const CATEGORY_ORDER = ["combined", "operations", "system"];
const PAGE_VIEWS = ["agents", "matrix", "skills", "heartbeat"] as const;
const EDIT_TABS = ["prompt", "skills", "stats", "soul"] as const;

function isPageView(value: string | null): value is (typeof PAGE_VIEWS)[number] {
  return value !== null && (PAGE_VIEWS as readonly string[]).includes(value);
}

function isEditTab(value: string | null): value is (typeof EDIT_TABS)[number] {
  return value !== null && (EDIT_TABS as readonly string[]).includes(value);
}

function getModelShort(model: string | null | undefined): string {
  if (!model || !model.trim()) return "Unknown";
  if (model.includes("opus"))   return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku"))  return "Haiku";
  return model.split("/").pop()?.split("-").slice(0, 2).join(" ") || model;
}

function getExecutorBadge(agent: Agent): string | null {
  const cfg = agent.config;
  if (!cfg || typeof cfg !== "object") return null;
  const executor = (cfg as { executor?: unknown }).executor;
  if (executor === "codex-cli") return "Codex CLI";
  if (executor === "gemini-cli") return "Gemini CLI";
  if (executor === "claude-code") return "Claude Code";
  return null;
}

export default function Agents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [status, setStatus] = useState<{
    hasAnthropicKey: boolean;
    hasOpenRouterKey: boolean;
    ollama: { available: boolean; modelLoaded: boolean };
  } | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [pageView, setPageView] = useState(() => {
    const value = searchParams.get("view");
    return isPageView(value) ? value : "agents";
  });

  // Soul state
  const [soulContent, setSoulContent] = useState<string>("");
  const [soulOpen, setSoulOpen] = useState(false);
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulValidation, setSoulValidation] = useState<SoulValidation | null>(null);
  const [agentSoulContent, setAgentSoulContent] = useState<string>("");
  const [agentSoulSaving, setAgentSoulSaving] = useState(false);
  const [agentSoulLoading, setAgentSoulLoading] = useState(false);
  const [agentSoulError, setAgentSoulError] = useState("");
  const [agentSoulValidation, setAgentSoulValidation] = useState<SoulValidation | null>(null);
  const [agentSoulVersions, setAgentSoulVersions] = useState<SoulVersion[]>([]);
  const [agentSoulRollout, setAgentSoulRollout] = useState<SoulRollout | null>(null);
  const [agentSoulVersionsLoading, setAgentSoulVersionsLoading] = useState(false);
  const [agentSoulRollbackBusy, setAgentSoulRollbackBusy] = useState(false);

  // Edit modal state
  const [editingSkills, setEditingSkills] = useState<Set<string>>(new Set());
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [utilityModel, setUtilityModel] = useState<string>("");
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [editTab, setEditTab] = useState("prompt");
  const [availableModels, setAvailableModels] = useState<AvailableModels | null>(null);
  const closingModalRef = useRef(false);

  const fetchAgents = useCallback(() =>
    fetch("/api/agents").then((r) => r.json()).then((d) => setAgents(d.agents || [])), []);

  useEffect(() => {
    Promise.all([
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/status").then((r) => r.json()),
      fetch("/api/soul").then((r) => r.json()).catch(() => ({ content: "" })),
      fetch("/api/settings/model-routes").then((r) => r.json()).catch(() => ({ routes: [] })),
      fetch("/api/settings/models").then((r) => r.json()).catch(() => ({ available: null })),
    ]).then(([agentsData, statusData, soulData, routesData, modelsData]) => {
      setAgents(agentsData.agents || []);
      setStatus(statusData);
      setSoulContent(soulData.content || "");
      setSoulValidation((soulData.validation || null) as SoulValidation | null);
      const utilRoute = (routesData.routes || []).find((r: { task: string }) => r.task === "utility");
      if (utilRoute) setUtilityModel(utilRoute.model);
      if (modelsData.available) setAvailableModels(modelsData.available);
    });
  }, []);

  useEffect(() => {
    const current = searchParamsRef.current;
    const next = new URLSearchParams(current);
    if (pageView === "agents") next.delete("view");
    else next.set("view", pageView);

    if (next.toString() !== current.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [pageView, setSearchParams]);

  const openEditModal = useCallback((agent: Agent, tab: (typeof EDIT_TABS)[number] = "prompt") => {
    setEditingAgent(agent);
    setEditTab(tab);
    setSkillsDirty(false);
    setSkillsSaving(false);
    setAgentStats(null);

    if (agent.skills === null) {
      setEditingSkills(new Set());
    } else {
      setEditingSkills(new Set(agent.skills));
    }

    fetch(`/api/reports/costs/agent/${agent.id}?days=30`).then((r) => r.json()).then(setAgentStats).catch(() => {});
  }, []);

  const closeEditModal = useCallback(() => {
    closingModalRef.current = true;
    setEditingAgent(null);
    const current = searchParamsRef.current;
    const next = new URLSearchParams(current);
    next.delete("agent");
    next.delete("tab");
    if (next.toString() !== current.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [setSearchParams]);

  useEffect(() => {
    if (closingModalRef.current) {
      closingModalRef.current = false;
      return;
    }
    const requestedAgentId = searchParams.get("agent");
    if (!requestedAgentId) return;
    const agent = agents.find((item) => item.id === requestedAgentId);
    if (!agent) return;

    // Only open modal from URL if not already open for this agent
    if (!editingAgent || editingAgent.id !== requestedAgentId) {
      const tabParam = searchParams.get("tab");
      const requestedTab = isEditTab(tabParam) ? tabParam : null;
      openEditModal(agent, requestedTab || "prompt");
    }
  }, [agents, editingAgent, openEditModal, searchParams]);

  useEffect(() => {
    if (!editingAgent) return;
    const current = searchParamsRef.current;
    const next = new URLSearchParams(current);
    next.set("agent", editingAgent.id);
    if (editTab === "prompt") next.delete("tab");
    else next.set("tab", editTab);
    if (next.toString() !== current.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [editingAgent, editTab, setSearchParams]);

  useEffect(() => {
    if (!editingAgent) return;
    let active = true;
    setAgentSoulLoading(true);
    setAgentSoulVersionsLoading(true);
    setAgentSoulSaving(false);
    setAgentSoulRollbackBusy(false);
    setAgentSoulError("");
    setAgentSoulRollout(null);

    fetch(`/api/soul/${encodeURIComponent(editingAgent.id)}`)
      .then(async (soulResponse) => {
        const soulPayload = await soulResponse.json().catch(() => ({} as {
          error?: string;
          content?: string;
          validation?: SoulValidation;
          activeRollout?: SoulRollout | null;
        }));
        if (!soulResponse.ok) {
          throw new Error(soulPayload.error || "Failed to load agent soul document.");
        }
        if (!active) return;
        setAgentSoulContent(soulPayload.content || "");
        setAgentSoulValidation((soulPayload.validation || null) as SoulValidation | null);
        setAgentSoulRollout((soulPayload.activeRollout || null) as SoulRollout | null);
      })
      .catch((error) => {
        if (!active) return;
        setAgentSoulContent("");
        setAgentSoulValidation(null);
        setAgentSoulRollout(null);
        setAgentSoulError(error instanceof Error ? error.message : "Failed to load agent soul document.");
      })
      .finally(() => {
        if (!active) return;
        setAgentSoulLoading(false);
      });

    fetch(`/api/soul/${encodeURIComponent(editingAgent.id)}/versions?limit=30`)
      .then(async (versionsResponse) => {
        const versionsPayload = await versionsResponse.json().catch(() => ({} as {
          error?: string;
          versions?: SoulVersion[];
          activeRollout?: SoulRollout | null;
        }));
        if (!versionsResponse.ok) {
          throw new Error(versionsPayload.error || "Failed to load soul version history.");
        }
        if (!active) return;
        setAgentSoulVersions(Array.isArray(versionsPayload.versions) ? versionsPayload.versions : []);
        setAgentSoulRollout((versionsPayload.activeRollout || null) as SoulRollout | null);
      })
      .catch((error) => {
        if (!active) return;
        setAgentSoulVersions([]);
        setAgentSoulError((prev) => prev || (error instanceof Error ? error.message : "Failed to load soul version history."));
      })
      .finally(() => {
        if (!active) return;
        setAgentSoulVersionsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [editingAgent?.id]);

  const handleSavePrompt = async (agentId: string, value: string) => {
    await fetch(`/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_prompt: value }),
    });
    await fetchAgents();
  };

  const handleImprovePrompt = async (agentId: string, value: string): Promise<string> => {
    const res = await fetch(`/api/agents/${agentId}/improve-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_prompt: value }),
    });
    const data = await res.json();
    return data.improved || value;
  };

  const handleSaveSkills = async () => {
    if (!editingAgent) return;
    setSkillsSaving(true);
    try {
      await fetch(`/api/agents/${editingAgent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: Array.from(editingSkills) }),
      });
      setSkillsDirty(false);
      await fetchAgents();
      const updated = await fetch("/api/agents").then((r) => r.json());
      const refreshed = (updated.agents || []).find((a: Agent) => a.id === editingAgent.id);
      if (refreshed) setEditingAgent(refreshed);
    } finally {
      setSkillsSaving(false);
    }
  };

  const handleSaveModel = async (agentId: string, model: string) => {
    await fetch(`/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    await fetchAgents();
    // Update editing agent reference
    const updated = await fetch("/api/agents").then((r) => r.json());
    const refreshed = (updated.agents || []).find((a: Agent) => a.id === agentId);
    if (refreshed) setEditingAgent(refreshed);
  };

  const handleSoulSave = async (value: string) => {
    setSoulSaving(true);
    try {
      const response = await fetch("/api/soul", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      const payload = await response.json().catch(() => ({} as { error?: string; content?: string; validation?: SoulValidation }));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save global soul document.");
      }
      setSoulContent(payload.content || `${value.trim()}\n`);
      setSoulValidation((payload.validation || null) as SoulValidation | null);
    } catch (error) {
      console.error("Failed to save global soul document:", error);
    } finally {
      setSoulSaving(false);
    }
  };

  const handleSaveAgentSoul = async (agentId: string, value: string) => {
    setAgentSoulSaving(true);
    setAgentSoulError("");
    try {
      const response = await fetch(`/api/soul/${encodeURIComponent(agentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      const payload = await response.json().catch(() => ({} as {
        error?: string;
        content?: string;
        validation?: SoulValidation;
      }));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save agent soul document.");
      }
      setAgentSoulContent(payload.content || value);
      setAgentSoulValidation((payload.validation || null) as SoulValidation | null);

      const versionsResponse = await fetch(`/api/soul/${encodeURIComponent(agentId)}/versions?limit=30`);
      const versionsPayload = await versionsResponse.json().catch(() => ({} as {
        versions?: SoulVersion[];
        activeRollout?: SoulRollout | null;
      }));
      if (versionsResponse.ok && Array.isArray(versionsPayload.versions)) {
        setAgentSoulVersions(versionsPayload.versions);
      }
      setAgentSoulRollout((versionsPayload.activeRollout || null) as SoulRollout | null);
    } catch (error) {
      setAgentSoulError(error instanceof Error ? error.message : "Failed to save agent soul document.");
    } finally {
      setAgentSoulSaving(false);
    }
  };

  const handleRollbackAgentSoul = async (agentId: string, versionId: string) => {
    setAgentSoulRollbackBusy(true);
    setAgentSoulError("");
    try {
      const response = await fetch(`/api/soul/${encodeURIComponent(agentId)}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const payload = await response.json().catch(() => ({} as {
        error?: string;
        version?: SoulVersion;
        validation?: SoulValidation;
      }));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to rollback soul version.");
      }

      if (payload.version?.content) {
        setAgentSoulContent(payload.version.content);
      }
      if (payload.validation) {
        setAgentSoulValidation(payload.validation);
      }

      const versionsResponse = await fetch(`/api/soul/${encodeURIComponent(agentId)}/versions?limit=30`);
      const versionsPayload = await versionsResponse.json().catch(() => ({} as {
        versions?: SoulVersion[];
        activeRollout?: SoulRollout | null;
      }));
      if (versionsResponse.ok && Array.isArray(versionsPayload.versions)) {
        setAgentSoulVersions(versionsPayload.versions);
      }
      setAgentSoulRollout((versionsPayload.activeRollout || null) as SoulRollout | null);
    } catch (error) {
      setAgentSoulError(error instanceof Error ? error.message : "Failed to rollback soul version.");
    } finally {
      setAgentSoulRollbackBusy(false);
    }
  };

  const activeCount = agents.filter((a) => a.enabled).length;
  const totalCount = agents.length;

  const providerDots = status ? (
    <span className="agents-providers">
      <StatusDot status={status.hasAnthropicKey ? "ok" : "muted"} />
      <span className={status.hasAnthropicKey ? "" : "text-muted"}>Anthropic</span>
      <StatusDot status={status.hasOpenRouterKey ? "ok" : "muted"} />
      <span className={status.hasOpenRouterKey ? "" : "text-muted"}>OpenRouter</span>
      <StatusDot status={status.ollama?.available ? "ok" : "muted"} />
      <span className={status.ollama?.available ? "" : "text-muted"}>Ollama</span>
    </span>
  ) : null;

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle={
          <MetaText className="text-md">
            {activeCount} active of {totalCount} configured
            {providerDots && <> &middot; {providerDots}</>}
          </MetaText>
        }
        actions={
          <button className="btn btn-secondary btn-sm" onClick={() => setSoulOpen(true)}>
            {"💎"} Default Soul
          </button>
        }
      />

      <PageBody gap={0}>
        <Tabs
          value={pageView}
          onValueChange={(value) => setPageView(value as (typeof PAGE_VIEWS)[number])}
          tabs={[
            {
              value: "agents",
              label: "Agents",
              content: (
                <AgentsView
                  agents={agents}
                  openEditModal={openEditModal}
                />
              ),
            },
            {
              value: "matrix",
              label: "Matrix",
              content: (
                <PermissionMatrix
                  agents={agents}
                  onAgentsChange={fetchAgents}
                />
              ),
            },
            {
              value: "skills",
              label: "Catalog",
              content: <SkillsBrowser />,
            },
            {
              value: "heartbeat",
              label: "Heartbeat",
              content: <HeartbeatDashboard />,
            },
          ]}
        />
      </PageBody>

      {/* Soul Modal */}
      <Modal open={soulOpen} onClose={() => setSoulOpen(false)} title="Default Soul Document" width={720}>
        <div className="agent-edit-modal">
          <MarkdownField
            value={soulContent}
            onSave={handleSoulSave}
            saving={soulSaving}
            maxHeight="600px"
            placeholder="No soul document found"
          />
          <SoulValidationPanel validation={soulValidation} />
        </div>
      </Modal>

      {/* Agent Edit Modal */}
      {editingAgent && (() => {
        const agentMeta = AGENT_META[editingAgent.id] || { icon: "🤖", color: "#6366f1" };
        return (
          <Modal
            open={!!editingAgent}
            onClose={closeEditModal}
            title={`${agentMeta.icon} ${editingAgent.name}`}
            width={800}
          >
            <div className="agent-edit-modal">
              <div className="agent-edit-meta">
                <span className="agent-edit-meta-item">
                  <span className="text-muted">ID</span>
                  <code>{editingAgent.id}</code>
                </span>
                <span className="agent-edit-meta-item">
                  <span className="text-muted">Model</span>
                  <ModelSelector
                    currentModel={editingAgent.model}
                    availableModels={availableModels}
                    onSave={(model) => handleSaveModel(editingAgent.id, model)}
                  />
                </span>
              </div>
              {editingAgent.description && (
                <p className="agent-edit-desc">{editingAgent.description}</p>
              )}

              <Tabs
                value={editTab}
                onValueChange={setEditTab}
                tabs={[
                  {
                    value: "prompt",
                    label: "Prompt",
                    content: (
                      <PromptTab
                        agent={editingAgent}
                        utilityModel={utilityModel}
                        onSave={handleSavePrompt}
                        onImprove={handleImprovePrompt}
                      />
                    ),
                  },
                  {
                    value: "skills",
                    label: "Tools",
                    content: (
                      <SkillsTab
                        agent={editingAgent}
                        editingSkills={editingSkills}
                        setEditingSkills={setEditingSkills}
                        skillsDirty={skillsDirty}
                        setSkillsDirty={setSkillsDirty}
                        skillsSaving={skillsSaving}
                        onSave={handleSaveSkills}
                      />
                    ),
                  },
                  {
                    value: "stats",
                    label: "Stats",
                    content: <StatsTab stats={agentStats} />,
                  },
                  {
                    value: "soul",
                    label: "Soul",
                    content: (
                      <SoulTab
                        agent={editingAgent}
                        content={agentSoulContent}
                        loading={agentSoulLoading}
                        saving={agentSoulSaving}
                        rollbackBusy={agentSoulRollbackBusy}
                        versionsLoading={agentSoulVersionsLoading}
                        validation={agentSoulValidation}
                        versions={agentSoulVersions}
                        rollout={agentSoulRollout}
                        error={agentSoulError}
                        onSave={(value) => handleSaveAgentSoul(editingAgent.id, value)}
                        onRollback={(versionId) => handleRollbackAgentSoul(editingAgent.id, versionId)}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </Modal>
        );
      })()}
    </>
  );
}

/* ── Agents View (unified list + card toggle) ── */

function AgentsView({ agents, openEditModal }: {
  agents: Agent[];
  openEditModal: (agent: Agent) => void;
}) {
  const columns: UnifiedListColumn<Agent>[] = [
    {
      key: "name",
      header: "Agent",
      render: (agent) => {
        const meta = AGENT_META[agent.id] || { icon: "🤖", category: "system" as const };
        return (
          <Row gap={2}>
            <span aria-hidden="true">{meta.icon}</span>
            <span className="text-primary font-semibold">{agent.name}</span>
            {!agent.enabled && <Badge status="error" className="text-xs">Off</Badge>}
          </Row>
        );
      },
      sortValue: (agent) => agent.name,
      className: "min-w-0",
      width: 260,
    },
    {
      key: "category",
      header: "Category",
      render: (agent) => {
        const category = AGENT_META[agent.id]?.category || "system";
        return CATEGORY_META[category]?.title || category;
      },
      sortValue: (agent) => CATEGORY_META[AGENT_META[agent.id]?.category || "system"]?.title || "System",
      width: 140,
    },
    {
      key: "model",
      header: "Model",
      render: (agent) => (
        <code>{getModelShort(agent.model)}</code>
      ),
      sortValue: (agent) => agent.model || "",
      width: 140,
    },
    {
      key: "skills",
      header: "Capabilities",
      render: (agent) => {
        if (agent.skills === null) return <Badge status="accent" className="text-xs">All Tools</Badge>;
        const capabilities = getCapabilities(agent.skills || []);
        const executorBadge = getExecutorBadge(agent);
        if (capabilities.length === 0) {
          if (executorBadge) {
            return <Badge status="warning" className="text-xs">{executorBadge}</Badge>;
          }
          return <MetaText size="xs">No capabilities</MetaText>;
        }
        return (
          <span className="text-secondary text-sm">
            {capabilities.slice(0, 2).join(" · ")}
            {capabilities.length > 2 && ` +${capabilities.length - 2}`}
          </span>
        );
      },
      sortValue: (agent) => agent.skills === null ? Number.MAX_SAFE_INTEGER : (agent.skills?.length || 0),
    },
    {
      key: "enabled",
      header: "Status",
      render: (agent) => (
        <Badge status={agent.enabled ? "success" : "muted"} className="text-xs">
          {agent.enabled ? "Active" : "Disabled"}
        </Badge>
      ),
      sortValue: (agent) => agent.enabled,
      width: 110,
      align: "center",
    },
    {
      key: "actions",
      header: "Actions",
      render: (agent) => (
        <Button
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            openEditModal(agent);
          }}
        >
          Edit
        </Button>
      ),
      width: 100,
      align: "right",
    },
  ];

  const searchFilter = (agent: Agent, query: string) => {
    return agent.name.toLowerCase().includes(query)
      || (agent.description?.toLowerCase().includes(query) ?? false)
      || agent.id.toLowerCase().includes(query)
      || (agent.model?.toLowerCase().includes(query) ?? false);
  };

  const renderCard = (agent: Agent) => {
    const agentMeta = AGENT_META[agent.id] || { icon: "🤖", color: "#6366f1" };
    const isAllTools = agent.skills === null;
    const executorBadge = getExecutorBadge(agent);
    const capabilities = isAllTools ? ["All Tools"] : getCapabilities(agent.skills || []);
    const capabilityChips = (!isAllTools && capabilities.length === 0 && executorBadge)
      ? [executorBadge]
      : capabilities;

    return (
      <div
        className={`agent-card ${!agent.enabled ? "agent-card-disabled" : ""}`}
        style={{ "--agent-color": agentMeta.color } as React.CSSProperties}
        onClick={() => openEditModal(agent)}
      >
        <div className="agent-card-header">
          <div className="agent-card-icon" style={{ background: `${agentMeta.color}1F` }}>
            {agentMeta.icon}
          </div>
          <div className="agent-card-title">
            <Row gap={2} className="agent-card-name">
              {agent.name}
              {!agent.enabled && <Badge status="error" className="text-xs">Off</Badge>}
            </Row>
            <span className="agent-card-model">{getModelShort(agent.model)}</span>
          </div>
        </div>

        <p className="agent-card-desc">
          {agent.description || "No description"}
        </p>

        {capabilityChips.length > 0 && (
          <div className="agent-card-capabilities">
            {capabilityChips.map((cap) => (
              <span key={cap} className={`agent-card-capability ${cap === "All Tools" ? "agent-card-capability-all" : ""}`}>{cap}</span>
            ))}
          </div>
        )}

        <div className="agent-card-footer">
          <span className="agent-card-skill-count">
            {isAllTools
              ? "All tools"
              : `${(agent.skills || []).length} tool${(agent.skills || []).length !== 1 ? "s" : ""}${executorBadge ? ` · ${executorBadge}` : ""}`}
          </span>
          <button
            className="agent-card-edit"
            onClick={(e) => { e.stopPropagation(); openEditModal(agent); }}
          >
            Edit
          </button>
        </div>
      </div>
    );
  };

  return (
    <ListPage
      items={agents}
      columns={columns}
      renderCard={renderCard}
      rowKey={(agent) => agent.id}
      searchPlaceholder="Search agents..."
      searchFilter={searchFilter}
      defaultView="cards"
      viewStorageKey="agents"
      onRowClick={openEditModal}
      defaultSort={{ key: "name", direction: "asc" }}
      tableAriaLabel="Agents list"
      emptyMessage="No agents configured."
      emptyIcon="🤖"
      cardMinWidth={280}
      pageSize={50}
    />
  );
}

/* ── Model Selector ── */

function ModelSelector({ currentModel, availableModels, onSave }: {
  currentModel: string | null;
  availableModels: AvailableModels | null;
  onSave: (model: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const effectiveModel = (currentModel && currentModel.trim()) ? currentModel : "unknown/model";

  if (!availableModels) return <span>{getModelShort(effectiveModel)}</span>;

  const allModels: { id: string; name: string; provider: string }[] = [
    ...availableModels.anthropic.map((m) => ({ ...m, provider: "Anthropic" })),
    ...availableModels.openrouter.map((m) => ({ ...m, provider: "OpenRouter" })),
    ...availableModels.ollama.map((m) => ({ ...m, provider: "Ollama" })),
  ];

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    if (model === effectiveModel) return;
    setSaving(true);
    try {
      await onSave(model);
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      className="agent-model-select"
      value={effectiveModel}
      onChange={handleChange}
      disabled={saving}
    >
      {!allModels.some((m) => m.id === effectiveModel) && (
        <option value={effectiveModel}>{effectiveModel}</option>
      )}
      {(["Anthropic", "OpenRouter", "Ollama"] as const).map((provider) => {
        const models = allModels.filter((m) => m.provider === provider);
        if (!models.length) return null;
        return (
          <optgroup key={provider} label={provider}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/* ── Permission Matrix ── */

type CellState = "full" | "partial" | "none";

function getAgentCapabilityState(agent: Agent, capSkills: string[]): CellState {
  if (agent.skills === null) return "full";
  const agentSkills = new Set(agent.skills);
  const matched = capSkills.filter((s) => agentSkills.has(s)).length;
  if (matched === 0) return "none";
  if (matched === capSkills.length) return "full";
  return "partial";
}

function PermissionMatrix({ agents, onAgentsChange }: {
  agents: Agent[];
  onAgentsChange: () => Promise<void>;
}) {
  const capabilities = getAllCapabilities();
  const [optimistic, setOptimistic] = useState<Record<string, string[] | null>>({});

  const sortedAgents = CATEGORY_ORDER.flatMap((cat) =>
    agents.filter((a) => (AGENT_META[a.id]?.category || "system") === cat)
  );

  const getEffectiveSkills = (agent: Agent): string[] | null => {
    if (agent.id in optimistic) return optimistic[agent.id];
    return agent.skills;
  };

  const toggleCapability = async (agent: Agent, cap: string) => {
    const capSkills = CAPABILITY_TO_SKILLS[cap] || [];
    if (!capSkills.length) return;

    const currentSkills = getEffectiveSkills(agent);

    // If agent has all tools (null), switching to explicit mode minus this capability
    if (currentSkills === null) {
      const allSkills = Object.values(CAPABILITY_TO_SKILLS).flat();
      const newSkills = allSkills.filter((s) => !capSkills.includes(s));
      setOptimistic((prev) => ({ ...prev, [agent.id]: newSkills }));
      try {
        await fetch(`/api/agents/${agent.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: newSkills }),
        });
        await onAgentsChange();
      } finally {
        setOptimistic((prev) => { const n = { ...prev }; delete n[agent.id]; return n; });
      }
      return;
    }

    const agentSkills = new Set(currentSkills);
    const allOn = capSkills.every((s) => agentSkills.has(s));

    let newSkills: string[];
    if (allOn) {
      newSkills = currentSkills.filter((s) => !capSkills.includes(s));
    } else {
      newSkills = [...new Set([...currentSkills, ...capSkills])];
    }

    setOptimistic((prev) => ({ ...prev, [agent.id]: newSkills }));
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: newSkills }),
      });
      await onAgentsChange();
    } finally {
      setOptimistic((prev) => { const n = { ...prev }; delete n[agent.id]; return n; });
    }
  };

  // Determine category breaks for separator rows
  let lastCat = "";

  return (
    <div className="pm-wrapper">
      <table className="pm-table">
        <thead>
          <tr>
            <th className="pm-corner">Agent</th>
            {capabilities.map((cap) => (
              <th key={cap} className="pm-col-header">
                <span className="pm-col-label">{cap}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedAgents.map((agent) => {
            const meta = AGENT_META[agent.id] || { icon: "🤖", color: "#6366f1", category: "system" };
            const cat = meta.category;
            const showSep = cat !== lastCat;
            lastCat = cat;

            const effectiveAgent: Agent = agent.id in optimistic
              ? { ...agent, skills: optimistic[agent.id] }
              : agent;
            const isAll = effectiveAgent.skills === null;

            return [
              showSep && (
                <tr key={`sep-${cat}`} className="pm-separator-row">
                  <td colSpan={capabilities.length + 1}>
                    <span className="pm-separator-label">
                      {CATEGORY_META[cat]?.icon} {CATEGORY_META[cat]?.title || cat}
                    </span>
                  </td>
                </tr>
              ),
              <tr key={agent.id} className={`pm-row ${!agent.enabled ? "pm-row-disabled" : ""}`}>
                <td className="pm-agent-cell">
                  <span className="pm-agent-icon">{meta.icon}</span>
                  <span className="pm-agent-name">{agent.name}</span>
                  {isAll && <span className="pm-all-badge">ALL</span>}
                </td>
                {capabilities.map((cap) => {
                  const capSkills = CAPABILITY_TO_SKILLS[cap] || [];
                  const state = getAgentCapabilityState(effectiveAgent, capSkills);

                  return (
                    <td
                      key={cap}
                      className={`pm-cell pm-cell-${state}`}
                      onClick={() => toggleCapability(agent, cap)}
                      title={`${agent.name}: ${cap} (${state})`}
                    >
                      <span className="pm-dot">
                        {state === "full" ? "\u25CF" : state === "partial" ? "\u25D0" : "\u25CB"}
                      </span>
                    </td>
                  );
                })}
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Skills Browser (absorbed from Skills.tsx) ── */

interface SkillCatalogSummary {
  total: number;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
  byRuntime: Record<string, number>;
  byScope: Record<string, number>;
}

const SOURCE_BADGE: Record<string, { status: "success" | "warning" | "accent"; label: string }> = {
  bundled: { status: "success", label: "gateway" },
  "claude-code": { status: "accent", label: "claude" },
  gemini: { status: "accent", label: "gemini" },
  codex: { status: "warning", label: "codex" },
  "codex-project": { status: "warning", label: "codex-project" },
  "codex-system": { status: "warning", label: "codex-system" },
};

const KIND_BADGE: Record<string, { status: "success" | "warning" | "accent"; label: string }> = {
  tool: { status: "success", label: "tool" },
  instruction: { status: "accent", label: "skill" },
};

function SkillsBrowser() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [summary, setSummary] = useState<SkillCatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setSkills(data.skills || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error("Failed to load skills:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleToggle = async (id: string, enabled: boolean) => {
    await fetch(`/api/skills/${id}/toggle`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    fetchSkills();
  };

  const tools = skills.filter((s) => (s.kind || (s.source === "bundled" ? "tool" : "instruction")) === "tool");
  const claudeCode = skills.filter((s) => s.source === "claude-code");
  const geminiUser = skills.filter((s) => s.source === "gemini");
  const codexUser = skills.filter((s) => s.source === "codex");
  const codexProject = skills.filter((s) => s.source === "codex-project");
  const codexSystem = skills.filter((s) => s.source === "codex-system");
  const otherInstruction = skills.filter((s) => {
    const isInstruction = (s.kind || (s.source === "bundled" ? "tool" : "instruction")) === "instruction";
    return isInstruction && !["claude-code", "gemini", "codex", "codex-project", "codex-system"].includes(s.source);
  });

  if (loading) {
    return <div style={{ padding: "20px 0" }}><MetaText>Loading...</MetaText></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
      {summary && (
        <Card>
          <Row justify="between" align="start">
            <div>
              <MetaText size="xs">Catalog total</MetaText>
              <div className="text-xl font-semibold">{summary.total}</div>
            </div>
            <Row gap={1}>
              <Badge status="success">{summary.byKind.tool || 0} tools</Badge>
              <Badge status="accent">{summary.byKind.instruction || 0} skills</Badge>
              <Badge status="accent">{summary.byRuntime.gemini || 0} gemini</Badge>
              <Badge status="warning">{summary.byRuntime.codex || 0} codex</Badge>
              <Badge status="accent">{summary.byRuntime.claude || 0} claude</Badge>
            </Row>
          </Row>
        </Card>
      )}

      {tools.length > 0 && (
        <>
          <SectionLabel>
            Gateway Tools
            <MetaText size="xs" className="skills-label-hint">
              agent-permission primitives
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {tools.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {claudeCode.length > 0 && (
        <>
          <SectionLabel className={tools.length > 0 ? "mt-2" : ""}>
            Claude Instruction Skills
            <MetaText size="xs" className="skills-label-hint">
              ~/.claude/skills/
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {claudeCode.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {geminiUser.length > 0 && (
        <>
          <SectionLabel className={claudeCode.length > 0 || tools.length > 0 ? "mt-2" : ""}>
            Gemini Instruction Skills
            <MetaText size="xs" className="skills-label-hint">
              ~/.gemini/skills/
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {geminiUser.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {codexUser.length > 0 && (
        <>
          <SectionLabel className={claudeCode.length > 0 || geminiUser.length > 0 || tools.length > 0 ? "mt-2" : ""}>
            Codex User Skills
            <MetaText size="xs" className="skills-label-hint">
              ~/.codex/skills/
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {codexUser.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {codexProject.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Codex Project Skills
            <MetaText size="xs" className="skills-label-hint">
              ./.codex/skills/
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {codexProject.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {codexSystem.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Codex System Skills
            <MetaText size="xs" className="skills-label-hint">
              ~/.codex/skills/.system/
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {codexSystem.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {otherInstruction.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Other Instruction Skills
          </SectionLabel>
          <Stack gap={2}>
            {otherInstruction.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {skills.length === 0 && (
        <EmptyState
          icon="🧩"
          message="No tools or instruction skills found."
        />
      )}
    </div>
  );
}

function SkillCard({ skill, onToggle }: {
  skill: Skill;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kind = skill.kind || (skill.source === "bundled" ? "tool" : "instruction");
  const hasMarkdown = kind === "instruction" || Boolean(skill.path && skill.path.endsWith(".md"));
  const capability = kind === "tool" ? getToolCapability(skill.name) : undefined;
  const sourceBadge = SOURCE_BADGE[skill.source] || { status: "warning" as const, label: skill.source };
  const kindBadge = KIND_BADGE[kind] || { status: "warning" as const, label: kind };
  const canToggle = kind === "tool" && skill.source === "bundled";

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!hasMarkdown) return;
    if (content !== null) return;

    setContentLoading(true);
    setContentError(null);
    try {
      const params = new URLSearchParams();
      if (skill.source) params.set("source", skill.source);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}/content${suffix}`);
      if (!res.ok) {
        const data = await res.json();
        setContentError(data.error || "Not found");
      } else {
        const data = await res.json();
        setContent(data.content);
      }
    } catch {
      setContentError("Failed to load");
    } finally {
      setContentLoading(false);
    }
  };

  const handleSaveContent = async (value: string) => {
    setSaving(true);
    try {
      const params = new URLSearchParams();
      if (skill.source) params.set("source", skill.source);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}/content${suffix}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      if (res.ok) setContent(value);
    } finally {
      setSaving(false);
    }
  };

  const handleImproveContent = async (value: string): Promise<string> => {
    const res = await fetch("/api/skills/improve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: value }),
    });
    const data = await res.json();
    return data.improved || value;
  };

  return (
    <Card dimmed={!skill.enabled}>
      <Row justify="between">
        <div className="flex-1 min-w-0">
          <Row gap={2} className="mb-1">
            <code className="text-md font-semibold">{skill.name}</code>
            <Badge status={kindBadge.status}>{kindBadge.label}</Badge>
            <Badge status={sourceBadge.status}>{sourceBadge.label}</Badge>
            {capability && <Badge status="warning">{capability}</Badge>}
            {!skill.enabled && <Badge status="error">Disabled</Badge>}
          </Row>
          {skill.description && (
            <p className="text-secondary text-md m-0">
              {skill.description.length > 160 ? skill.description.slice(0, 160) + "..." : skill.description}
            </p>
          )}
        </div>
        <Row gap={1} className="flex-shrink-0">
          {hasMarkdown && (
            <Button
              size="sm"
              onClick={handleExpand}
              title={expanded ? "Hide SKILL.md" : "View SKILL.md"}
            >
              {expanded ? "Hide" : "Edit"}
            </Button>
          )}
          {canToggle && (
            <Button
              size="sm"
              onClick={() => onToggle(skill.id, skill.enabled)}
            >
              {skill.enabled ? "Disable" : "Enable"}
            </Button>
          )}
        </Row>
      </Row>

      {expanded && hasMarkdown && (
        <div className="skill-content-viewer mt-3">
          {contentLoading && (
            <MetaText size="xs">Loading SKILL.md...</MetaText>
          )}
          {contentError && (
            <MetaText size="xs" className="italic">{contentError}</MetaText>
          )}
          {content !== null && (
            <MarkdownField
              value={content}
              onSave={handleSaveContent}
              onImprove={handleImproveContent}
              saving={saving}
              maxHeight="400px"
              placeholder="Empty SKILL.md"
            />
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Sub-components (modal tabs) ── */

function PromptTab({ agent, utilityModel, onSave, onImprove }: {
  agent: Agent;
  utilityModel: string;
  onSave: (id: string, val: string) => Promise<void>;
  onImprove: (id: string, val: string) => Promise<string>;
}) {
  return (
    <div className="agent-prompt-section">
      {agent.system_prompt ? (
        <>
          <MarkdownField
            value={agent.system_prompt}
            onSave={(val) => onSave(agent.id, val)}
            onImprove={(val) => onImprove(agent.id, val)}
            maxHeight="400px"
            placeholder="Empty prompt"
          />
          {utilityModel && (
            <div className="agent-improve-meta">
              Improve uses <strong>{getModelShort(utilityModel)}</strong>
              <span className="text-muted"> &middot; Configure under Utility route in </span>
              <a href="/settings" className="btn-link">Settings</a>
            </div>
          )}
        </>
      ) : (
        <div className="agent-prompt-fallback">
          No custom prompt &mdash; uses this agent&apos;s soul document fallback
        </div>
      )}
    </div>
  );
}

function SoulValidationPanel({ validation }: {
  validation: SoulValidation | null;
}) {
  if (!validation) return null;

  const scorePercent = Math.round((validation.score || 0) * 100);
  return (
    <Card className="agent-soul-validation-card">
      <Row gap={2} wrap className="mb-2">
        <Badge status={validation.valid ? "success" : "error"}>
          {validation.valid ? "Spec Compliant" : "Spec Issues"}
        </Badge>
        <Badge status="muted">Score {scorePercent}%</Badge>
        <Badge status="muted">{validation.wordCount} words</Badge>
      </Row>
      {validation.missingSections.length > 0 && (
        <MetaText size="xs" className="block">
          Missing sections: {validation.missingSections.join(", ")}
        </MetaText>
      )}
      {validation.issues.length > 0 && (
        <ul className="agent-soul-issue-list">
          {validation.issues.map((issue, index) => (
            <li key={`${issue}-${index}`}>{issue}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SoulTab({ agent, content, loading, saving, rollbackBusy, versionsLoading, validation, versions, rollout, error, onSave, onRollback }: {
  agent: Agent;
  content: string;
  loading: boolean;
  saving: boolean;
  rollbackBusy: boolean;
  versionsLoading: boolean;
  validation: SoulValidation | null;
  versions: SoulVersion[];
  rollout: SoulRollout | null;
  error: string;
  onSave: (value: string) => Promise<void>;
  onRollback: (versionId: string) => Promise<void>;
}) {
  const rolloutMetrics = rollout && typeof rollout.metrics === "object" && rollout.metrics
    ? rollout.metrics as Record<string, unknown>
    : null;
  const rolloutSampleSize = rolloutMetrics && typeof rolloutMetrics.sampleSize === "number"
    ? rolloutMetrics.sampleSize
    : null;

  if (loading) {
    return (
      <div className="agent-prompt-section">
        <MetaText size="xs">Loading soul document...</MetaText>
      </div>
    );
  }

  return (
    <div className="agent-prompt-section">
      <MarkdownField
        value={content}
        onSave={onSave}
        saving={saving}
        maxHeight="400px"
        placeholder={`No soul document found for ${agent.name}`}
      />
      <SoulValidationPanel validation={validation} />
      {rollout && (
        <Card className="agent-soul-version-card">
          <SectionLabel className="mb-2">Active Canary</SectionLabel>
          <Row gap={2} wrap className="mb-2">
            <Badge status="accent">Canary Active</Badge>
            <Badge status="muted">Traffic {rollout.traffic_percent}%</Badge>
            <Badge status="muted">
              Samples {rolloutSampleSize ?? 0}/{rollout.minimum_sample_size}
            </Badge>
          </Row>
          <MetaText size="xs" className="block">
            Started {new Date(rollout.started_at).toLocaleString()} · rollout {rollout.id.slice(0, 8)}
          </MetaText>
          {rollout.decision_reason && (
            <MetaText size="xs" className="block mt-1">
              {rollout.decision_reason}
            </MetaText>
          )}
        </Card>
      )}
      <div className="agent-improve-meta">
        This soul document is used when no custom prompt is set for this agent.
      </div>
      <Card className="agent-soul-version-card">
        <SectionLabel className="mb-2">Version History</SectionLabel>
        {versionsLoading ? (
          <MetaText size="xs">Loading version history...</MetaText>
        ) : versions.length === 0 ? (
          <MetaText size="xs">No soul versions found yet.</MetaText>
        ) : (
          <div className="agent-soul-version-list">
            {versions.map((version) => (
              <div key={version.id} className="agent-soul-version-item">
                <Row gap={2} wrap>
                  <Badge status={version.is_active ? "success" : "muted"}>
                    {version.is_active ? "Active" : "Historical"}
                  </Badge>
                  <Badge status={version.quality_status === "passed" ? "success" : version.quality_status === "failed" ? "error" : "muted"}>
                    QA {version.quality_status}
                  </Badge>
                  <MetaText size="xs">
                    {version.source} by {version.author} · {new Date(version.created_at).toLocaleString()}
                  </MetaText>
                  <span className="flex-1" />
                  {!version.is_active && (
                    <Button
                      size="sm"
                      disabled={rollbackBusy || saving}
                      onClick={() => {
                        if (!window.confirm("Rollback to this soul version?")) return;
                        void onRollback(version.id);
                      }}
                    >
                      {rollbackBusy ? "Rolling back..." : "Rollback"}
                    </Button>
                  )}
                </Row>
                <MetaText size="xs" className="block mt-1">
                  id {version.id.slice(0, 8)}
                  {version.review_id ? ` · review ${version.review_id.slice(0, 8)}` : ""}
                  {version.quality_run_id ? ` · qa run ${version.quality_run_id.slice(0, 8)}` : ""}
                </MetaText>
                {version.change_summary && (
                  <MetaText size="xs" className="block mt-1">
                    {version.change_summary}
                  </MetaText>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {error && <MetaText size="xs">{error}</MetaText>}
    </div>
  );
}

function SkillsTab({ agent, editingSkills, setEditingSkills, skillsDirty, setSkillsDirty, skillsSaving, onSave }: {
  agent: Agent;
  editingSkills: Set<string>;
  setEditingSkills: (s: Set<string>) => void;
  skillsDirty: boolean;
  setSkillsDirty: (d: boolean) => void;
  skillsSaving: boolean;
  onSave: () => Promise<void>;
}) {
  const isAllTools = agent.skills === null;
  const executorBadge = getExecutorBadge(agent);

  const groups: Record<string, string[]> = {};
  for (const [cap, tools] of Object.entries(CAPABILITY_TO_SKILLS)) {
    groups[cap] = [...tools].sort();
  }
  if (agent.skills) {
    for (const t of agent.skills) {
      if (CORE_TOOLS.has(t)) continue;
      const cap = getToolCapability(t) || "Other";
      if (!groups[cap]) groups[cap] = [];
      if (!groups[cap].includes(t)) groups[cap].push(t);
    }
  }

  const groupOrder = Object.keys(groups).sort();

  const toggleSkill = (tool: string) => {
    const next = new Set(editingSkills);
    if (next.has(tool)) next.delete(tool); else next.add(tool);
    setEditingSkills(next);
    setSkillsDirty(true);
  };

  const toggleGroup = (cap: string) => {
    const tools = groups[cap];
    if (!tools) return;
    const next = new Set(editingSkills);
    const allOn = tools.every((t) => next.has(t));
    for (const t of tools) {
      if (allOn) next.delete(t); else next.add(t);
    }
    setEditingSkills(next);
    setSkillsDirty(true);
  };

  return (
    <div className="skills-editor">
      {isAllTools && !skillsDirty && (
        <div className="skills-editor-notice">
          This agent has access to all tools. Toggling any tool off switches to explicit mode.
        </div>
      )}

      <div className="skills-editor-info">
        Core tools (memory, scheduling, system) are always available and not shown here.
        {executorBadge && ` Executor lane: ${executorBadge}.`}
      </div>

      {groupOrder.map((cap) => {
        const tools = groups[cap];
        if (!tools?.length) return null;
        const enabledCount = tools.filter((t) =>
          (isAllTools && !skillsDirty) ? true : editingSkills.has(t)
        ).length;

        return (
          <div key={cap} className="skills-group">
            <button className="skills-group-header" onClick={() => toggleGroup(cap)}>
              <span className="skills-group-name">{cap}</span>
              <span className="skills-group-badge">
                {enabledCount}/{tools.length}
              </span>
            </button>
            <div className="skills-group-items">
              {tools.map((tool) => (
                <label key={tool} className="skills-item">
                  <input
                    type="checkbox"
                    checked={(isAllTools && !skillsDirty) ? true : editingSkills.has(tool)}
                    onChange={() => toggleSkill(tool)}
                  />
                  <span className="skills-item-name">{tool.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {skillsDirty && (
        <div className="skills-save-bar">
          <span>{editingSkills.size} tools selected</span>
          <button className="btn btn-primary btn-sm" onClick={onSave} disabled={skillsSaving}>
            {skillsSaving ? "Saving..." : "Save Tools"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatsTab({ stats }: { stats: AgentStats | null }) {
  if (!stats) {
    return <div className="text-muted" style={{ padding: "20px 0", textAlign: "center" }}>Loading stats...</div>;
  }

  const { summary } = stats;
  const formatCost = (v: number) => v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
  const formatTokens = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);

  return (
    <div className="agent-stats-grid">
      <div className="agent-stats-card">
        <div className="agent-stats-value">{formatCost(summary.total_cost)}</div>
        <div className="agent-stats-label">Total Cost (30d)</div>
      </div>
      <div className="agent-stats-card">
        <div className="agent-stats-value">{summary.total_calls}</div>
        <div className="agent-stats-label">API Calls</div>
      </div>
      <div className="agent-stats-card">
        <div className="agent-stats-value">{formatTokens(Number(summary.total_input_tokens) + Number(summary.total_output_tokens))}</div>
        <div className="agent-stats-label">Total Tokens</div>
      </div>
      <div className="agent-stats-card">
        <div className="agent-stats-value">{summary.avg_latency_ms}ms</div>
        <div className="agent-stats-label">Avg Latency</div>
      </div>
    </div>
  );
}

/* ── Heartbeat Dashboard ── */

interface Heartbeat {
  agent_id: string;
  agent_name: string;
  status: string;
  current_task: string | null;
  progress: number | null;
  workload_summary: Record<string, number>;
  last_heartbeat_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface AgentTaskItem {
  id: string;
  agent_id: string;
  title: string;
  status: string;
  priority: number;
  progress: number;
  assigned_by: string | null;
  deadline: string | null;
  created_at: string;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "var(--text-secondary)",
  working: "var(--blue)",
  finished: "var(--green)",
  error: "var(--red)",
  stale: "var(--orange)",
};

function HeartbeatDashboard() {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [tasks, setTasks] = useState<AgentTaskItem[]>([]);
  const [taskFilter, setTaskFilter] = useState("all");

  const loadHeartbeats = useCallback(async () => {
    const res = await fetch("/api/agents/heartbeats");
    if (res.ok) {
      const data = await res.json();
      setHeartbeats(data.heartbeats || []);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    const params = taskFilter !== "all" ? `?status=${taskFilter}` : "";
    const res = await fetch(`/api/agents/tasks${params}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks || []);
    }
  }, [taskFilter]);

  useEffect(() => { loadHeartbeats(); loadTasks(); }, [loadHeartbeats, loadTasks]);
  useEffect(() => { const interval = setInterval(() => { loadHeartbeats(); loadTasks(); }, 15000); return () => clearInterval(interval); }, [loadHeartbeats, loadTasks]);

  const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <Stack gap={16}>
      {/* Agent Status Cards */}
      <div>
        <SectionLabel>Agent Status</SectionLabel>
        {heartbeats.length === 0 ? (
          <MetaText>No heartbeat data yet. Agents will report status when they start working.</MetaText>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {heartbeats.map((hb) => (
              <Card key={hb.agent_id} style={{ padding: 12 }}>
                <Row gap={8} style={{ marginBottom: 8 }}>
                  <StatusDot status={hb.status === "working" ? "running" : hb.status === "error" || hb.status === "stale" ? "error" : "muted"} />
                  <strong>{hb.agent_name}</strong>
                  <Badge status={hb.status === "working" ? "accent" : hb.status === "finished" ? "success" : hb.status === "error" ? "error" : hb.status === "stale" ? "warning" : "muted"}>
                    {hb.status}
                  </Badge>
                </Row>

                {hb.current_task && (
                  <MetaText style={{ display: "block", marginBottom: 4 }}>{hb.current_task}</MetaText>
                )}

                {hb.progress !== null && hb.progress > 0 && (
                  <div style={{ background: "var(--bg-secondary)", borderRadius: 4, height: 6, marginBottom: 6, overflow: "hidden" }}>
                    <div style={{ background: STATUS_COLORS[hb.status] || "var(--blue)", width: `${hb.progress * 100}%`, height: "100%", borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                )}

                {hb.error_message && (
                  <MetaText style={{ display: "block", color: "var(--red)", marginBottom: 4, fontSize: 12 }}>{hb.error_message}</MetaText>
                )}

                <Row gap={8}>
                  <MetaText>Last: {timeAgo(hb.last_heartbeat_at)}</MetaText>
                  {hb.workload_summary.pending !== undefined && (
                    <MetaText>{hb.workload_summary.pending}p / {hb.workload_summary.in_progress || 0}w / {hb.workload_summary.completed || 0}d</MetaText>
                  )}
                </Row>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Task List */}
      <div>
        <Row gap={8} style={{ marginBottom: 8 }}>
          <SectionLabel>Tasks</SectionLabel>
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} style={{ fontSize: 13, padding: "2px 8px" }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </Row>

        {tasks.length === 0 ? (
          <MetaText>No tasks found.</MetaText>
        ) : (
          <Stack gap={4}>
            {tasks.map((t) => (
              <Row key={t.id} gap={8} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                <Badge status={t.status === "completed" ? "success" : t.status === "failed" ? "error" : t.status === "in_progress" ? "accent" : "muted"}>
                  {t.status}
                </Badge>
                <div style={{ flex: 1 }}>
                  <strong>{t.title}</strong>
                  <MetaText> — {t.agent_id}</MetaText>
                </div>
                <MetaText>P{t.priority}</MetaText>
                {t.progress > 0 && t.progress < 1 && <MetaText>{Math.round(t.progress * 100)}%</MetaText>}
                {t.assigned_by && <MetaText>by {t.assigned_by}</MetaText>}
                <MetaText>{timeAgo(t.created_at)}</MetaText>
              </Row>
            ))}
          </Stack>
        )}
      </div>
    </Stack>
  );
}
