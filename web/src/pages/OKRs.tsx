import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
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

// ─── Helpers ───

const QUARTERS = ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"];

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
  const [quarter, setQuarter] = useState(QUARTERS[0]);
  const [loading, setLoading] = useState(true);
  const [expandedObj, setExpandedObj] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "cards">(() => {
    const stored = localStorage.getItem("view-toggle:okrs");
    return stored === "list" ? "list" : "cards";
  });

  // Modals
  const [showNewObjective, setShowNewObjective] = useState(false);
  const [showNewKR, setShowNewKR] = useState<string | null>(null); // objective ID
  const [editingKR, setEditingKR] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // New Objective form
  const [newObjTitle, setNewObjTitle] = useState("");
  const [newObjType, setNewObjType] = useState("committed");
  const [newObjLevel, setNewObjLevel] = useState("personal");
  const [newObjDesc, setNewObjDesc] = useState("");

  // New KR form
  const [newKRTitle, setNewKRTitle] = useState("");
  const [newKRMetricType, setNewKRMetricType] = useState("number");
  const [newKRBaseline, setNewKRBaseline] = useState("0");
  const [newKRTarget, setNewKRTarget] = useState("");
  const [newKRUnit, setNewKRUnit] = useState("");
  const [newKROwner, setNewKROwner] = useState("Marcus");

  // ─── Find OKR collection IDs ───

  const objCollectionId = collections.find(
    (c) => c.name === "OKR Objectives"
  )?.id;
  const krCollectionId = collections.find(
    (c) => c.name === "OKR Key Results"
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

  const fetchOKRs = useCallback(async () => {
    if (!objCollectionId || !krCollectionId) return;
    setLoading(true);
    try {
      // Fetch objectives for selected quarter
      const objRes = await fetch(
        `/api/store/objects?collection=${objCollectionId}&limit=100`
      );
      const objData = await objRes.json();
      const allObjectives: StoreObject[] = (objData.objects || []).filter(
        (o: StoreObject) => o.data.quarter === quarter
      );

      // Fetch all KRs
      const krRes = await fetch(
        `/api/store/objects?collection=${krCollectionId}&limit=500`
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
                r.relation === "has_key_result" && r.source_id === obj.id
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
        })
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
  }, [objCollectionId, krCollectionId, quarter]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  useEffect(() => {
    if (objCollectionId && krCollectionId) {
      fetchOKRs();
    }
  }, [objCollectionId, krCollectionId, fetchOKRs]);

  // ─── Actions ───

  const handleCreateObjective = async () => {
    if (!newObjTitle.trim() || !objCollectionId) return;
    try {
      await fetch("/api/store/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection_id: objCollectionId,
          title: newObjTitle,
          data: {
            quarter,
            year: parseInt(quarter.split(" ")[1]),
            type: newObjType,
            level: newObjLevel,
            status: "active",
            score: 0,
            owner: "Marcus",
            description: newObjDesc,
          },
          tags: [
            quarter.toLowerCase().replace(" ", "-"),
            newObjType,
          ],
        }),
      });
      setShowNewObjective(false);
      setNewObjTitle("");
      setNewObjType("committed");
      setNewObjLevel("personal");
      setNewObjDesc("");
      fetchOKRs();
    } catch (err) {
      console.error("Failed to create objective:", err);
    }
  };

  const handleCreateKR = async () => {
    if (!newKRTitle.trim() || !krCollectionId || !showNewKR) return;
    try {
      const krRes = await fetch("/api/store/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection_id: krCollectionId,
          title: newKRTitle,
          data: {
            metric_type: newKRMetricType,
            baseline: parseFloat(newKRBaseline) || 0,
            target: parseFloat(newKRTarget) || 0,
            current: parseFloat(newKRBaseline) || 0,
            unit: newKRUnit,
            score: 0,
            confidence: "high",
            status: "on_track",
            owner: newKROwner,
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
          source_id: showNewKR,
          target_id: krData.object.id,
          relation: "has_key_result",
        }),
      });

      setShowNewKR(null);
      setNewKRTitle("");
      setNewKRMetricType("number");
      setNewKRBaseline("0");
      setNewKRTarget("");
      setNewKRUnit("");
      setNewKROwner("Marcus");
      fetchOKRs();
    } catch (err) {
      console.error("Failed to create KR:", err);
    }
  };

  const handleUpdateKRValue = async (kr: KeyResult) => {
    const newCurrent = parseFloat(editValue);
    if (isNaN(newCurrent)) return;

    const baseline = Number(kr.data.baseline) || 0;
    const target = Number(kr.data.target) || 0;
    const newScore =
      target === baseline
        ? 0
        : Math.max(0, Math.min(1, (newCurrent - baseline) / (target - baseline)));

    // Determine status
    let newStatus = "on_track";
    if (newScore >= 1.0) newStatus = "achieved";
    else if (newScore < 0.4) newStatus = "behind";
    else if (newScore < 0.7) newStatus = "at_risk";

    try {
      await fetch(`/api/store/objects/${kr.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            ...kr.data,
            current: newCurrent,
            score: Math.round(newScore * 100) / 100,
            status: newStatus,
          },
        }),
      });
      setEditingKR(null);
      setEditValue("");
      fetchOKRs();
    } catch (err) {
      console.error("Failed to update KR:", err);
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
    const q = searchQuery.trim().toLowerCase();
    if (!q) return objectives;
    return objectives.filter(
      (obj) =>
        obj.title.toLowerCase().includes(q) ||
        String(obj.data.description || "").toLowerCase().includes(q) ||
        obj.keyResults.some((kr) => kr.title.toLowerCase().includes(q)),
    );
  }, [objectives, searchQuery]);

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

  const quarterSelector = (
    <select
      value={quarter}
      onChange={(e) => setQuarter(e.target.value)}
      className="okr-quarter-select"
    >
      {QUARTERS.map((q) => (
        <option key={q} value={q}>
          {q}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        title="OKRs"
        actions={
          <>
            {quarterSelector}
            <Button variant="primary" size="sm" onClick={() => setShowNewObjective(true)}>
              + New Objective
            </Button>
            <ViewToggle
              value={viewMode}
              onChange={(m) => {
                setViewMode(m);
                localStorage.setItem("view-toggle:okrs", m);
              }}
              storageKey="okrs"
            />
          </>
        }
      />

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

      <div className="list-page-toolbar" style={{ padding: "0 16px" }}>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search objectives and key results..."
          resultCount={searchQuery.trim() ? filteredObjectives.length : undefined}
          className="list-page-search"
        />
      </div>

      <PageBody className="okr-page-body">
        {loading ? (
          <EmptyState message="Loading OKRs..." />
        ) : filteredObjectives.length === 0 ? (
          <EmptyState
            message={searchQuery.trim() ? "No matching objectives" : `No objectives for ${quarter}`}
            action={
              !searchQuery.trim() ? (
                <Button variant="primary" onClick={() => setShowNewObjective(true)}>
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
                    <span className="okr-obj-title">
                      {obj.title}
                    </span>
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
                            const isBinary =
                              (kr.data.metric_type as string) === "binary";
                            const isEditing = editingKR === kr.id;
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
                                  {isEditing ? (
                                    <div className="flex-row gap-1">
                                      <input
                                        type="number"
                                        value={editValue}
                                        onChange={(e) =>
                                          setEditValue(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter")
                                            handleUpdateKRValue(kr);
                                          if (e.key === "Escape") {
                                            setEditingKR(null);
                                            setEditValue("");
                                          }
                                        }}
                                        autoFocus
                                        className="okr-inline-input"
                                      />
                                      <button
                                        onClick={() =>
                                          handleUpdateKRValue(kr)
                                        }
                                        className="okr-save-btn"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  ) : (
                                    <span
                                      onClick={() => {
                                        if (!isBinary) {
                                          setEditingKR(kr.id);
                                          setEditValue(
                                            String(
                                              kr.data.current || 0
                                            )
                                          );
                                        }
                                      }}
                                      className={`okr-kr-value${!isBinary ? " okr-kr-value--editable" : ""}`}
                                      title={
                                        isBinary
                                          ? undefined
                                          : "Click to update"
                                      }
                                    >
                                      {formatKRProgress(kr)}
                                    </span>
                                  )}
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
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Add KR button */}
                      <div className="okr-add-kr-area mt-2">
                        <button
                          onClick={() => setShowNewKR(obj.id)}
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

      {/* ─── New Objective Modal ─── */}
      <Modal
        open={showNewObjective}
        onClose={() => setShowNewObjective(false)}
        title="New Objective"
      >
        <Stack gap={3}>
          <FormField label="Title">
            <input
              type="text"
              value={newObjTitle}
              onChange={(e) => setNewObjTitle(e.target.value)}
              placeholder="e.g., Ship JOI v1.0 to production"
              autoFocus
              onKeyDown={(e) =>
                e.key === "Enter" && handleCreateObjective()
              }
            />
          </FormField>
          <FormField label="Description">
            <textarea
              value={newObjDesc}
              onChange={(e) => setNewObjDesc(e.target.value)}
              placeholder="What does success look like?"
              rows={2}
              className="resize-vertical"
            />
          </FormField>
          <FormGrid>
            <FormField label="Type">
              <select
                value={newObjType}
                onChange={(e) => setNewObjType(e.target.value)}
              >
                <option value="committed">Committed</option>
                <option value="aspirational">Aspirational</option>
              </select>
            </FormField>
            <FormField label="Level">
              <select
                value={newObjLevel}
                onChange={(e) => setNewObjLevel(e.target.value)}
              >
                <option value="personal">Personal</option>
                <option value="project">Project</option>
                <option value="company">Company</option>
              </select>
            </FormField>
          </FormGrid>
          <MetaText size="xs" className="okr-meta-info">
            Quarter: <strong>{quarter}</strong> &middot; Owner: <strong>Marcus</strong>
          </MetaText>
          <div className="action-row mt-1">
            <Button onClick={() => setShowNewObjective(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateObjective}
              disabled={!newObjTitle.trim()}
            >
              Create Objective
            </Button>
          </div>
        </Stack>
      </Modal>

      {/* ─── New Key Result Modal ─── */}
      <Modal
        open={showNewKR !== null}
        onClose={() => setShowNewKR(null)}
        title="New Key Result"
      >
        <Stack gap={3}>
          <FormField label="Title">
            <input
              type="text"
              value={newKRTitle}
              onChange={(e) => setNewKRTitle(e.target.value)}
              placeholder="e.g., Core API endpoints"
              autoFocus
              onKeyDown={(e) =>
                e.key === "Enter" && handleCreateKR()
              }
            />
          </FormField>
          <FormGrid>
            <FormField label="Metric Type">
              <select
                value={newKRMetricType}
                onChange={(e) =>
                  setNewKRMetricType(e.target.value)
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
                value={newKRUnit}
                onChange={(e) => setNewKRUnit(e.target.value)}
                placeholder='e.g., "users", "%", "$"'
              />
            </FormField>
          </FormGrid>
          {newKRMetricType !== "binary" && (
            <FormGrid>
              <FormField label="Baseline">
                <input
                  type="number"
                  value={newKRBaseline}
                  onChange={(e) =>
                    setNewKRBaseline(e.target.value)
                  }
                />
              </FormField>
              <FormField label="Target">
                <input
                  type="number"
                  value={newKRTarget}
                  onChange={(e) =>
                    setNewKRTarget(e.target.value)
                  }
                />
              </FormField>
            </FormGrid>
          )}
          <FormField label="Owner">
            <input
              type="text"
              value={newKROwner}
              onChange={(e) => setNewKROwner(e.target.value)}
            />
          </FormField>
          <div className="action-row mt-1">
            <Button onClick={() => setShowNewKR(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateKR}
              disabled={!newKRTitle.trim()}
            >
              Create Key Result
            </Button>
          </div>
        </Stack>
      </Modal>
    </>
  );
}
