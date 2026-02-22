import { useEffect, useState, useCallback } from "react";
import MarkdownField from "../components/MarkdownField";
import { Badge, Button, Card, EmptyState, MetaText, Modal, PageBody, PageHeader, Row, SectionLabel, Stack, StatusDot, Tabs } from "../components/ui";
import { getCapabilities, getAllCapabilities, CORE_TOOLS, CAPABILITY_TO_SKILLS, getToolCapability } from "../lib/agentCapabilities";

interface Agent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
  enabled: boolean;
  skills: string[] | null;
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
}

const AGENT_META: Record<string, { icon: string; color: string; category: "combined" | "operations" | "system" }> = {
  scout:    { icon: "🔭", color: "#3b82f6", category: "combined" },
  radar:    { icon: "📡", color: "#8b5cf6", category: "combined" },
  forge:    { icon: "🔥", color: "#f97316", category: "combined" },
  pulse:    { icon: "📈", color: "#10b981", category: "combined" },
  blitz:    { icon: "⚡", color: "#eab308", category: "combined" },
  hawk:     { icon: "🦅", color: "#ef4444", category: "combined" },
  bridge:   { icon: "🌉", color: "#06b6d4", category: "combined" },
  media:    { icon: "🎬", color: "#e879f9", category: "combined" },
  "skill-scout": { icon: "🧭", color: "#22d3ee", category: "system" },
  "knowledge-sync": { icon: "📚", color: "#a78bfa", category: "system" },
  "accounting-orchestrator": { icon: "📊", color: "#6366f1", category: "operations" },
  "invoice-collector":       { icon: "📥", color: "#14b8a6", category: "operations" },
  "invoice-processor":       { icon: "🔍", color: "#a855f7", category: "operations" },
  "bmd-uploader":            { icon: "📤", color: "#f59e0b", category: "operations" },
  "reconciliation":          { icon: "🔗", color: "#ec4899", category: "operations" },
  personal: { icon: "✨", color: "#6366f1", category: "system" },
};

const CATEGORY_META: Record<string, { title: string; subtitle: string; icon: string }> = {
  combined:   { title: "Combined Agents",  subtitle: "Multi-skill agents that orchestrate across platforms", icon: "🤖" },
  operations: { title: "Operations",       subtitle: "Automated accounting & invoice pipeline", icon: "⚙️" },
  system:     { title: "System",           subtitle: "Core assistant", icon: "💻" },
};

const CATEGORY_ORDER = ["combined", "operations", "system"];

function getModelShort(model: string): string {
  if (model.includes("opus"))   return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku"))  return "Haiku";
  return model.split("/").pop()?.split("-").slice(0, 2).join(" ") || model;
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [status, setStatus] = useState<{
    hasAnthropicKey: boolean;
    hasOpenRouterKey: boolean;
    ollama: { available: boolean; modelLoaded: boolean };
  } | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [pageView, setPageView] = useState("agents");

  // Soul state
  const [soulContent, setSoulContent] = useState<string>("");
  const [soulOpen, setSoulOpen] = useState(false);
  const [soulSaving, setSoulSaving] = useState(false);

  // Edit modal state
  const [editingSkills, setEditingSkills] = useState<Set<string>>(new Set());
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [utilityModel, setUtilityModel] = useState<string>("");
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [editTab, setEditTab] = useState("prompt");
  const [availableModels, setAvailableModels] = useState<AvailableModels | null>(null);

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
      const utilRoute = (routesData.routes || []).find((r: { task: string }) => r.task === "utility");
      if (utilRoute) setUtilityModel(utilRoute.model);
      if (modelsData.available) setAvailableModels(modelsData.available);
    });
  }, []);

  const openEditModal = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setEditTab("prompt");
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
      await fetch("/api/soul", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      setSoulContent(value);
    } finally {
      setSoulSaving(false);
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
            {"💎"} Soul
          </button>
        }
      />

      <PageBody gap={0}>
        <Tabs
          value={pageView}
          onValueChange={setPageView}
          tabs={[
            {
              value: "agents",
              label: "Agents",
              content: (
                <AgentsCardView
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
              label: "Skills",
              content: <SkillsBrowser />,
            },
          ]}
        />
      </PageBody>

      {/* Soul Modal */}
      <Modal open={soulOpen} onClose={() => setSoulOpen(false)} title="Soul Document" width={720}>
        <div className="agent-edit-modal">
          <MarkdownField
            value={soulContent}
            onSave={handleSoulSave}
            saving={soulSaving}
            maxHeight="600px"
            placeholder="No soul document found"
          />
        </div>
      </Modal>

      {/* Agent Edit Modal */}
      {editingAgent && (() => {
        const agentMeta = AGENT_META[editingAgent.id] || { icon: "🤖", color: "#6366f1" };
        return (
          <Modal
            open={!!editingAgent}
            onClose={() => setEditingAgent(null)}
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
                    label: "Skills",
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

/* ── Agents Card View ── */

function AgentsCardView({ agents, openEditModal }: {
  agents: Agent[];
  openEditModal: (agent: Agent) => void;
}) {
  const grouped = agents.reduce<Record<string, Agent[]>>((acc, agent) => {
    const cat = AGENT_META[agent.id]?.category || "system";
    (acc[cat] ||= []).push(agent);
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, paddingTop: 8 }}>
      {CATEGORY_ORDER.map((cat) => {
        const group = grouped[cat];
        if (!group?.length) return null;
        const meta = CATEGORY_META[cat];

        return (
          <div key={cat}>
            <div className="agents-category-header">
              <span className="agents-category-icon">{meta.icon}</span>
              <h3>{meta.title}</h3>
              <span className="agents-category-count">{group.length}</span>
              <MetaText size="sm">{meta.subtitle}</MetaText>
            </div>

            <div className={cat === "combined" ? "agents-grid-combined" : "agents-grid"}>
              {group.map((agent) => {
                const agentMeta = AGENT_META[agent.id] || { icon: "🤖", color: "#6366f1" };
                const isAllTools = agent.skills === null;
                const capabilities = isAllTools ? ["All Tools"] : getCapabilities(agent.skills || []);

                return (
                  <div
                    key={agent.id}
                    className={`agent-card ${!agent.enabled ? "agent-card-disabled" : ""}`}
                    style={{ "--agent-color": agentMeta.color } as React.CSSProperties}
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

                    {capabilities.length > 0 && (
                      <div className="agent-card-capabilities">
                        {capabilities.map((cap) => (
                          <span key={cap} className={`agent-card-capability ${cap === "All Tools" ? "agent-card-capability-all" : ""}`}>{cap}</span>
                        ))}
                      </div>
                    )}

                    <div className="agent-card-footer">
                      <span className="agent-card-skill-count">
                        {isAllTools ? "All tools" : `${(agent.skills || []).length} skill${(agent.skills || []).length !== 1 ? "s" : ""}`}
                      </span>
                      <button
                        className="agent-card-edit"
                        onClick={() => openEditModal(agent)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {agents.length === 0 && (
        <EmptyState icon="🤖" message="No agents configured." />
      )}
    </div>
  );
}

/* ── Model Selector ── */

function ModelSelector({ currentModel, availableModels, onSave }: {
  currentModel: string;
  availableModels: AvailableModels | null;
  onSave: (model: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  if (!availableModels) return <span>{getModelShort(currentModel)}</span>;

  const allModels: { id: string; name: string; provider: string }[] = [
    ...availableModels.anthropic.map((m) => ({ ...m, provider: "Anthropic" })),
    ...availableModels.openrouter.map((m) => ({ ...m, provider: "OpenRouter" })),
    ...availableModels.ollama.map((m) => ({ ...m, provider: "Ollama" })),
  ];

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    if (model === currentModel) return;
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
      value={currentModel}
      onChange={handleChange}
      disabled={saving}
    >
      {!allModels.some((m) => m.id === currentModel) && (
        <option value={currentModel}>{currentModel}</option>
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

const SOURCE_BADGE: Record<string, { status: "success" | "warning" | "accent"; label: string }> = {
  "claude-code": { status: "accent", label: "claude-code" },
  bundled: { status: "success", label: "gateway" },
};

function SkillsBrowser() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setSkills(data.skills || []);
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

  const claudeCode = skills.filter((s) => s.source === "claude-code");
  const bundled = skills.filter((s) => s.source === "bundled");
  const custom = skills.filter((s) => s.source !== "bundled" && s.source !== "claude-code");

  if (loading) {
    return <div style={{ padding: "20px 0" }}><MetaText>Loading...</MetaText></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
      {claudeCode.length > 0 && (
        <>
          <SectionLabel>
            Claude Code Skills
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

      {bundled.length > 0 && (
        <>
          <SectionLabel className={claudeCode.length > 0 ? "mt-2" : ""}>
            Gateway Tools
            <MetaText size="xs" className="skills-label-hint">
              {bundled.length} built-in
            </MetaText>
          </SectionLabel>
          <Stack gap={2}>
            {bundled.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {custom.length > 0 && (
        <>
          <SectionLabel className="mt-2">
            Custom Skills
          </SectionLabel>
          <Stack gap={2}>
            {custom.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onToggle={handleToggle} />
            ))}
          </Stack>
        </>
      )}

      {skills.length === 0 && (
        <EmptyState
          icon="🧩"
          message="No skills registered. Run a database migration to seed default skills."
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

  const hasMarkdown = skill.source === "claude-code" || (skill.path && skill.path.endsWith(".md"));

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
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}/content`);
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
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.name)}/content`, {
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

  const badge = SOURCE_BADGE[skill.source] || { status: "warning" as const, label: skill.source };

  return (
    <Card dimmed={!skill.enabled}>
      <Row justify="between">
        <div className="flex-1 min-w-0">
          <Row gap={2} className="mb-1">
            <code className="text-md font-semibold">{skill.name}</code>
            <Badge status={badge.status}>{badge.label}</Badge>
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
          {skill.source === "bundled" && (
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
          No custom prompt &mdash; uses <strong>soul.md</strong> default
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
          This agent has access to all tools. Toggling any skill off switches to explicit mode.
        </div>
      )}

      <div className="skills-editor-info">
        Core tools (memory, scheduling, system) are always available and not shown here.
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
          <span>{editingSkills.size} skills selected</span>
          <button className="btn btn-primary btn-sm" onClick={onSave} disabled={skillsSaving}>
            {skillsSaving ? "Saving..." : "Save Skills"}
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
