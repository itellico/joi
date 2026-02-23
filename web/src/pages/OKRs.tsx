import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterGroup,
  FormField,
  FormGrid,
  MetaText,
  Modal,
  PageHeader,
  PageBody,
  SearchInput,
  Stack,
  UnifiedList,
  ViewToggle,
} from "../components/ui";
import type { UnifiedListColumn } from "../components/ui";

// ─── Types ───

interface Collection {
  id: string;
  name: string;
  icon: string | null;
  schema: { name: string; type: string; options?: string[] }[];
}

interface StoreObject {
  id: string;
  collection_id: string;
  title: string;
  data: Record<string, unknown>;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  source_title: string;
  target_title: string;
}

interface Objective extends StoreObject {
  keyResults: KeyResult[];
  computedScore: number;
}

interface KeyResult extends StoreObject {
  checkIns: StoreObject[];
}

type BadgeStatus = "success" | "warning" | "error" | "accent" | "muted";

interface FlatKR {
  kr: KeyResult;
  objectiveTitle: string;
  objectiveIndex: number;
  krIndex: number;
  score: number;
}

interface Agent {
  id: string;
  name: string;
  enabled: boolean;
}

interface ObjForm {
  id: string | null;
  title: string;
  description: string;
  type: string;
  level: string;
  owner: string;
  status: string;
}

interface KRForm {
  id: string | null;
  objectiveId: string;
  title: string;
  metricType: string;
  unit: string;
  baseline: string;
  target: string;
  current: string;
  owner: string;
}

// ─── Helpers ───

function getCurrentPeriod(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${q} ${now.getFullYear()}`;
}

function yearFromPeriod(p: string): number {
  const parts = p.split(" ");
  return parseInt(parts.length > 1 ? parts[1] : parts[0]);
}

function scoreColor(score: number): string {
  if (score >= 0.7) return "var(--success)";
  if (score >= 0.4) return "var(--warning)";
  return "var(--error)";
}

function confidenceIcon(c: string): string {
  if (c === "high") return "\u2191";
  if (c === "low") return "\u2193";
  return "\u2194";
}

function confidenceColor(c: string): string {
  if (c === "high") return "var(--success)";
  if (c === "low") return "var(--error)";
  return "var(--warning)";
}

function statusToBadge(status: string): BadgeStatus {
  switch (status) {
    case "on_track":
    case "achieved":
    case "completed":
      return "success";
    case "at_risk":
      return "warning";
    case "behind":
      return "error";
    case "active":
      return "accent";
    default:
      return "muted";
  }
}

function typeToBadge(type: string): BadgeStatus {
  if (type === "aspirational") return "muted";
  return "accent";
}

function computeKRScore(kr: StoreObject): number {
  const d = kr.data;
  const metricType = d.metric_type as string;
  if (metricType === "binary") {
    return (d.status as string) === "achieved" ? 1.0 : 0.0;
  }
  const baseline = Number(d.baseline) || 0;
  const target = Number(d.target) || 0;
  const current = Number(d.current) || 0;
  if (target === baseline) return 0;
  return Math.max(0, Math.min(1, (current - baseline) / (target - baseline)));
}

function formatKRProgress(kr: KeyResult): string {
  const isBinary = (kr.data.metric_type as string) === "binary";
  if (isBinary) {
    return (kr.data.status as string) === "achieved" ? "Done" : "Not done";
  }
  return `${kr.data.current || 0}/${kr.data.target || 0} ${kr.data.unit || ""}`;
}

// ─── Score Bar ───

function ScoreBar({
  score,
  height = 8,
  width: barWidth,
  showLabel = true,
}: {
  score: number;
  height?: number;
  width?: number | string;
  showLabel?: boolean;
}) {
  const radius = height / 2;
  return (
    <div className="score-bar" style={{ width: barWidth }}>
      <div
        className="score-bar-track"
        style={{ height, borderRadius: radius }}
      >
        <div
          className="score-bar-fill"
          style={{
            width: `${Math.min(100, score * 100)}%`,
            borderRadius: radius,
            background: scoreColor(score),
          }}
        />
      </div>
      {showLabel && (
        <span className="score-bar-label" style={{ color: scoreColor(score) }}>
          {score.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// ─── Main Component ───

export default function OKRs() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [period, setPeriod] = useState(getCurrentPeriod);
  const [loading, setLoading] = useState(true);
  const [expandedObj, setExpandedObj] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "cards">(() => {
    const stored = localStorage.getItem("view-toggle:okrs");
    return stored === "list" ? "list" : "cards";
  });

  // Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ownerFilter, setOwnerFilter] = useState("All");

  // Unified modals
  const [objForm, setObjForm] = useState<ObjForm | null>(null);
  const [krForm, setKrForm] = useState<KRForm | null>(null);

  // ─── Period options ───

  const periodGroups = useMemo(() => {
    const now = new Date();
    const years = [now.getFullYear(), now.getFullYear() + 1];
    return years.map((year) => ({
      year,
      options: [
        ...[1, 2, 3, 4].map((q) => ({
          value: `Q${q} ${year}`,
          label: `Q${q} ${year}`,
        })),
        { value: String(year), label: `${year} (Annual)` },
      ],
    }));
  }, []);

  // ─── Owner choices ───

  const ownerChoices = useMemo(() => {
    const choices = ["Marcus"];
    agents
      .filter((a) => a.enabled)
      .forEach((a) => {
        if (!choices.includes(a.name)) choices.push(a.name);
      });
    return choices;
  }, [agents]);

  const ownerFilterOptions = useMemo(
    () => ["All", ...ownerChoices],
    [ownerChoices],
  );

  // ─── Find OKR collection IDs ───

  const objCollectionId = collections.find(
    (c) => c.name === "OKR Objectives",
  )?.id;
  const krCollectionId = collections.find(
    (c) => c.name === "OKR Key Results",
  )?.id;

  // ─── Data Fetching ───

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/store/collections");
      const data = await res.json();
      setCollections(data.collections || []);
    } catch (err) {
      console.error("Failed to load collections:", err);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  }, []);

  const fetchOKRs = useCallback(async () => {
    if (!objCollectionId || !krCollectionId) return;
    setLoading(true);
    try {
      // Fetch objectives for selected period
      const objRes = await fetch(
        `/api/store/objects?collection=${objCollectionId}&limit=100`,
      );
      const objData = await objRes.json();
      const allObjectives: StoreObject[] = (objData.objects || []).filter(
        (o: StoreObject) => o.data.quarter === period,
      );

      // Fetch all KRs
      const krRes = await fetch(
        `/api/store/objects?collection=${krCollectionId}&limit=500`,
      );
      const krData = await krRes.json();
      const allKRs: StoreObject[] = krData.objects || [];

      // Fetch relations for each objective to find linked KRs
      const objectivesWithKRs: Objective[] = await Promise.all(
        allObjectives.map(async (obj) => {
          const detailRes = await fetch(`/api/store/objects/${obj.id}`);
          const detail = await detailRes.json();
          const relations: Relation[] = detail.relations || [];

          // Find KRs linked to this objective via has_key_result
          const linkedKRIds = relations
            .filter(
              (r) =>
                r.relation === "has_key_result" && r.source_id === obj.id,
            )
            .map((r) => r.target_id);

          const keyResults: KeyResult[] = allKRs
            .filter((kr) => linkedKRIds.includes(kr.id))
            .map((kr) => ({ ...kr, checkIns: [] }));

          // Compute scores
          const krScores = keyResults.map((kr) => computeKRScore(kr));
          const computedScore =
            krScores.length > 0
              ? krScores.reduce((a, b) => a + b, 0) / krScores.length
              : 0;

          return { ...obj, keyResults, computedScore };
        }),
      );

      // Sort by status (active first), then by title
      objectivesWithKRs.sort((a, b) => {
        const statusOrder: Record<string, number> = {
          active: 0,
          draft: 1,
          completed: 2,
          cancelled: 3,
        };
        const sa = statusOrder[(a.data.status as string) || "draft"] ?? 1;
        const sb = statusOrder[(b.data.status as string) || "draft"] ?? 1;
        if (sa !== sb) return sa - sb;
        return a.title.localeCompare(b.title);
      });

      setObjectives(objectivesWithKRs);

      // Auto-expand all objectives
      setExpandedObj(new Set(objectivesWithKRs.map((o) => o.id)));
    } catch (err) {
      console.error("Failed to load OKRs:", err);
    } finally {
      setLoading(false);
    }
  }, [objCollectionId, krCollectionId, period]);

  useEffect(() => {
    fetchCollections();
    fetchAgents();
  }, [fetchCollections, fetchAgents]);

  useEffect(() => {
    if (objCollectionId && krCollectionId) {
      fetchOKRs();
    }
  }, [objCollectionId, krCollectionId, fetchOKRs]);

  // ─── Open modals ───

  const openNewObjective = () => {
    setObjForm({
      id: null,
      title: "",
      description: "",
      type: "committed",
      level: "personal",
      owner: "Marcus",
      status: "active",
    });
  };

  const openEditObjective = (obj: Objective) => {
    setObjForm({
      id: obj.id,
      title: obj.title,
      description: String(obj.data.description || ""),
      type: (obj.data.type as string) || "committed",
      level: (obj.data.level as string) || "personal",
      owner: (obj.data.owner as string) || "Marcus",
      status: (obj.data.status as string) || "active",
    });
  };

  const openNewKR = (objectiveId: string) => {
    setKrForm({
      id: null,
      objectiveId,
      title: "",
      metricType: "number",
      unit: "",
      baseline: "0",
      target: "",
      current: "0",
      owner: "Marcus",
    });
  };

  const openEditKR = (kr: KeyResult, objectiveId: string) => {
    setKrForm({
      id: kr.id,
      objectiveId,
      title: kr.title,
      metricType: (kr.data.metric_type as string) || "number",
      unit: (kr.data.unit as string) || "",
      baseline: String(kr.data.baseline ?? 0),
      target: String(kr.data.target ?? 0),
      current: String(kr.data.current ?? 0),
      owner: (kr.data.owner as string) || "Marcus",
    });
  };

  // ─── Actions ───

  const handleSaveObjective = async () => {
    if (!objForm || !objForm.title.trim() || !objCollectionId) return;
    try {
      if (objForm.id) {
        // Edit mode
        const obj = objectives.find((o) => o.id === objForm.id);
        if (!obj) return;
        await fetch(`/api/store/objects/${objForm.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: objForm.title,
            data: {
              ...obj.data,
              description: objForm.description,
              type: objForm.type,
              level: objForm.level,
              owner: objForm.owner,
              status: objForm.status,
            },
          }),
        });
      } else {
        // Create mode
        await fetch("/api/store/objects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collection_id: objCollectionId,
            title: objForm.title,
            data: {
              quarter: period,
              year: yearFromPeriod(period),
              type: objForm.type,
              level: objForm.level,
              status: "active",
              score: 0,
              owner: objForm.owner,
              description: objForm.description,
            },
            tags: [period.toLowerCase().replace(" ", "-"), objForm.type],
          }),
        });
      }
      setObjForm(null);
      fetchOKRs();
    } catch (err) {
      console.error("Failed to save objective:", err);
    }
  };

  const handleSaveKR = async () => {
    if (!krForm || !krForm.title.trim() || !krCollectionId) return;
    try {
      if (krForm.id) {
        // Edit mode
        const baseline = parseFloat(krForm.baseline) || 0;
        const target = parseFloat(krForm.target) || 0;
        const current = parseFloat(krForm.current) || 0;
        const newScore =
          target === baseline
            ? 0
            : Math.max(
                0,
                Math.min(1, (current - baseline) / (target - baseline)),
              );
        let newStatus = "on_track";
        if (newScore >= 1.0) newStatus = "achieved";
        else if (newScore < 0.4) newStatus = "behind";
        else if (newScore < 0.7) newStatus = "at_risk";

        // Preserve existing data fields
        let existingData: Record<string, unknown> = {};
        for (const obj of objectives) {
          const found = obj.keyResults.find((kr) => kr.id === krForm.id);
          if (found) {
            existingData = found.data;
            break;
          }
        }

        await fetch(`/api/store/objects/${krForm.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: krForm.title,
            data: {
              ...existingData,
              metric_type: krForm.metricType,
              unit: krForm.unit,
              baseline,
              target,
              current,
              owner: krForm.owner,
              score: Math.round(newScore * 100) / 100,
              status: newStatus,
            },
          }),
        });
      } else {
        // Create mode
        const krRes = await fetch("/api/store/objects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collection_id: krCollectionId,
            title: krForm.title,
            data: {
              metric_type: krForm.metricType,
              baseline: parseFloat(krForm.baseline) || 0,
              target: parseFloat(krForm.target) || 0,
              current: parseFloat(krForm.baseline) || 0,
              unit: krForm.unit,
              score: 0,
              confidence: "high",
              status: "on_track",
              owner: krForm.owner,
              data_source: "",
            },
          }),
        });
        const krData = await krRes.json();

        // Create relation: objective -> KR
        await fetch("/api/store/relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_id: krForm.objectiveId,
            target_id: krData.object.id,
            relation: "has_key_result",
          }),
        });
      }
      setKrForm(null);
      fetchOKRs();
    } catch (err) {
      console.error("Failed to save KR:", err);
    }
  };

  const handleArchiveObjective = async (objId: string) => {
    try {
      await fetch(`/api/store/objects/${objId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      const obj = objectives.find((o) => o.id === objId);
      if (obj) {
        await Promise.all(
          obj.keyResults.map((kr) =>
            fetch(`/api/store/objects/${kr.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "archived" }),
            }),
          ),
        );
      }
      setObjForm(null);
      fetchOKRs();
    } catch (err) {
      console.error("Failed to archive objective:", err);
    }
  };

  const handleArchiveKR = async (krId: string) => {
    try {
      await fetch(`/api/store/objects/${krId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      setKrForm(null);
      fetchOKRs();
    } catch (err) {
      console.error("Failed to archive KR:", err);
    }
  };

  const handleUpdateObjectiveScore = async (obj: Objective) => {
    try {
      await fetch(`/api/store/objects/${obj.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            ...obj.data,
            score: Math.round(obj.computedScore * 100) / 100,
          },
        }),
      });
    } catch {
      // silent — this is just a sync
    }
  };

  // Sync scores when they change
  useEffect(() => {
    for (const obj of objectives) {
      const storedScore = Number(obj.data.score) || 0;
      if (
        Math.abs(storedScore - obj.computedScore) > 0.01 &&
        obj.keyResults.length > 0
      ) {
        handleUpdateObjectiveScore(obj);
      }
    }
  }, [objectives]);

  // ─── Computed ───

  const overallScore =
    objectives.length > 0
      ? objectives.reduce((sum, o) => sum + o.computedScore, 0) /
        objectives.length
      : 0;

  const toggleExpanded = (id: string) => {
    setExpandedObj((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Filtering ───

  const filteredObjectives = useMemo(() => {
    let result = objectives;

    // Owner filter
    if (ownerFilter !== "All") {
      result = result.filter(
        (obj) => (obj.data.owner as string || "Marcus") === ownerFilter,
      );
    }

    // Search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (obj) =>
          obj.title.toLowerCase().includes(q) ||
          String(obj.data.description || "").toLowerCase().includes(q) ||
          obj.keyResults.some((kr) => kr.title.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [objectives, searchQuery, ownerFilter]);

  const flatKRs = useMemo(() => {
    const result: FlatKR[] = [];
    filteredObjectives.forEach((obj, oi) => {
      obj.keyResults.forEach((kr, ki) => {
        result.push({
          kr,
          objectiveTitle: obj.title,
          objectiveIndex: oi,
          krIndex: ki,
          score: computeKRScore(kr),
        });
      });
    });
    return result;
  }, [filteredObjectives]);

  const krColumns: UnifiedListColumn<FlatKR>[] = [
    {
      key: "objective",
      header: "Objective",
      render: (row) => (
        <MetaText size="xs" className="font-semibold">
          O{row.objectiveIndex + 1}: {row.objectiveTitle}
        </MetaText>
      ),
      sortValue: (row) => row.objectiveTitle,
      width: 260,
    },
    {
      key: "kr",
      header: "Key Result",
      render: (row) => (
        <span className="text-primary">
          KR{row.krIndex + 1}: {row.kr.title}
        </span>
      ),
      sortValue: (row) => row.kr.title,
    },
    {
      key: "progress",
      header: "Progress",
      render: (row) => formatKRProgress(row.kr),
      sortValue: (row) => row.score,
      width: 120,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const s = (row.kr.data.status as string) || "on_track";
        return <Badge status={statusToBadge(s)}>{s.replace("_", " ")}</Badge>;
      },
      sortValue: (row) => (row.kr.data.status as string) || "",
      width: 110,
      align: "center",
    },
    {
      key: "score",
      header: "Score",
      render: (row) => <ScoreBar score={row.score} height={6} />,
      sortValue: (row) => row.score,
      width: 140,
    },
  ];

  // ─── Render ───

  if (!objCollectionId || !krCollectionId) {
    return (
      <EmptyState
        message={loading ? "Loading..." : "OKR collections not found. Please create them first."}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="OKRs"
        actions={
          <Button variant="primary" size="sm" onClick={openNewObjective}>
            + New Objective
          </Button>
        }
      />

      <PageBody className="okr-page-body">
        {/* Overall score */}
        {objectives.length > 0 && (
          <div className="okr-overall-bar">
            <MetaText className="font-semibold">Overall</MetaText>
            <ScoreBar score={overallScore} height={10} width="240px" />
            <MetaText size="xs">
              {objectives.length} objective{objectives.length !== 1 ? "s" : ""}
            </MetaText>
          </div>
        )}

        <div className="list-page-toolbar">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search objectives and key results..."
            resultCount={searchQuery.trim() ? filteredObjectives.length : undefined}
          />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="okr-quarter-select"
          >
            {periodGroups.map((g) => (
              <optgroup key={g.year} label={String(g.year)}>
                {g.options.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <FilterGroup
            options={ownerFilterOptions}
            value={ownerFilter}
            onChange={(v) => setOwnerFilter(v as string)}
            labelFn={(o) => String(o)}
          />
          <div className="list-page-toolbar-right">
            <ViewToggle
              value={viewMode}
              onChange={(m) => setViewMode(m as "list" | "cards")}
              storageKey="okrs"
            />
          </div>
        </div>

        {loading ? (
          <EmptyState message="Loading OKRs..." />
        ) : filteredObjectives.length === 0 ? (
          <EmptyState
            message={searchQuery.trim() ? "No matching objectives" : `No objectives for ${period}`}
            action={
              !searchQuery.trim() ? (
                <Button variant="primary" onClick={openNewObjective}>
                  Create your first objective
                </Button>
              ) : undefined
            }
          />
        ) : viewMode === "list" ? (
          <UnifiedList
            items={flatKRs}
            columns={krColumns}
            rowKey={(row) => row.kr.id}
            emptyMessage="No key results found"
            tableAriaLabel="Key Results"
          />
        ) : (
          <Stack gap={4}>
            {filteredObjectives.map((obj, objIndex) => {
              const isExpanded = expandedObj.has(obj.id);
              const objType = (obj.data.type as string) || "committed";
              const objStatus = (obj.data.status as string) || "draft";
              const objOwner = (obj.data.owner as string) || "Marcus";

              return (
                <Card
                  key={obj.id}
                  className="okr-card"
                >
                  {/* Objective header */}
                  <div
                    onClick={() => toggleExpanded(obj.id)}
                    className={`okr-obj-header${isExpanded ? " okr-obj-header--expanded" : ""}`}
                  >
                    <MetaText size="xs" className="font-semibold okr-expand-icon">
                      {isExpanded ? "\u25BC" : "\u25B6"}
                    </MetaText>
                    <MetaText size="xs" className="font-semibold">
                      O{objIndex + 1}
                    </MetaText>
                    <span
                      className="okr-obj-title okr-obj-title--clickable"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditObjective(obj);
                      }}
                      title="Click to edit objective"
                    >
                      {obj.title}
                    </span>
                    {objOwner !== "Marcus" && (
                      <span className="okr-owner-badge">{objOwner}</span>
                    )}
                    <Badge status={typeToBadge(objType)}>
                      {objType === "aspirational"
                        ? "\u25CB aspirational"
                        : "\u25CF committed"}
                    </Badge>
                    <Badge status={statusToBadge(objStatus)}>
                      {objStatus}
                    </Badge>
                    <div className="okr-score-bar-sm">
                      <ScoreBar score={obj.computedScore} height={6} />
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="okr-obj-content">
                      {/* Description */}
                      {obj.data.description ? (
                        <div className="okr-obj-description">
                          {String(obj.data.description)}
                        </div>
                      ) : null}

                      {/* Key Results */}
                      {obj.keyResults.length === 0 ? (
                        <div className="okr-no-kr">
                          No key results yet
                        </div>
                      ) : (
                        <div className="okr-kr-list">
                          {obj.keyResults.map((kr, krIndex) => {
                            const krScore = computeKRScore(kr);
                            const krStatus = (kr.data.status as string) || "on_track";
                            const krConfidence = (kr.data.confidence as string) || "medium";

                            return (
                              <div key={kr.id} className="okr-kr-row">
                                <MetaText size="xs" className="font-semibold okr-kr-label">
                                  KR{krIndex + 1}
                                </MetaText>

                                <span className="okr-kr-title">
                                  {kr.title}
                                </span>

                                {/* Progress value */}
                                <div className="okr-kr-progress">
                                  <span className="okr-kr-value">
                                    {formatKRProgress(kr)}
                                  </span>
                                </div>

                                {/* Confidence */}
                                <span
                                  className="text-sm okr-confidence-icon"
                                  style={{ color: confidenceColor(krConfidence) }}
                                  title={`${krConfidence} confidence`}
                                >
                                  {confidenceIcon(krConfidence)}
                                </span>

                                <Badge status={statusToBadge(krStatus)}>
                                  {krStatus.replace("_", " ")}
                                </Badge>

                                <div className="okr-score-bar-xs">
                                  <ScoreBar
                                    score={krScore}
                                    height={6}
                                  />
                                </div>

                                <button
                                  className="okr-kr-edit-btn"
                                  onClick={() => openEditKR(kr, obj.id)}
                                  title="Edit key result"
                                >
                                  ✎
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Add KR button */}
                      <div className="okr-add-kr-area mt-2">
                        <button
                          onClick={() => openNewKR(obj.id)}
                          className="okr-add-kr-btn"
                        >
                          + Add Key Result
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </Stack>
        )}
      </PageBody>

      {/* ─── Objective Modal (create + edit) ─── */}
      <Modal
        open={objForm !== null}
        onClose={() => setObjForm(null)}
        title={objForm?.id ? "Edit Objective" : "New Objective"}
      >
        {objForm && (
          <Stack gap={3}>
            <FormField label="Title">
              <input
                type="text"
                value={objForm.title}
                onChange={(e) =>
                  setObjForm({ ...objForm, title: e.target.value })
                }
                placeholder="e.g., Ship JOI v1.0 to production"
                autoFocus
                onKeyDown={(e) =>
                  e.key === "Enter" && handleSaveObjective()
                }
              />
            </FormField>
            <FormField label="Description">
              <textarea
                value={objForm.description}
                onChange={(e) =>
                  setObjForm({ ...objForm, description: e.target.value })
                }
                placeholder="What does success look like?"
                rows={2}
                className="resize-vertical"
              />
            </FormField>
            <FormGrid>
              <FormField label="Type">
                <select
                  value={objForm.type}
                  onChange={(e) =>
                    setObjForm({ ...objForm, type: e.target.value })
                  }
                >
                  <option value="committed">Committed</option>
                  <option value="aspirational">Aspirational</option>
                </select>
              </FormField>
              <FormField label="Level">
                <select
                  value={objForm.level}
                  onChange={(e) =>
                    setObjForm({ ...objForm, level: e.target.value })
                  }
                >
                  <option value="personal">Personal</option>
                  <option value="project">Project</option>
                  <option value="company">Company</option>
                </select>
              </FormField>
            </FormGrid>
            <FormGrid>
              <FormField label="Owner">
                <select
                  value={objForm.owner}
                  onChange={(e) =>
                    setObjForm({ ...objForm, owner: e.target.value })
                  }
                >
                  {ownerChoices.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </FormField>
              {objForm.id && (
                <FormField label="Status">
                  <select
                    value={objForm.status}
                    onChange={(e) =>
                      setObjForm({ ...objForm, status: e.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </FormField>
              )}
            </FormGrid>
            {!objForm.id && (
              <MetaText size="xs" className="okr-meta-info">
                Period: <strong>{period}</strong>
              </MetaText>
            )}
            <div className="action-row mt-1">
              {objForm.id && (
                <Button
                  variant="ghost"
                  onClick={() => handleArchiveObjective(objForm.id!)}
                >
                  Archive
                </Button>
              )}
              <div style={{ flex: 1 }} />
              <Button onClick={() => setObjForm(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSaveObjective}
                disabled={!objForm.title.trim()}
              >
                {objForm.id ? "Save Changes" : "Create Objective"}
              </Button>
            </div>
          </Stack>
        )}
      </Modal>

      {/* ─── Key Result Modal (create + edit) ─── */}
      <Modal
        open={krForm !== null}
        onClose={() => setKrForm(null)}
        title={krForm?.id ? "Edit Key Result" : "New Key Result"}
      >
        {krForm && (
          <Stack gap={3}>
            <FormField label="Title">
              <input
                type="text"
                value={krForm.title}
                onChange={(e) =>
                  setKrForm({ ...krForm, title: e.target.value })
                }
                placeholder="e.g., Core API endpoints"
                autoFocus
                onKeyDown={(e) =>
                  e.key === "Enter" && handleSaveKR()
                }
              />
            </FormField>
            <FormGrid>
              <FormField label="Metric Type">
                <select
                  value={krForm.metricType}
                  onChange={(e) =>
                    setKrForm({ ...krForm, metricType: e.target.value })
                  }
                >
                  <option value="number">Number</option>
                  <option value="percentage">Percentage</option>
                  <option value="currency">Currency</option>
                  <option value="binary">Binary (yes/no)</option>
                </select>
              </FormField>
              <FormField label="Unit">
                <input
                  type="text"
                  value={krForm.unit}
                  onChange={(e) =>
                    setKrForm({ ...krForm, unit: e.target.value })
                  }
                  placeholder='e.g., "users", "%", "$"'
                />
              </FormField>
            </FormGrid>
            {krForm.metricType !== "binary" && (
              <FormGrid>
                <FormField label="Baseline">
                  <input
                    type="number"
                    value={krForm.baseline}
                    onChange={(e) =>
                      setKrForm({ ...krForm, baseline: e.target.value })
                    }
                  />
                </FormField>
                <FormField label="Target">
                  <input
                    type="number"
                    value={krForm.target}
                    onChange={(e) =>
                      setKrForm({ ...krForm, target: e.target.value })
                    }
                  />
                </FormField>
              </FormGrid>
            )}
            {krForm.id && krForm.metricType !== "binary" && (
              <FormField label="Current Value">
                <input
                  type="number"
                  value={krForm.current}
                  onChange={(e) =>
                    setKrForm({ ...krForm, current: e.target.value })
                  }
                />
              </FormField>
            )}
            <FormField label="Owner">
              <select
                value={krForm.owner}
                onChange={(e) =>
                  setKrForm({ ...krForm, owner: e.target.value })
                }
              >
                {ownerChoices.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="action-row mt-1">
              {krForm.id && (
                <Button
                  variant="ghost"
                  onClick={() => handleArchiveKR(krForm.id!)}
                >
                  Archive
                </Button>
              )}
              <div style={{ flex: 1 }} />
              <Button onClick={() => setKrForm(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSaveKR}
                disabled={!krForm.title.trim()}
              >
                {krForm.id ? "Save Changes" : "Create Key Result"}
              </Button>
            </div>
          </Stack>
        )}
      </Modal>
    </>
  );
}
