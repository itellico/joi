import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import MarkdownField from "../components/MarkdownField";
import { Badge, Button, Card, EmptyState, ListPage, MetaText, Modal, PageBody, PageHeader, Row, SectionLabel, Stack, Tabs, type UnifiedListColumn } from "../components/ui";
import { ThingsStyleLaneBoard, type ThingsLaneSection } from "../components/tasks/ThingsStyleLaneBoard";
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

// AGENT_META is now imported from ../lib/agentMeta

const CATEGORY_META: Record<string, { title: string; subtitle: string; icon: string }> = {
  combined:   { title: "Combined Agents",  subtitle: "Multi-skill agents that orchestrate across platforms", icon: "🤖" },
  operations: { title: "Operations",       subtitle: "Automated accounting & invoice pipeline", icon: "⚙️" },
  system:     { title: "System",           subtitle: "Core assistant", icon: "💻" },
};

const CATEGORY_ORDER = ["combined", "operations", "system"];
const PAGE_VIEWS = ["agents", "matrix", "skills", "heartbeat"] as const;
const EDIT_TABS = ["prompt", "skills", "stats"] as const;

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
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [pageView, setPageView] = useState(() => {
    const value = searchParams.get("view");
    return isPageView(value) ? value : "agents";
  });

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
      fetch("/api/settings/model-routes").then((r) => r.json()).catch(() => ({ routes: [] })),
      fetch("/api/settings/models").then((r) => r.json()).catch(() => ({ available: null })),
    ]).then(([agentsData, routesData, modelsData]) => {
      setAgents(agentsData.agents || []);
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

  const activeCount = agents.filter((a) => a.enabled).length;
  const totalCount = agents.length;
  const viewSubtitle =
    pageView === "heartbeat"
      ? "Things-style JOI task lanes for Inbox, Codex, Gemini, and Claude."
      : pageView === "matrix"
        ? "Review and adjust capability permissions by agent."
        : pageView === "skills"
          ? "Manage executable tools and instruction skills with consistent filters."
          : "Click an agent to edit prompt, tool access, and model.";

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle={
          <MetaText className="text-md">
            {activeCount} active of {totalCount} configured
            {" · "}
            {viewSubtitle}
          </MetaText>
        }
        actions={
          undefined
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
              value: "skills",
              label: "Tools & Skills",
              content: <SkillsBrowser />,
            },
            {
              value: "matrix",
              label: "Permissions",
              content: (
                <PermissionMatrix
                  agents={agents}
                  onAgentsChange={fetchAgents}
                  onAgentOpen={openEditModal}
                />
              ),
            },
            {
              value: "heartbeat",
              label: "Agent Activity",
              content: <HeartbeatDashboard />,
            },
          ]}
        />
      </PageBody>

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
                    label: "Tools Access",
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
      key: "actions",
      header: "Actions",
      render: (agent) => (
        <Row gap={4}>
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              openEditModal(agent);
            }}
          >
            Edit
          </Button>
        </Row>
      ),
      width: 90,
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
          <Row gap={4}>
            <button
              className="agent-card-edit"
              onClick={(e) => { e.stopPropagation(); openEditModal(agent); }}
            >
              Edit
            </button>
          </Row>
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

function PermissionMatrix({ agents, onAgentsChange, onAgentOpen }: {
  agents: Agent[];
  onAgentsChange: () => Promise<void>;
  onAgentOpen: (agent: Agent) => void;
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
      <MetaText className="mb-2">
        Click a capability cell to allow/block tools. Click an agent name to open full edit modal.
      </MetaText>
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
                  <button
                    type="button"
                    className="pm-agent-open-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAgentOpen(agent);
                    }}
                    title={`Open ${agent.name}`}
                  >
                    {agent.name}
                  </button>
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
  const [filter, setFilter] = useState<"all" | "tools" | "claude" | "gemini" | "codex" | "other">("all");

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
  const codexAll = [...codexUser, ...codexProject, ...codexSystem];
  const otherInstruction = skills.filter((s) => {
    const isInstruction = (s.kind || (s.source === "bundled" ? "tool" : "instruction")) === "instruction";
    return isInstruction && !["claude-code", "gemini", "codex", "codex-project", "codex-system"].includes(s.source);
  });

  const showTools = filter === "all" || filter === "tools";
  const showClaude = filter === "all" || filter === "claude";
  const showGemini = filter === "all" || filter === "gemini";
  const showCodex = filter === "all" || filter === "codex";
  const showOther = filter === "all" || filter === "other";

  if (loading) {
    return <div style={{ padding: "20px 0" }}><MetaText>Loading...</MetaText></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
      <Card>
        <MetaText>
          <strong>Tool</strong> = executable gateway function (agent permissioned). <strong>Skill</strong> = instruction doc for Claude/Gemini/Codex runtimes (global catalog).
        </MetaText>
      </Card>
      {summary && (
        <Card>
          <Row justify="between" align="start">
            <div>
              <MetaText size="xs">Installed Entries</MetaText>
              <div className="text-xl font-semibold">{summary.total}</div>
            </div>
            <Row gap={1}>
              <Badge status="success">{summary.byKind.tool || 0} tools</Badge>
              <Badge status="accent">{summary.byKind.instruction || 0} skills</Badge>
              <Badge status="accent">{claudeCode.length} Claude</Badge>
              <Badge status="accent">{geminiUser.length} Gemini</Badge>
              <Badge status="warning">{codexAll.length} Codex</Badge>
            </Row>
          </Row>
          <Row gap={1} wrap className="mt-2">
            <Button size="sm" variant={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>All</Button>
            <Button size="sm" variant={filter === "tools" ? "primary" : "ghost"} onClick={() => setFilter("tools")}>Tools</Button>
            <Button size="sm" variant={filter === "claude" ? "primary" : "ghost"} onClick={() => setFilter("claude")}>Claude</Button>
            <Button size="sm" variant={filter === "gemini" ? "primary" : "ghost"} onClick={() => setFilter("gemini")}>Gemini</Button>
            <Button size="sm" variant={filter === "codex" ? "primary" : "ghost"} onClick={() => setFilter("codex")}>Codex</Button>
            <Button size="sm" variant={filter === "other" ? "primary" : "ghost"} onClick={() => setFilter("other")}>Other</Button>
          </Row>
        </Card>
      )}

      {showTools && tools.length > 0 && (
        <>
          <SectionLabel>
            Built-in Tools
            <MetaText size="xs" className="skills-label-hint">
              Runtime tools used by agents
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {tools.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {showClaude && claudeCode.length > 0 && (
        <>
          <SectionLabel className={tools.length > 0 ? "mt-2" : ""}>
            Claude Skills
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

      {showGemini && geminiUser.length > 0 && (
        <>
          <SectionLabel className={claudeCode.length > 0 || tools.length > 0 ? "mt-2" : ""}>
            Gemini Skills
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

      {showCodex && codexUser.length > 0 && (
        <>
          <SectionLabel className={claudeCode.length > 0 || geminiUser.length > 0 || tools.length > 0 ? "mt-2" : ""}>
            Codex Skills (User)
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

      {showCodex && codexProject.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Codex Skills (Project)
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

      {showCodex && codexSystem.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Codex Skills (System)
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

      {showOther && otherInstruction.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Other Skills
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
    <Card
      dimmed={!skill.enabled}
      onClick={hasMarkdown ? () => { void handleExpand(); } : undefined}
      role={hasMarkdown ? "button" : undefined}
      tabIndex={hasMarkdown ? 0 : undefined}
      onKeyDown={hasMarkdown ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void handleExpand();
        }
      } : undefined}
    >
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
              onClick={(event) => {
                event.stopPropagation();
                void handleExpand();
              }}
              title={expanded ? "Hide SKILL.md" : "View SKILL.md"}
            >
              {expanded ? "Hide" : "Open"}
            </Button>
          )}
          {canToggle && (
            <Button
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(skill.id, skill.enabled);
              }}
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
          No custom prompt set for this agent.
        </div>
      )}
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
        This tab controls per-agent tool permissions only.
        Instruction skills (Claude/Gemini/Codex) are global and managed in the Tools & Skills tab.
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

/* ── Agent Activity (Things style) ── */

interface ThingsTaskRecord {
  uuid: string;
  title: string;
  list: string;
  projectUuid: string | null;
  projectTitle: string | null;
  headingTitle: string | null;
  deadline: string | null;
  createdAt: string;
}

interface ThingsProjectRecord {
  uuid: string;
  title: string;
}

interface ThingsProjectHeadingRecord {
  uuid: string;
  title: string;
  projectUuid: string;
}

interface JoiTaskSection {
  heading: string;
  tasks: ThingsTaskRecord[];
}

const HIDDEN_JOI_HEADING_KEYS = new Set(["ideas"]);
const PREFERRED_JOI_HEADING_ORDER = ["Inbox", "Codex", "Gemini", "Claude"];

function normalizeHeadingKey(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function formatThingsListLabel(list: string | null | undefined): string {
  const normalized = String(list || "").trim().toLowerCase();
  if (!normalized) return "Anytime";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDeadlineLabel(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const diffDays = Math.round((date.getTime() - now.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 0) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function HeartbeatDashboard() {
  const [joiTaskSections, setJoiTaskSections] = useState<JoiTaskSection[]>([]);
  const [joiTasksLoading, setJoiTasksLoading] = useState(true);
  const [joiTasksError, setJoiTasksError] = useState<string | null>(null);

  const loadJoiTasks = useCallback(async () => {
    setJoiTasksLoading(true);
    setJoiTasksError(null);
    try {
      const [projectsRes, tasksRes] = await Promise.all([
        fetch("/api/tasks/projects"),
        fetch("/api/tasks"),
      ]);
      if (!projectsRes.ok || !tasksRes.ok) {
        throw new Error("Failed to load JOI project tasks.");
      }

      const projectsPayload = await projectsRes.json() as { projects?: ThingsProjectRecord[] };
      const joiProject = (projectsPayload.projects || []).find((project) => normalizeHeadingKey(project.title) === "joi");
      if (!joiProject) {
        setJoiTaskSections(PREFERRED_JOI_HEADING_ORDER.map((heading) => ({ heading, tasks: [] })));
        setJoiTasksError("Things project \"JOI\" not found.");
        return;
      }

      const [headingsRes, tasksPayload] = await Promise.all([
        fetch(`/api/tasks/projects/${encodeURIComponent(joiProject.uuid)}/headings`),
        tasksRes.json() as Promise<{ tasks?: Record<string, ThingsTaskRecord[]> }>,
      ]);

      const headingsPayload = headingsRes.ok
        ? await headingsRes.json() as { headings?: ThingsProjectHeadingRecord[] }
        : { headings: [] as ThingsProjectHeadingRecord[] };

      const orderedHeadings: string[] = [];
      const seen = new Set<string>();
      const registerHeading = (heading: string) => {
        const cleaned = heading.trim();
        const key = normalizeHeadingKey(cleaned);
        if (!key || HIDDEN_JOI_HEADING_KEYS.has(key) || seen.has(key)) return;
        seen.add(key);
        orderedHeadings.push(cleaned);
      };

      for (const preferred of PREFERRED_JOI_HEADING_ORDER) registerHeading(preferred);
      for (const heading of headingsPayload.headings || []) registerHeading(heading.title);

      const grouped = new Map<string, ThingsTaskRecord[]>();
      for (const heading of orderedHeadings) grouped.set(heading, []);

      const flatTasks = Object.values(tasksPayload.tasks || {}).flatMap((entry) => Array.isArray(entry) ? entry : []);
      for (const task of flatTasks) {
        const isJoiTask = task.projectUuid === joiProject.uuid || normalizeHeadingKey(task.projectTitle) === "joi";
        if (!isJoiTask) continue;

        const rawHeading = task.headingTitle?.trim() || "Inbox";
        const headingKey = normalizeHeadingKey(rawHeading);
        if (HIDDEN_JOI_HEADING_KEYS.has(headingKey)) continue;

        const lane = orderedHeadings.find((heading) => normalizeHeadingKey(heading) === headingKey) || rawHeading;
        if (!grouped.has(lane)) grouped.set(lane, []);
        grouped.get(lane)?.push(task);
      }

      const sortTasks = (a: ThingsTaskRecord, b: ThingsTaskRecord) => {
        const aDeadline = a.deadline ? new Date(`${a.deadline}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        const bDeadline = b.deadline ? new Date(`${b.deadline}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        if (aDeadline !== bDeadline) return aDeadline - bDeadline;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      };

      const sections = Array.from(grouped.entries()).map(([heading, tasks]) => ({
        heading,
        tasks: [...tasks].sort(sortTasks),
      }));

      setJoiTaskSections(sections);
    } catch (error) {
      setJoiTaskSections(PREFERRED_JOI_HEADING_ORDER.map((heading) => ({ heading, tasks: [] })));
      setJoiTasksError(error instanceof Error ? error.message : "Failed to load JOI tasks.");
    } finally {
      setJoiTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJoiTasks();
    const interval = setInterval(() => {
      void loadJoiTasks();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadJoiTasks]);

  return (
    <Stack gap={12}>
      <MetaText>
        JOI project lanes in Things style. Auto-updates every 15s.
      </MetaText>
      <MetaText size="xs">
        Lanes shown: Inbox, Codex, Gemini, Claude. Ideas is intentionally hidden.
      </MetaText>
      {joiTasksLoading ? (
        <MetaText>Loading JOI tasks…</MetaText>
      ) : (
        <ThingsStyleLaneBoard
          sections={joiTaskSections.map<ThingsLaneSection>((section) => ({
            heading: section.heading,
            tasks: section.tasks.map((task) => ({
              id: task.uuid,
              title: task.title,
              meta: [
                formatThingsListLabel(task.list),
                task.deadline ? formatDeadlineLabel(task.deadline) : "",
              ].filter(Boolean).join(" · "),
            })),
          }))}
        />
      )}
      {joiTasksError && (
        <MetaText size="xs" className="heartbeat-joi-error">{joiTasksError}</MetaText>
      )}
    </Stack>
  );
}
