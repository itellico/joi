import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, DataTable, MetaText, Switch } from "../../components/ui";

type HumanizerStage =
  | "tool_announcement"
  | "pre_tool_start"
  | "pre_tool_progress"
  | "tool_start"
  | "tool_progress"
  | "tool_long"
  | "chat_streaming";

type HumanizerChannel = "any" | "voice" | "chat";

interface HumanizerProfile {
  id: string;
  enabled: boolean;
  avoidRepeatWindow: number;
  emojiProbability: number;
  allowEmojisInChat: boolean;
  maxEmojis: number;
  config: Record<string, unknown>;
}

interface HumanizerOverview {
  generatedAt: string;
  inventory: {
    agents: number;
    enabledAgents: number;
    gatewaySkills: number;
    externalSkills: number;
    cronJobs: number;
  };
  templates: {
    total: number;
    enabled: number;
    emojiEnabled: number;
    byStage: Record<string, number>;
    byLanguage: Record<string, number>;
    byChannel: Record<string, number>;
  };
  coverage: {
    agentsWithCustomTemplates: number;
    agentsWithCustomTemplatesPercent: number;
    skillsWithCustomTemplates: number;
    skillsWithCustomTemplatesPercent: number;
  };
  events7d: {
    total: number;
    uniqueOutputs: number;
    uniquenessPercent: number;
    byStage: Record<string, number>;
    topRepeatedOutputs: Array<{ text: string; count: number }>;
  };
  profile: HumanizerProfile;
}

interface HumanizerTemplate {
  id: string;
  name: string | null;
  stage: HumanizerStage;
  channel: HumanizerChannel;
  language: string;
  agent_id: string | null;
  skill_name: string | null;
  tool_pattern: string | null;
  template: string;
  weight: number;
  allow_emoji: boolean;
  enabled: boolean;
  metadata: unknown;
  created_at?: string;
}

interface TemplateEditState {
  enabled: boolean;
  allowEmoji: boolean;
  weight: number;
}

const STAGE_OPTIONS: Array<{ value: "all" | HumanizerStage; label: string }> = [
  { value: "all", label: "All stages" },
  { value: "tool_announcement", label: "Tool Announcement" },
  { value: "chat_streaming", label: "Chat Streaming" },
  { value: "pre_tool_start", label: "Pre-tool Start" },
  { value: "pre_tool_progress", label: "Pre-tool Progress" },
  { value: "tool_start", label: "Tool Start" },
  { value: "tool_progress", label: "Tool Progress" },
  { value: "tool_long", label: "Tool Long" },
];

const CHANNEL_OPTIONS: Array<{ value: "all" | HumanizerChannel; label: string }> = [
  { value: "all", label: "All channels" },
  { value: "chat", label: "Chat" },
  { value: "voice", label: "Voice" },
  { value: "any", label: "Any" },
];

const LANGUAGE_OPTIONS = [
  { value: "all", label: "All languages" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
];

function normalizeProfileDraft(profile: HumanizerProfile): HumanizerProfile {
  return {
    ...profile,
    avoidRepeatWindow: Math.max(0, Math.min(50, Math.floor(profile.avoidRepeatWindow || 0))),
    emojiProbability: Math.max(0, Math.min(1, Number(profile.emojiProbability || 0))),
    maxEmojis: Math.max(0, Math.min(5, Math.floor(profile.maxEmojis || 0))),
  };
}

function formatStage(stage: HumanizerStage): string {
  return stage
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export default function HumanizerTab() {
  const [summary, setSummary] = useState<string>("");
  const [overview, setOverview] = useState<HumanizerOverview | null>(null);
  const [profileDraft, setProfileDraft] = useState<HumanizerProfile | null>(null);
  const [templates, setTemplates] = useState<HumanizerTemplate[]>([]);
  const [templateEdits, setTemplateEdits] = useState<Record<string, TemplateEditState>>({});

  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [runningAudit, setRunningAudit] = useState(false);
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);

  const [stageFilter, setStageFilter] = useState<"all" | HumanizerStage>("all");
  const [channelFilter, setChannelFilter] = useState<"all" | HumanizerChannel>("all");
  const [languageFilter, setLanguageFilter] = useState("all");

  const [preview, setPreview] = useState({
    channel: "chat" as "chat" | "voice",
    stage: "chat_streaming" as HumanizerStage,
    language: "en",
    toolName: "",
    hint: "",
  });
  const [previewOutput, setPreviewOutput] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch("/api/humanizer/overview");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load overview");
      setOverview(data.overview || null);
      setSummary(typeof data.summary === "string" ? data.summary : "");
      if (data.overview?.profile) {
        setProfileDraft(normalizeProfileDraft(data.overview.profile));
      }
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const params = new URLSearchParams();
      if (stageFilter !== "all") params.set("stage", stageFilter);
      if (channelFilter !== "all") params.set("channel", channelFilter);
      if (languageFilter !== "all") params.set("language", languageFilter);

      const query = params.toString();
      const res = await fetch(`/api/humanizer/templates${query ? `?${query}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load templates");

      const nextTemplates: HumanizerTemplate[] = Array.isArray(data.templates) ? data.templates : [];
      setTemplates(nextTemplates);
      setTemplateEdits(
        Object.fromEntries(nextTemplates.map((row) => [row.id, {
          enabled: row.enabled,
          allowEmoji: row.allow_emoji,
          weight: row.weight,
        }])),
      );
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTemplates(false);
    }
  }, [channelFilter, languageFilter, stageFilter]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const profileChanged = useMemo(() => {
    if (!overview?.profile || !profileDraft) return false;
    return JSON.stringify(normalizeProfileDraft(profileDraft))
      !== JSON.stringify(normalizeProfileDraft(overview.profile));
  }, [overview?.profile, profileDraft]);

  const saveProfile = async () => {
    if (!profileDraft) return;
    setSavingProfile(true);
    try {
      const payload = normalizeProfileDraft(profileDraft);
      const res = await fetch("/api/humanizer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: payload.enabled,
          avoidRepeatWindow: payload.avoidRepeatWindow,
          emojiProbability: payload.emojiProbability,
          allowEmojisInChat: payload.allowEmojisInChat,
          maxEmojis: payload.maxEmojis,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save profile");
      await loadOverview();
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const runAudit = async () => {
    setRunningAudit(true);
    try {
      const res = await fetch("/api/humanizer/audit", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to run audit");
      setOverview(data.overview || null);
      setSummary(typeof data.summary === "string" ? data.summary : "");
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAudit(false);
    }
  };

  const saveTemplate = async (row: HumanizerTemplate) => {
    const edit = templateEdits[row.id];
    if (!edit) return;

    const patch: Record<string, unknown> = {};
    if (edit.enabled !== row.enabled) patch.enabled = edit.enabled;
    if (edit.allowEmoji !== row.allow_emoji) patch.allowEmoji = edit.allowEmoji;
    if (edit.weight !== row.weight) patch.weight = edit.weight;

    if (Object.keys(patch).length === 0) return;

    setSavingTemplateId(row.id);
    try {
      const res = await fetch(`/api/humanizer/templates/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save template");
      await Promise.all([loadTemplates(), loadOverview()]);
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTemplateId(null);
    }
  };

  const generatePreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/humanizer/filler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: preview.channel,
          stage: preview.stage,
          language: preview.language,
          toolName: preview.toolName || null,
          hint: preview.hint || null,
          allowEmoji: true,
          emitEvent: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate preview");
      setPreviewOutput(typeof data.filler === "string" ? data.filler : "");
      setErrorMessage("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const templateColumns = [
    {
      key: "scope",
      header: "Scope",
      render: (row: HumanizerTemplate) => (
        <div className="flex-col gap-1">
          <strong>{formatStage(row.stage)}</strong>
          <MetaText size="xs" className="text-base">
            {row.channel} · {row.language}
          </MetaText>
          {row.agent_id && <MetaText size="xs" className="text-base">Agent: {row.agent_id}</MetaText>}
          {row.skill_name && <MetaText size="xs" className="text-base">Skill: {row.skill_name}</MetaText>}
        </div>
      ),
    },
    {
      key: "matcher",
      header: "Tool Match",
      render: (row: HumanizerTemplate) => (
        <code style={{ fontSize: "12px" }}>{row.tool_pattern || "(default)"}</code>
      ),
    },
    {
      key: "template",
      header: "Template",
      render: (row: HumanizerTemplate) => (
        <span>{row.template}</span>
      ),
      width: "36%",
    },
    {
      key: "weight",
      header: "Weight",
      render: (row: HumanizerTemplate) => {
        const edit = templateEdits[row.id];
        return (
          <input
            type="number"
            min={1}
            value={edit?.weight ?? row.weight}
            onChange={(e) => {
              const nextWeight = Math.max(1, Math.floor(Number(e.target.value) || 1));
              setTemplateEdits((prev) => ({
                ...prev,
                [row.id]: {
                  enabled: prev[row.id]?.enabled ?? row.enabled,
                  allowEmoji: prev[row.id]?.allowEmoji ?? row.allow_emoji,
                  weight: nextWeight,
                },
              }));
            }}
            style={{ width: "88px" }}
          />
        );
      },
      align: "center" as const,
    },
    {
      key: "flags",
      header: "Flags",
      render: (row: HumanizerTemplate) => {
        const edit = templateEdits[row.id];
        return (
          <div className="flex-col gap-1">
            <Switch
              checked={edit?.enabled ?? row.enabled}
              onCheckedChange={(checked) => {
                setTemplateEdits((prev) => ({
                  ...prev,
                  [row.id]: {
                    enabled: checked,
                    allowEmoji: prev[row.id]?.allowEmoji ?? row.allow_emoji,
                    weight: prev[row.id]?.weight ?? row.weight,
                  },
                }));
              }}
              label="Enabled"
            />
            <Switch
              checked={edit?.allowEmoji ?? row.allow_emoji}
              onCheckedChange={(checked) => {
                setTemplateEdits((prev) => ({
                  ...prev,
                  [row.id]: {
                    enabled: prev[row.id]?.enabled ?? row.enabled,
                    allowEmoji: checked,
                    weight: prev[row.id]?.weight ?? row.weight,
                  },
                }));
              }}
              label="Emoji"
            />
          </div>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      render: (row: HumanizerTemplate) => {
        const edit = templateEdits[row.id];
        const changed = Boolean(edit)
          && (edit.enabled !== row.enabled || edit.allowEmoji !== row.allow_emoji || edit.weight !== row.weight);
        const saving = savingTemplateId === row.id;
        return (
          <Button
            size="sm"
            variant="primary"
            disabled={!changed || saving}
            onClick={() => { void saveTemplate(row); }}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        );
      },
      align: "center" as const,
    },
  ];

  return (
    <div className="flex-col gap-6">
      <Card>
        <div className="flex-row items-center justify-between gap-3 mb-2">
          <h3 className="mb-0">Humanizer Module</h3>
          <div className="flex-row gap-2">
            <Button size="sm" onClick={() => { void loadOverview(); void loadTemplates(); }}>
              Refresh
            </Button>
            <Button size="sm" variant="primary" onClick={runAudit} disabled={runningAudit}>
              {runningAudit ? "Auditing..." : "Run Audit"}
            </Button>
          </div>
        </div>
        <MetaText size="sm" className="block text-md">
          DB-driven variation engine for tool announcements and filler language across voice/chat.
        </MetaText>
        <MetaText size="xs" className="block text-base mt-1">
          {loadingOverview ? "Loading overview..." : (summary || "No summary yet")}
        </MetaText>
        {errorMessage && (
          <MetaText size="sm" className="block mt-2 text-error">{errorMessage}</MetaText>
        )}
      </Card>

      <Card>
        <h3 className="mb-3">Overview</h3>
        {!overview ? (
          <MetaText size="sm" className="text-md">No data available.</MetaText>
        ) : (
          <>
            <div className="flex-row gap-2 flex-wrap mb-3">
              <Badge status="accent">Agents: {overview.inventory.enabledAgents}/{overview.inventory.agents}</Badge>
              <Badge status="accent">Skills: {overview.inventory.gatewaySkills} + {overview.inventory.externalSkills} external</Badge>
              <Badge status="accent">Cron: {overview.inventory.cronJobs}</Badge>
              <Badge status="success">Templates: {overview.templates.enabled}/{overview.templates.total}</Badge>
              <Badge status="warning">Emoji Templates: {overview.templates.emojiEnabled}</Badge>
              <Badge status="accent">Events 7d: {overview.events7d.total}</Badge>
              <Badge status="accent">Uniqueness: {overview.events7d.uniquenessPercent}%</Badge>
            </div>

            <div className="settings-grid">
              <div className="settings-field">
                <label>Agent Coverage</label>
                <MetaText size="sm" className="text-md">
                  {overview.coverage.agentsWithCustomTemplates} agents ({overview.coverage.agentsWithCustomTemplatesPercent}%)
                </MetaText>
              </div>
              <div className="settings-field">
                <label>Skill Coverage</label>
                <MetaText size="sm" className="text-md">
                  {overview.coverage.skillsWithCustomTemplates} skills ({overview.coverage.skillsWithCustomTemplatesPercent}%)
                </MetaText>
              </div>
            </div>

            {overview.events7d.topRepeatedOutputs.length > 0 && (
              <div className="mt-3">
                <MetaText size="sm" className="block mb-2 text-md">Top repeated outputs (7d)</MetaText>
                <div className="flex-col gap-1">
                  {overview.events7d.topRepeatedOutputs.slice(0, 5).map((entry) => (
                    <MetaText key={`${entry.text}-${entry.count}`} size="xs" className="text-base">
                      {entry.count}× {entry.text}
                    </MetaText>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <h3 className="mb-3">Profile</h3>
        {!profileDraft ? (
          <MetaText size="sm" className="text-md">Loading profile...</MetaText>
        ) : (
          <>
            <div className="settings-grid mb-3">
              <div className="settings-field">
                <label>Enabled</label>
                <Switch
                  checked={profileDraft.enabled}
                  onCheckedChange={(checked) => setProfileDraft((prev) => (prev ? { ...prev, enabled: checked } : prev))}
                />
              </div>
              <div className="settings-field">
                <label>Allow emojis in chat</label>
                <Switch
                  checked={profileDraft.allowEmojisInChat}
                  onCheckedChange={(checked) => setProfileDraft((prev) => (prev ? { ...prev, allowEmojisInChat: checked } : prev))}
                />
              </div>
              <div className="settings-field">
                <label>Avoid repeat window</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={profileDraft.avoidRepeatWindow}
                  onChange={(e) => setProfileDraft((prev) => prev ? {
                    ...prev,
                    avoidRepeatWindow: Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))),
                  } : prev)}
                />
              </div>
              <div className="settings-field">
                <label>Max emojis</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={profileDraft.maxEmojis}
                  onChange={(e) => setProfileDraft((prev) => prev ? {
                    ...prev,
                    maxEmojis: Math.max(0, Math.min(5, Math.floor(Number(e.target.value) || 0))),
                  } : prev)}
                />
              </div>
              <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                <label>Emoji probability ({profileDraft.emojiProbability.toFixed(2)})</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={profileDraft.emojiProbability}
                  onChange={(e) => setProfileDraft((prev) => prev ? {
                    ...prev,
                    emojiProbability: Math.max(0, Math.min(1, Number(e.target.value) || 0)),
                  } : prev)}
                />
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={saveProfile} disabled={!profileChanged || savingProfile}>
              {savingProfile ? "Saving..." : profileChanged ? "Save Profile" : "Profile Saved"}
            </Button>
          </>
        )}
      </Card>

      <Card>
        <h3 className="mb-3">Template Catalog</h3>
        <div className="flex-row gap-2 flex-wrap mb-3">
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as "all" | HumanizerStage)}>
            {STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as "all" | HumanizerChannel)}>
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button size="sm" onClick={() => { void loadTemplates(); }}>Reload Templates</Button>
        </div>

        {loadingTemplates ? (
          <MetaText size="sm" className="text-md">Loading templates...</MetaText>
        ) : (
          <DataTable
            columns={templateColumns}
            data={templates}
            rowKey={(row) => row.id}
            emptyMessage="No templates found for current filters"
          />
        )}
      </Card>

      <Card>
        <h3 className="mb-3">Preview Generator</h3>
        <MetaText size="sm" className="block text-md mb-3">
          Test generated filler text before editing templates.
        </MetaText>
        <div className="settings-grid mb-3">
          <div className="settings-field">
            <label>Channel</label>
            <select
              value={preview.channel}
              onChange={(e) => setPreview((prev) => ({ ...prev, channel: e.target.value as "chat" | "voice" }))}
            >
              <option value="chat">Chat</option>
              <option value="voice">Voice</option>
            </select>
          </div>
          <div className="settings-field">
            <label>Stage</label>
            <select
              value={preview.stage}
              onChange={(e) => setPreview((prev) => ({ ...prev, stage: e.target.value as HumanizerStage }))}
            >
              {STAGE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <label>Language</label>
            <select
              value={preview.language}
              onChange={(e) => setPreview((prev) => ({ ...prev, language: e.target.value }))}
            >
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
          <div className="settings-field">
            <label>Tool name</label>
            <input
              type="text"
              placeholder="emby_search"
              value={preview.toolName}
              onChange={(e) => setPreview((prev) => ({ ...prev, toolName: e.target.value }))}
            />
          </div>
          <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
            <label>Hint</label>
            <input
              type="text"
              placeholder="Find sci-fi movies from 2024"
              value={preview.hint}
              onChange={(e) => setPreview((prev) => ({ ...prev, hint: e.target.value }))}
            />
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={generatePreview} disabled={previewLoading}>
          {previewLoading ? "Generating..." : "Generate Preview"}
        </Button>
        {previewOutput && (
          <MetaText size="sm" className="block mt-3 text-md">
            {previewOutput}
          </MetaText>
        )}
      </Card>
    </div>
  );
}
