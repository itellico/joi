import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterGroup,
  MetaText,
  Pagination,
  PageBody,
  PageHeader,
  Row,
  SearchInput,
  SectionLabel,
  Stack,
  UnifiedList,
  type UnifiedListColumn,
} from "../components/ui";

interface ReviewItem {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  type: string;
  title: string;
  description: string | null;
  content: ContentBlock[];
  proposed_action: unknown;
  alternatives: unknown[] | null;
  status: string;
  resolution: unknown;
  resolved_by: string | null;
  resolved_at: string | null;
  priority: number;
  tags: string[] | null;
  batch_id: string | null;
  created_at: string;
}

interface ContentBlock {
  type: "text" | "table" | "image" | "pdf" | "diff" | "json" | "form";
  data?: unknown;
  content?: string;
  label?: string;
  columns?: string[];
  rows?: unknown[][];
  url?: string;
  left?: { label: string; content: string };
  right?: { label: string; content: string };
}

interface ReviewStats {
  stats: Array<{ status: string; count: number }>;
}

interface InboxRulesSummary {
  total_active: number;
  auto_approve_active: number;
  channel_scoped: number;
  sender_scoped: number;
  keyword_scoped: number;
  semantic_only: number;
  total_hits: number;
  last_hit_at: string | null;
}

interface TriageClassification {
  intent: string;
  urgency: string;
  summary: string;
}

interface ActionSummary {
  title: string;
  detail?: string;
}

type KanbanColumn = "pending" | "approved" | "rejected";
type ReviewScope = "pending" | "all" | "approved" | "rejected";
type PendingSortMode = "newest" | "oldest";
type ReviewViewMode = "kanban" | "list";
const REVIEW_SCOPE_OPTIONS: readonly ReviewScope[] = ["pending", "all", "approved", "rejected"];
const REVIEW_VIEW_OPTIONS: readonly ReviewViewMode[] = ["kanban", "list"];
const REVIEW_SORT_OPTIONS: readonly PendingSortMode[] = ["newest", "oldest"];
const DEFAULT_PENDING_MAX_AGE_DAYS = 1;

function isReviewScope(value: string | null): value is ReviewScope {
  return value !== null && (REVIEW_SCOPE_OPTIONS as readonly string[]).includes(value);
}

function isReviewView(value: string | null): value is ReviewViewMode {
  return value !== null && (REVIEW_VIEW_OPTIONS as readonly string[]).includes(value);
}

function isPendingSort(value: string | null): value is PendingSortMode {
  return value !== null && (REVIEW_SORT_OPTIONS as readonly string[]).includes(value);
}

const COLUMNS: { key: KanbanColumn; label: string; emptyMsg: string }[] = [
  { key: "pending", label: "Needs Review", emptyMsg: "No pending reviews" },
  { key: "approved", label: "Approved", emptyMsg: "Nothing approved yet" },
  { key: "rejected", label: "Dismissed", emptyMsg: "Nothing dismissed" },
];

const AGENT_LABELS: Record<string, string> = {
  "invoice-collector": "Collector",
  "invoice-processor": "Processor",
  reconciliation: "Reconciliation",
  "bmd-uploader": "BMD Upload",
  "accounting-orchestrator": "Orchestrator",
  "knowledge-sync": "Knowledge Sync",
  "skill-scout": "Skill Scout",
  "store-auditor": "Store Auditor",
  "knowledge-system": "Knowledge System",
  personal: "JOI",
};

function getAgentLabel(agentId: string): string {
  return AGENT_LABELS[agentId] || agentId;
}

const TYPE_CLASS: Record<string, string> = {
  approve: "reviews-type-approve",
  classify: "reviews-type-classify",
  match: "reviews-type-match",
  select: "reviews-type-select",
  verify: "reviews-type-verify",
  freeform: "reviews-type-freeform",
  triage: "reviews-type-triage",
};

const TYPE_LABEL: Record<string, string> = {
  approve: "Approval",
  classify: "Classification",
  match: "Match Check",
  select: "Selection",
  verify: "Verification",
  freeform: "Manual Review",
  triage: "Inbox Triage",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asActionArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function extractContentBlock(
  review: ReviewItem,
  label: string,
): ContentBlock | null {
  if (!Array.isArray(review.content)) return null;
  return review.content.find((b) => b.label === label) || null;
}

function getReviewTypeLabel(review: ReviewItem): string {
  if (isVerifyFactReview(review)) return "Fact Verify";
  return TYPE_LABEL[review.type] || review.type;
}

function getTriageClassification(review: ReviewItem): TriageClassification | null {
  if (review.type !== "triage") return null;
  const block = extractContentBlock(review, "Classification");
  const data = asRecord(block?.data);
  if (!data) return null;

  const intent = typeof data.intent === "string" ? data.intent : "";
  const urgency = typeof data.urgency === "string" ? data.urgency : "";
  const summary = typeof data.summary === "string" ? data.summary : "";
  if (!intent && !urgency && !summary) return null;

  return {
    intent: intent || "unknown",
    urgency: urgency || "unknown",
    summary: summary || review.title,
  };
}

function getTriageActions(review: ReviewItem): Record<string, unknown>[] {
  if (review.type !== "triage") return [];
  const fromProposed = asActionArray(review.proposed_action);
  if (fromProposed.length > 0) return fromProposed;

  const block = extractContentBlock(review, "Proposed Actions");
  return asActionArray(block?.data);
}

function getVerifyFactTriple(review: ReviewItem): string | null {
  if (!isVerifyFactReview(review)) return null;
  const action = asRecord(review.proposed_action);
  const fact = asRecord(action?.fact);
  if (!fact) return null;

  const subject = typeof fact.subject === "string" ? fact.subject.trim() : "";
  const predicate = typeof fact.predicate === "string" ? fact.predicate.trim() : "";
  const object = typeof fact.object === "string" ? fact.object.trim() : "";
  if (!subject || !predicate || !object) return null;
  return `${subject} ${predicate} ${object}`;
}

function summarizeAction(action: Record<string, unknown>): ActionSummary {
  const type = typeof action.type === "string" ? action.type : "unknown";
  switch (type) {
    case "reply": {
      const draft = typeof action.draft === "string" ? action.draft.trim() : "";
      return {
        title: "Draft reply",
        detail: draft ? draft.split("\n")[0]?.slice(0, 120) : "Send a response",
      };
    }
    case "create_task": {
      const title = typeof action.title === "string" ? action.title.trim() : "";
      const notes = typeof action.notes === "string" ? action.notes.trim() : "";
      return {
        title: "Create task",
        detail: title || notes || "Task in Things3",
      };
    }
    case "no_action": {
      const reason = typeof action.reason === "string" ? action.reason.trim() : "";
      return {
        title: "No action",
        detail: reason || "Keep as informational/noise",
      };
    }
    case "extract": {
      const collection = typeof action.extract_collection === "string" ? action.extract_collection.trim() : "";
      return {
        title: "Extract data",
        detail: collection ? `Save into ${collection}` : "Store extracted fields",
      };
    }
    case "label": {
      const labels = Array.isArray(action.labels)
        ? action.labels.filter((x): x is string => typeof x === "string")
        : [];
      return {
        title: "Apply labels",
        detail: labels.length > 0 ? labels.join(", ") : "Tag conversation",
      };
    }
    case "archive":
      return { title: "Archive thread" };
    default:
      return { title: type || "Action", detail: "See raw action payload" };
  }
}

function summarizeReviewActions(review: ReviewItem): ActionSummary[] {
  if (isVerifyFactReview(review)) {
    const triple = getVerifyFactTriple(review);
    return [{ title: "Verify fact", detail: triple || "Confirm or reject learned fact" }];
  }

  const actions = getTriageActions(review);
  if (actions.length === 0) return [];
  return actions.map(summarizeAction);
}

function getReviewActionPreviewText(review: ReviewItem): string {
  const summaries = summarizeReviewActions(review);
  if (summaries.length === 0) {
    if (review.type === "triage") return "No action plan proposed";
    return "Open to inspect details";
  }
  const short = summaries.slice(0, 2).map((s) => s.title).join(" + ");
  if (summaries.length > 2) return `${short} +${summaries.length - 2} more`;
  return short;
}

function parseTriageSource(review: ReviewItem): {
  sender?: string;
  channel?: string;
  urgency?: string;
} {
  const description = review.description || "";
  const match = description.match(/^(low|medium|high)\s+urgency\s+—\s+(.+?)\s+via\s+(.+)$/i);
  if (!match) return {};
  return {
    urgency: match[1]?.toLowerCase(),
    sender: match[2]?.trim(),
    channel: match[3]?.trim().toLowerCase(),
  };
}

function isVerifyFactReview(review: ReviewItem): boolean {
  if (review.type !== "verify") return false;
  const action = asRecord(review.proposed_action);
  if (!action) return false;
  const kind = typeof action.kind === "string" ? action.kind : "";
  const factId = typeof action.fact_id === "string"
    ? action.fact_id
    : (typeof action.factId === "string" ? action.factId : "");
  return kind === "verify_fact" && factId.trim().length > 0;
}

function isLowSignalNoise(review: ReviewItem): boolean {
  if (review.type !== "triage" || review.status !== "pending" || review.priority !== 0) return false;
  const tags = new Set(review.tags || []);
  const classification = getTriageClassification(review);
  const intent = classification?.intent?.toLowerCase() || "";
  const actions = getTriageActions(review);
  const noActionOnly = actions.length === 0 || actions.every((a) => String(a.type || "") === "no_action");

  if (tags.has("spam") || tags.has("fyi") || tags.has("social")) {
    return noActionOnly || intent === "spam" || intent === "fyi" || intent === "social";
  }
  return noActionOnly && (intent === "spam" || intent === "fyi" || intent === "social");
}

function getLearningImpact(review: ReviewItem): string {
  if (isVerifyFactReview(review)) {
    return "Approve verifies this fact for future context. Reject archives it as outdated. This path does not generate preference/reflection learning.";
  }
  if (review.type === "triage") {
    return "Every decision becomes a learning episode. Approve reinforces current behavior; modify/reject teaches stronger corrections and can produce new preference/solution signals.";
  }
  return "This decision is recorded in learning episodes and can influence future behavior for similar review types.";
}

function getActionLabels(review: ReviewItem): {
  approve: string;
  reject: string;
  approveNext: string;
  rejectNext: string;
} {
  if (isVerifyFactReview(review)) {
    return {
      approve: "Verify Fact",
      reject: "Reject Fact",
      approveNext: "Verify + Next",
      rejectNext: "Reject Fact + Next",
    };
  }
  if (review.type === "triage") {
    return {
      approve: "Apply Plan",
      reject: "Dismiss Plan",
      approveNext: "Apply + Next",
      rejectNext: "Dismiss + Next",
    };
  }
  return {
    approve: "Approve",
    reject: "Reject",
    approveNext: "Approve + Next",
    rejectNext: "Reject + Next",
  };
}

function normalizeReviewStatus(status: string): KanbanColumn {
  if (status === "approved" || status === "rejected" || status === "pending") return status;
  return status === "modified" ? "approved" : "pending";
}

function statusBadge(status: string): "warning" | "success" | "error" | "muted" {
  const normalized = normalizeReviewStatus(status);
  if (normalized === "pending") return "warning";
  if (normalized === "approved") return "success";
  if (normalized === "rejected") return "error";
  return "muted";
}

function sortPendingReviews(
  items: ReviewItem[],
  pendingSort: PendingSortMode,
): ReviewItem[] {
  return [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return pendingSort === "newest" ? timeDiff : -timeDiff;
  });
}

function toDisplayJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function Reviews({ ws }: { ws: { on: (type: string, handler: (frame: unknown) => void) => () => void } }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState<ReviewStats>({ stats: [] });
  const [rulesSummary, setRulesSummary] = useState<InboxRulesSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("id"));
  const [resolving, setResolving] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(() => {
    const value = searchParams.get("tag");
    return value && value.trim() ? value.trim() : null;
  });
  const [typeFilter, setTypeFilter] = useState<string>(() => searchParams.get("type") || "all");
  const [agentFilter, setAgentFilter] = useState<string>(() => searchParams.get("agent") || "all");
  const [scope, setScope] = useState<ReviewScope>(() => {
    const value = searchParams.get("scope");
    return isReviewScope(value) ? value : "pending";
  });
  const [viewMode, setViewMode] = useState<ReviewViewMode>(() => {
    const value = searchParams.get("view");
    return isReviewView(value) ? value : "kanban";
  });
  const [showOlderPending, setShowOlderPending] = useState(() => searchParams.get("older") === "1");
  const [showP0Noise, setShowP0Noise] = useState(() => searchParams.get("p0") === "1");
  const [pendingSort, setPendingSort] = useState<PendingSortMode>(() => {
    const value = searchParams.get("sort");
    return isPendingSort(value) ? value : "newest";
  });
  const [textSearch, setTextSearch] = useState(() => searchParams.get("q") ?? "");
  const [reviewPageOffset, setReviewPageOffset] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    try {
      const status = scope === "all" ? "all" : scope;
      const params = new URLSearchParams({ status, limit: "400" });
      if (scope === "pending" && !showOlderPending) params.set("max_age_days", String(DEFAULT_PENDING_MAX_AGE_DAYS));
      if (scope === "pending" && !showP0Noise) params.set("min_priority", "1");
      const res = await fetch(`/api/reviews?${params.toString()}`);
      const data = await res.json();
      setReviews(data.reviews || []);
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      console.error("Failed to load reviews:", err);
    }
  }, [scope, showOlderPending, showP0Noise]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews/stats/summary");
      const data = await res.json();
      setStats(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchRulesSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/rules/summary");
      if (!res.ok) return;
      const data = await res.json();
      setRulesSummary(data);
    } catch {
      // ignore
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchReviews();
    fetchStats();
    fetchRulesSummary();
  }, [fetchReviews, fetchStats, fetchRulesSummary]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const unsub1 = ws.on("review.created", () => {
      fetchReviews();
      fetchStats();
      fetchRulesSummary();
    });
    const unsub2 = ws.on("review.resolved", () => {
      fetchReviews();
      fetchStats();
      fetchRulesSummary();
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [ws, fetchReviews, fetchStats, fetchRulesSummary]);

  const resolveReview = useCallback(async (
    id: string,
    status: "approved" | "rejected" | "modified",
    resolution: unknown,
  ) => {
    await fetch(`/api/reviews/${id}/resolve`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        resolution,
        resolved_by: "human",
      }),
    });
  }, []);

  const getVisiblePendingReviews = useCallback((items: ReviewItem[]) => {
    const filtered = items.filter((r) => r.status === "pending");
    const byTag = tagFilter ? filtered.filter((r) => r.tags?.includes(tagFilter)) : filtered;
    const byType = typeFilter !== "all" ? byTag.filter((r) => r.type === typeFilter) : byTag;
    const byAgent = agentFilter !== "all" ? byType.filter((r) => r.agent_id === agentFilter) : byType;
    return sortPendingReviews(byAgent, pendingSort);
  }, [agentFilter, pendingSort, tagFilter, typeFilter]);

  const handleResolve = async (
    id: string,
    status: "approved" | "rejected" | "modified",
    resolution?: unknown,
    advanceSelection = false,
  ) => {
    setResolving(true);
    try {
      const review = reviews.find((r) => r.id === id);
      const effectiveResolution = status === "rejected"
        ? null
        : (resolution ?? review?.proposed_action ?? null);

      let nextSelection: string | null = null;
      const shouldAdvance = advanceSelection || (scope === "pending" && selectedId === id);
      if (shouldAdvance) {
        const pending = getVisiblePendingReviews(reviews);
        const index = pending.findIndex((r) => r.id === id);
        if (index >= 0) {
          nextSelection = pending[index + 1]?.id || pending[index - 1]?.id || null;
        }
      }

      await resolveReview(id, status, effectiveResolution);
      setReviews((prev) => prev.map((r) => (
        r.id === id
          ? {
              ...r,
              status,
              resolution: effectiveResolution,
              resolved_by: "human",
              resolved_at: new Date().toISOString(),
            }
          : r
      )));

      if (shouldAdvance) setSelectedId(nextSelection);
      fetchStats();
    } catch (err) {
      console.error("Failed to resolve review:", err);
      fetchReviews();
    } finally {
      setResolving(false);
    }
  };

  const handleBulkNoiseReject = async () => {
    const candidates = reviews.filter(isLowSignalNoise);
    if (candidates.length === 0) return;
    const count = Math.min(candidates.length, 120);
    const confirmed = window.confirm(`Dismiss ${count} low-signal pending reviews?`);
    if (!confirmed) return;

    setResolving(true);
    try {
      for (const item of candidates.slice(0, count)) {
        await resolveReview(item.id, "rejected", null);
      }
      setReviews((prev) => prev.map((r) => (
        candidates.some((c) => c.id === r.id)
          ? { ...r, status: "rejected", resolution: null, resolved_by: "human", resolved_at: new Date().toISOString() }
          : r
      )));
      if (scope === "pending") setSelectedId(null);
      fetchStats();
    } catch (err) {
      console.error("Bulk reject failed:", err);
      fetchReviews();
    } finally {
      setResolving(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };

  const handleDragOver = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(column);
  };

  const handleDrop = (e: React.DragEvent, targetColumn: KanbanColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDraggingId(null);
    const id = e.dataTransfer.getData("text/plain");
    const review = reviews.find((r) => r.id === id);
    if (!review || review.status === targetColumn) return;
    if (targetColumn === "pending") return;
    handleResolve(id, targetColumn as "approved" | "rejected");
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const selected = reviews.find((r) => r.id === selectedId);
      if (!selected || selected.status !== "pending") return;

      if (e.key === "a") {
        e.preventDefault();
        handleResolve(selectedId, "approved", selected.proposed_action);
      } else if (e.key === "r") {
        e.preventDefault();
        handleResolve(selectedId, "rejected");
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, reviews]);

  useEffect(() => {
    if (!selectedId) return;
    const stillVisible = reviews.some((r) => r.id === selectedId);
    if (!stillVisible) setSelectedId(null);
  }, [reviews, selectedId]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (scope === "pending") next.delete("scope");
    else next.set("scope", scope);

    if (viewMode === "kanban") next.delete("view");
    else next.set("view", viewMode);

    if (typeFilter === "all") next.delete("type");
    else next.set("type", typeFilter);

    if (agentFilter === "all") next.delete("agent");
    else next.set("agent", agentFilter);

    if (!tagFilter) next.delete("tag");
    else next.set("tag", tagFilter);

    if (pendingSort === "newest") next.delete("sort");
    else next.set("sort", pendingSort);

    if (!showOlderPending) next.delete("older");
    else next.set("older", "1");

    if (!showP0Noise) next.delete("p0");
    else next.set("p0", "1");

    if (!selectedId) next.delete("id");
    else next.set("id", selectedId);

    const q = textSearch.trim();
    if (!q) next.delete("q");
    else next.set("q", q);

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    agentFilter,
    pendingSort,
    scope,
    searchParams,
    selectedId,
    setSearchParams,
    showOlderPending,
    showP0Noise,
    tagFilter,
    textSearch,
    typeFilter,
    viewMode,
  ]);

  const allTags = useMemo(
    () => Array.from(new Set(reviews.flatMap((r) => r.tags || []))).sort(),
    [reviews],
  );
  const allTypes = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.type))).sort(),
    [reviews],
  );
  const allAgents = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.agent_id))).sort((a, b) => getAgentLabel(a).localeCompare(getAgentLabel(b))),
    [reviews],
  );
  const statCountByStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats.stats) {
      map.set(item.status, Number(item.count) || 0);
    }
    return map;
  }, [stats.stats]);

  const filteredReviews = useMemo(() => {
    let result = reviews;
    if (tagFilter) result = result.filter((r) => r.tags?.includes(tagFilter));
    if (typeFilter !== "all") result = result.filter((r) => r.type === typeFilter);
    if (agentFilter !== "all") result = result.filter((r) => r.agent_id === agentFilter);
    const q = textSearch.trim().toLowerCase();
    if (q) {
      result = result.filter((r) =>
        r.title.toLowerCase().includes(q)
        || (r.description?.toLowerCase().includes(q) ?? false)
        || r.agent_id.toLowerCase().includes(q)
        || r.content?.some((b) => (b.content || "").toLowerCase().includes(q))
      );
    }
    return result;
  }, [agentFilter, reviews, tagFilter, textSearch, typeFilter]);

  const columns = useMemo<Record<KanbanColumn, ReviewItem[]>>(() => {
    const next: Record<KanbanColumn, ReviewItem[]> = {
      pending: [],
      approved: [],
      rejected: [],
    };
    for (const review of filteredReviews) {
      const col = normalizeReviewStatus(review.status);
      if (next[col]) next[col].push(review);
    }

    next.pending = sortPendingReviews(next.pending, pendingSort);
    next.approved.sort((a, b) => (
      new Date(b.resolved_at || b.created_at).getTime()
      - new Date(a.resolved_at || a.created_at).getTime()
    ));
    next.rejected.sort((a, b) => (
      new Date(b.resolved_at || b.created_at).getTime()
      - new Date(a.resolved_at || a.created_at).getTime()
    ));
    return next;
  }, [filteredReviews, pendingSort]);

  const visibleColumns = scope === "all"
    ? COLUMNS
    : COLUMNS.filter((c) => c.key === scope);

  const pendingCount = statCountByStatus.get("pending") ?? columns.pending.length;
  const approvedCount = (statCountByStatus.get("approved") ?? 0) + (statCountByStatus.get("modified") ?? 0);
  const dismissedCount = statCountByStatus.get("rejected") ?? 0;
  const selectedReview = selectedId ? reviews.find((r) => r.id === selectedId) : null;
  const bulkNoiseCount = reviews.filter(isLowSignalNoise).length;
  const visiblePendingCount = columns.pending.length;
  const highPriorityPendingCount = columns.pending.filter((r) => r.priority > 0).length;
  const nextPendingReview = columns.pending.find((r) => r.priority > 0) ?? columns.pending[0] ?? null;
  const pendingByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const review of columns.pending) {
      counts.set(review.agent_id, (counts.get(review.agent_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([agentId, count]) => ({ agentId, count, label: getAgentLabel(agentId) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [columns.pending]);

  const REVIEW_PAGE_SIZE = 50;
  const listItems = useMemo(() => {
    if (scope === "pending") return columns.pending;
    if (scope === "approved") return columns.approved;
    if (scope === "rejected") return columns.rejected;
    return [...filteredReviews].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [columns, filteredReviews, scope]);
  const paginatedListItems = useMemo(
    () => listItems.slice(reviewPageOffset, reviewPageOffset + REVIEW_PAGE_SIZE),
    [listItems, reviewPageOffset],
  );
  useEffect(() => {
    if (reviewPageOffset === 0) return;
    if (reviewPageOffset < listItems.length) return;
    setReviewPageOffset(0);
  }, [listItems.length, reviewPageOffset]);

  const listColumns: UnifiedListColumn<ReviewItem>[] = [
    {
      key: "created_at",
      header: "Created",
      render: (review) => (
        <MetaText size="xs">{timeAgo(review.created_at)}</MetaText>
      ),
      sortValue: (review) => new Date(review.created_at),
      width: 110,
    },
    {
      key: "status",
      header: "Status",
      render: (review) => (
        <Badge status={statusBadge(review.status)} className="text-xs capitalize">
          {normalizeReviewStatus(review.status)}
        </Badge>
      ),
      sortValue: (review) => normalizeReviewStatus(review.status),
      width: 110,
      align: "center",
    },
    {
      key: "priority",
      header: "Priority",
      render: (review) => review.priority > 0 ? <Badge status="error" className="text-xs">P{review.priority}</Badge> : "—",
      sortValue: (review) => review.priority,
      width: 96,
      align: "center",
    },
    {
      key: "type",
      header: "Type",
      render: (review) => (
        <Badge className={TYPE_CLASS[review.type] || TYPE_CLASS.freeform}>
          {getReviewTypeLabel(review)}
        </Badge>
      ),
      sortValue: (review) => getReviewTypeLabel(review),
      width: 150,
    },
    {
      key: "agent",
      header: "Agent",
      render: (review) => getAgentLabel(review.agent_id),
      sortValue: (review) => getAgentLabel(review.agent_id),
      width: 140,
    },
    {
      key: "title",
      header: "Review",
      render: (review) => (
        <div className="unified-list-cell-break">
          <div className="text-primary">{review.title}</div>
          <MetaText size="xs" className="block mt-1">
            {getReviewActionPreviewText(review)}
          </MetaText>
        </div>
      ),
      sortValue: (review) => review.title,
    },
    {
      key: "actions",
      header: "Decision",
      render: (review) => {
        const labels = getActionLabels(review);
        return review.status === "pending" ? (
          <Row gap={1}>
            <Button
              size="sm"
              variant="primary"
              disabled={resolving}
              onClick={(event) => {
                event.stopPropagation();
                handleResolve(review.id, "approved", review.proposed_action);
              }}
            >
              {labels.approve}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={resolving}
              onClick={(event) => {
                event.stopPropagation();
                handleResolve(review.id, "rejected");
              }}
            >
              {labels.reject}
            </Button>
          </Row>
        ) : (
          <MetaText size="xs">
            {normalizeReviewStatus(review.status)}
          </MetaText>
        );
      },
      width: 230,
      align: "right",
    },
  ];

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle={(
          <Row gap={2} wrap>
            <Badge status={pendingCount > 0 ? "warning" : "muted"} className="text-sm">
              {pendingCount} pending
            </Badge>
            <MetaText size="sm">
              Review decisions train triage behavior and fact quality.
            </MetaText>
          </Row>
        )}
        actions={(
          <Row gap={2} wrap className="reviews-header-actions text-muted text-base items-center">
            {lastRefreshAt && (
              <MetaText size="xs">Updated {timeAgo(lastRefreshAt)}</MetaText>
            )}
            <Button size="sm" variant="ghost" onClick={refreshAll} disabled={resolving}>
              Refresh
            </Button>
          </Row>
        )}
      />

      <div className="reviews-toolbar">
        <div className="reviews-summary-grid">
          <Card className="reviews-focus-card">
            <SectionLabel className="mb-2">Queue Focus</SectionLabel>
            <div className="reviews-metric-grid">
              <div className="reviews-metric reviews-metric-pending">
                <span className="reviews-metric-label">Needs review</span>
                <strong className="reviews-metric-value">{pendingCount}</strong>
              </div>
              <div className="reviews-metric reviews-metric-approved">
                <span className="reviews-metric-label">Approved</span>
                <strong className="reviews-metric-value">{approvedCount}</strong>
              </div>
              <div className="reviews-metric reviews-metric-dismissed">
                <span className="reviews-metric-label">Dismissed</span>
                <strong className="reviews-metric-value">{dismissedCount}</strong>
              </div>
            </div>

            <MetaText size="sm" className="block mt-3">
              {scope === "pending"
                ? `Showing ${visiblePendingCount} pending reviews (${highPriorityPendingCount} high-priority).`
                : `${filteredReviews.length} reviews match the current filters.`}
            </MetaText>

            {nextPendingReview ? (
              <div className="reviews-next-action">
                <MetaText size="sm" className="block mb-2">
                  Next recommended: <strong>{nextPendingReview.title}</strong> ({getAgentLabel(nextPendingReview.agent_id)}).
                </MetaText>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setSelectedId(nextPendingReview.id)}
                >
                  Open Next Review
                </Button>
              </div>
            ) : (
              <MetaText size="sm" className="block mt-2">
                No pending reviews right now.
              </MetaText>
            )}
          </Card>

          <Card className="reviews-overview-card">
            <SectionLabel className="mb-2">Decision Guide</SectionLabel>
            <ul className="reviews-guide-list">
              <li><strong>Apply Plan</strong> runs the proposed action immediately.</li>
              <li><strong>Dismiss Plan</strong> rejects the action and records your correction.</li>
              <li><strong>Approved</strong> includes both approved and modified outcomes.</li>
              <li><strong>Needs Review</strong> means waiting for human decision.</li>
            </ul>
            <Row gap={2} wrap className="mt-2">
              <Badge status="muted">rules: {rulesSummary?.total_active ?? 0}</Badge>
              <Badge status="muted">auto-approve: {rulesSummary?.auto_approve_active ?? 0}</Badge>
              <Badge status="muted">rule hits: {rulesSummary?.total_hits ?? 0}</Badge>
            </Row>
            {rulesSummary?.last_hit_at && (
              <MetaText size="xs" className="block mt-2">last rule hit {timeAgo(rulesSummary.last_hit_at)}</MetaText>
            )}
          </Card>

          <Card className="reviews-overview-card">
            <SectionLabel className="mb-2">Agents Involved</SectionLabel>
            {pendingByAgent.length === 0 ? (
              <MetaText size="sm">No agents with pending items.</MetaText>
            ) : (
              <div className="reviews-agent-list">
                {pendingByAgent.slice(0, 8).map((agent) => (
                  <button
                    key={agent.agentId}
                    type="button"
                    className={`reviews-agent-chip${agentFilter === agent.agentId ? " reviews-agent-chip--active" : ""}`}
                    onClick={() => {
                      setAgentFilter((current) => current === agent.agentId ? "all" : agent.agentId);
                      setReviewPageOffset(0);
                    }}
                  >
                    <span>{agent.label}</span>
                    <Badge status="muted" className="text-xs">{agent.count}</Badge>
                  </button>
                ))}
              </div>
            )}
            <MetaText size="xs" className="block mt-2">
              Click an agent to isolate its queue.
            </MetaText>
          </Card>
        </div>

        <div className="list-page-toolbar reviews-search-row" style={{ padding: "0 0 8px" }}>
          <SearchInput
            value={textSearch}
            onChange={(v) => { setTextSearch(v); setReviewPageOffset(0); }}
            placeholder="Search title, details, agent, or content..."
            resultCount={textSearch.trim() || typeFilter !== "all" || agentFilter !== "all" || tagFilter ? filteredReviews.length : undefined}
            className="list-page-search"
          />
        </div>

        <Card className="reviews-controls-card">
          <SectionLabel className="mb-2">Workflow</SectionLabel>
          <FilterGroup
            options={REVIEW_SCOPE_OPTIONS}
            value={scope}
            onChange={(v) => { setScope(v as ReviewScope); setReviewPageOffset(0); }}
            labelFn={(value) => {
              if (value === "pending") return "Needs Review";
              if (value === "approved") return "Approved";
              if (value === "rejected") return "Dismissed";
              return "All";
            }}
            className="reviews-toolbar-row flex-wrap"
          />
          <FilterGroup
            options={REVIEW_VIEW_OPTIONS}
            value={viewMode}
            onChange={(v) => setViewMode(v as ReviewViewMode)}
            labelFn={(value) => value === "kanban" ? "Board View" : "Table View"}
            className="reviews-toolbar-row flex-wrap mt-2"
          />

          <Row gap={2} wrap className="reviews-toolbar-row mt-2">
            {scope === "pending" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowOlderPending((v) => !v)}
                  disabled={resolving}
                >
                  {showOlderPending ? "Hide >24h Backlog" : "Include >24h Backlog"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowP0Noise((v) => !v)}
                  disabled={resolving}
                >
                  {showP0Noise ? "Hide P0 Noise" : "Include P0 Noise"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingSort((v) => (v === "newest" ? "oldest" : "newest"))}
                  disabled={resolving}
                  title="Pending sort order"
                >
                  Sort: {pendingSort === "newest" ? "newest first" : "oldest first"}
                </Button>
              </>
            )}
            {scope === "pending" && bulkNoiseCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleBulkNoiseReject}
                disabled={resolving}
              >
                Dismiss low-signal ({Math.min(bulkNoiseCount, 120)})
              </Button>
            )}
          </Row>

          {scope === "pending" && (
            <MetaText size="xs" className="block mt-2">
              {"Default queue shows last 24h and priority >0. Use toggles to include old backlog and low-signal noise."}
            </MetaText>
          )}
        </Card>

        <Card className="reviews-controls-card">
          <SectionLabel className="mb-2">Filters</SectionLabel>
          <FilterGroup
            options={["all", ...allTypes]}
            value={typeFilter}
            onChange={(value) => {
              setTypeFilter(value);
              setReviewPageOffset(0);
            }}
            labelFn={(type) => (type === "all" ? "All types" : (TYPE_LABEL[type] || type))}
            className="reviews-toolbar-row flex-wrap"
          />
          <FilterGroup
            options={["all", ...allAgents]}
            value={agentFilter}
            onChange={(value) => {
              setAgentFilter(value);
              setReviewPageOffset(0);
            }}
            labelFn={(agent) => agent === "all" ? "All agents" : getAgentLabel(agent)}
            className="reviews-toolbar-row flex-wrap mt-2"
          />
          {allTags.length > 0 && (
            <FilterGroup
              options={["all", ...allTags]}
              value={tagFilter ?? "all"}
              onChange={(value) => {
                setTagFilter(value === "all" ? null : value);
                setReviewPageOffset(0);
              }}
              labelFn={(tag) => (tag === "all" ? "All tags" : tag)}
              className="reviews-toolbar-row flex-wrap mt-2"
            />
          )}

          {(typeFilter !== "all" || agentFilter !== "all" || tagFilter || textSearch.trim()) && (
            <Row gap={2} className="reviews-toolbar-row mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTypeFilter("all");
                  setAgentFilter("all");
                  setTagFilter(null);
                  setTextSearch("");
                  setReviewPageOffset(0);
                }}
              >
                Reset Filters
              </Button>
            </Row>
          )}
        </Card>
      </div>

      <PageBody className="reviews-page-body">
        {viewMode === "kanban" ? (
          <>
            <div className={`reviews-kanban${selectedReview ? " reviews-kanban-with-detail" : ""}`}>
              {visibleColumns.map((col) => (
                <div
                  key={col.key}
                  className={`reviews-column ${col.key === "pending" ? "reviews-column-pending" : ""}`}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                  onDragLeave={() => setDragOverColumn(null)}
                  onDrop={(e) => handleDrop(e, col.key)}
                >
                  <div className={`reviews-column-header reviews-column-header--${col.key}`}>
                    <span className="reviews-column-title">{col.label}</span>
                    <span className={`reviews-column-count reviews-column-count--${col.key}`}>
                      {columns[col.key].length}
                    </span>
                  </div>

                  <div className={`reviews-column-body${dragOverColumn === col.key ? " reviews-column-body--dragover" : ""}`}>
                    {columns[col.key].length === 0 ? (
                      <EmptyState message={col.emptyMsg} className="reviews-empty-column" />
                    ) : (
                      columns[col.key].map((review) => (
                        <KanbanCard
                          key={review.id}
                          review={review}
                          selected={review.id === selectedId}
                          dragging={review.id === draggingId}
                          onSelect={() => setSelectedId(review.id === selectedId ? null : review.id)}
                          onDragStart={(e) => handleDragStart(e, review.id)}
                          onApprove={review.status === "pending" ? () => handleResolve(review.id, "approved", review.proposed_action) : undefined}
                          onReject={review.status === "pending" ? () => handleResolve(review.id, "rejected") : undefined}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedReview && (
              <div className="reviews-detail-panel">
                <DetailPanel
                  review={selectedReview}
                  resolving={resolving}
                  onClose={() => setSelectedId(null)}
                  onApprove={() => handleResolve(selectedReview.id, "approved", selectedReview.proposed_action)}
                  onReject={() => handleResolve(selectedReview.id, "rejected")}
                  onModify={(resolution) => handleResolve(selectedReview.id, "modified", resolution)}
                  onApproveNext={() => handleResolve(selectedReview.id, "approved", selectedReview.proposed_action, true)}
                  onRejectNext={() => handleResolve(selectedReview.id, "rejected", null, true)}
                />
              </div>
            )}
          </>
        ) : (
          <div className={`reviews-list-layout${selectedReview ? " reviews-list-layout-with-detail" : ""}`}>
            <div>
              <UnifiedList
                items={paginatedListItems}
                columns={listColumns}
                rowKey={(review) => review.id}
                onRowClick={(review) => setSelectedId(review.id === selectedId ? null : review.id)}
                defaultSort={{ key: "created_at", direction: "desc" }}
                tableAriaLabel="Reviews list"
                emptyMessage="No reviews matching filters."
              />
              <Pagination
                total={listItems.length}
                pageSize={REVIEW_PAGE_SIZE}
                offset={reviewPageOffset}
                onOffsetChange={setReviewPageOffset}
              />
            </div>

            {selectedReview && (
              <div className="reviews-detail-panel">
                <DetailPanel
                  review={selectedReview}
                  resolving={resolving}
                  onClose={() => setSelectedId(null)}
                  onApprove={() => handleResolve(selectedReview.id, "approved", selectedReview.proposed_action)}
                  onReject={() => handleResolve(selectedReview.id, "rejected")}
                  onModify={(resolution) => handleResolve(selectedReview.id, "modified", resolution)}
                  onApproveNext={() => handleResolve(selectedReview.id, "approved", selectedReview.proposed_action, true)}
                  onRejectNext={() => handleResolve(selectedReview.id, "rejected", null, true)}
                />
              </div>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}

interface KanbanCardProps {
  review: ReviewItem;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onApprove?: () => void;
  onReject?: () => void;
}

function KanbanCard({
  review,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onApprove,
  onReject,
}: KanbanCardProps) {
  const typeCls = TYPE_CLASS[review.type] || TYPE_CLASS.freeform;
  const classification = getTriageClassification(review);
  const source = parseTriageSource(review);
  const actionPreview = getReviewActionPreviewText(review);
  const actionLabels = getActionLabels(review);

  return (
    <Card
      draggable={review.status === "pending"}
      onDragStart={onDragStart}
      className={`reviews-kanban-card${review.status === "pending" ? " reviews-kanban-card--pending" : ""}${selected ? " reviews-kanban-card--selected" : ""}${dragging ? " reviews-kanban-card--dragging" : ""}`}
    >
      <button
        type="button"
        className="reviews-kanban-card-main"
        onClick={onSelect}
        aria-label={`Open review: ${review.title}`}
      >
        <Row gap={2} wrap className="mb-2">
          <Badge className={typeCls}>{getReviewTypeLabel(review)}</Badge>
          {review.priority > 0 && <Badge status="error" className="text-xs">P{review.priority}</Badge>}
          {classification?.intent && <Badge status="muted" className="text-xs">{classification.intent}</Badge>}
          {classification?.urgency && <Badge status="muted" className="text-xs">{classification.urgency}</Badge>}
          <span className="flex-1" />
          <MetaText size="xs">{timeAgo(review.created_at)}</MetaText>
        </Row>

        <div className="reviews-card-title mb-1">{review.title}</div>

        <MetaText size="xs" className="block">
          {getAgentLabel(review.agent_id)}
          {source.sender && <> · {source.sender}</>}
          {source.channel && <> via {source.channel}</>}
        </MetaText>

        <MetaText size="xs" className="block mt-2 text-secondary leading-relaxed reviews-card-action-preview">
          {actionPreview}
        </MetaText>
      </button>

      {onApprove && (
        <div className="reviews-card-actions">
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => { e.stopPropagation(); onApprove(); }}
          >
            {actionLabels.approve}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={(e) => { e.stopPropagation(); onReject?.(); }}
          >
            {actionLabels.reject}
          </Button>
        </div>
      )}

      {review.status !== "pending" && review.resolved_by && (
        <MetaText size="xs" className="block mt-2">
          {review.status} by {review.resolved_by} {review.resolved_at ? timeAgo(review.resolved_at) : ""}
        </MetaText>
      )}
    </Card>
  );
}

interface DetailPanelProps {
  review: ReviewItem;
  resolving: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onModify: (resolution: unknown) => void;
  onApproveNext: () => void;
  onRejectNext: () => void;
}

function DetailPanel({
  review,
  resolving,
  onClose,
  onApprove,
  onReject,
  onModify,
  onApproveNext,
  onRejectNext,
}: DetailPanelProps) {
  const typeCls = TYPE_CLASS[review.type] || TYPE_CLASS.freeform;
  const classification = getTriageClassification(review);
  const actionSummaries = summarizeReviewActions(review);
  const verifyFactTriple = getVerifyFactTriple(review);
  const actionLabels = getActionLabels(review);

  return (
    <>
      <Card>
        <Row gap={2} justify="between" align="start" className="mb-3">
          <div className="min-w-0">
            <Row gap={2} className="mb-1" wrap>
              <Badge className={typeCls}>{getReviewTypeLabel(review)}</Badge>
              <h3 className="text-lg m-0">{review.title}</h3>
            </Row>
            <MetaText size="sm">
              {getAgentLabel(review.agent_id)} · {timeAgo(review.created_at)}
              {review.batch_id && <> · batch: {review.batch_id}</>}
            </MetaText>
          </div>
          <Button size="sm" onClick={onClose}>Close (Esc)</Button>
        </Row>

        {review.description && (
          <p className="text-secondary text-md mb-3 leading-relaxed m-0">
            {review.description}
          </p>
        )}

        {review.tags && review.tags.length > 0 && (
          <Row gap={1} wrap className="mb-3">
            {review.tags.map((t) => (
              <Badge key={t} status="muted" className="text-sm">{t}</Badge>
            ))}
          </Row>
        )}

        {review.content && review.content.length > 0 && (
          <Stack gap={3}>
            {review.content.map((block, i) => (
              <ContentBlockRenderer key={i} block={block} />
            ))}
          </Stack>
        )}
      </Card>

      {(classification || actionSummaries.length > 0 || verifyFactTriple) && (
        <Card>
          <SectionLabel className="mb-2">Decision Preview</SectionLabel>
          {classification && (
            <>
              <Row gap={2} wrap className="mb-2">
                <Badge status="muted">intent: {classification.intent}</Badge>
                <Badge status="muted">urgency: {classification.urgency}</Badge>
              </Row>
              <MetaText size="sm" className="block mb-2">
                {classification.summary}
              </MetaText>
            </>
          )}
          {verifyFactTriple && (
            <MetaText size="sm" className="block mb-2">
              Candidate fact: <code>{verifyFactTriple}</code>
            </MetaText>
          )}
          {actionSummaries.length > 0 && (
            <ul className="reviews-action-list">
              {actionSummaries.map((summary, i) => (
                <li key={`${summary.title}-${i}`}>
                  <span className="font-semibold">{summary.title}</span>
                  {summary.detail && <>: {summary.detail}</>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card accent="var(--accent)" className="reviews-learning-card">
        <SectionLabel className="mb-2">Learning Impact</SectionLabel>
        <MetaText size="sm" className="block">
          {getLearningImpact(review)}
        </MetaText>
      </Card>

      {review.alternatives && review.alternatives.length > 0 && (
        <Card>
          <SectionLabel className="mb-2">Alternatives</SectionLabel>
          {review.status === "pending" && (
            <MetaText size="xs" className="block mb-2">
              Click an alternative to apply it as a modified resolution.
            </MetaText>
          )}
          {review.alternatives.map((alt, i) => (
            review.status === "pending" ? (
              <button
                key={i}
                type="button"
                className="reviews-alternative reviews-alternative-btn mb-2"
                onClick={() => onModify(alt)}
              >
                <pre className="text-primary m-0">{toDisplayJson(alt)}</pre>
              </button>
            ) : (
              <div
                key={i}
                className="reviews-alternative mb-2"
              >
                <pre className="text-primary m-0">{toDisplayJson(alt)}</pre>
              </div>
            )
          ))}
        </Card>
      )}

      {review.status === "pending" && (
        <Card>
          <Row gap={2} wrap>
            <Button variant="primary" onClick={onApprove} disabled={resolving}>
              {actionLabels.approve} (a)
            </Button>
            <Button variant="danger" onClick={onReject} disabled={resolving}>
              {actionLabels.reject} (r)
            </Button>
            <Button variant="ghost" onClick={onApproveNext} disabled={resolving}>
              {actionLabels.approveNext}
            </Button>
            <Button variant="ghost" onClick={onRejectNext} disabled={resolving}>
              {actionLabels.rejectNext}
            </Button>
            <span className="flex-1" />
            <MetaText size="xs">
              drag to column · a {actionLabels.approve.toLowerCase()} · r {actionLabels.reject.toLowerCase()} · Esc close
            </MetaText>
          </Row>
          <MetaText size="xs" className="block mt-2">
            {isVerifyFactReview(review)
              ? "Verify confirms the fact as valid memory. Reject keeps it out of memory."
              : "Apply runs the proposed action now. Dismiss rejects the action and stores your correction for future learning."}
          </MetaText>
        </Card>
      )}

      <Card>
        <details>
          <summary className="reviews-details-summary">Raw proposed action (debug)</summary>
          <pre className="reviews-code-block reviews-code-block--full mt-2">
            {toDisplayJson(review.proposed_action)}
          </pre>
        </details>
      </Card>

      {review.status !== "pending" && review.resolution && (
        <Card>
          <SectionLabel className="mb-2">
            Resolution ({review.status} by {review.resolved_by})
          </SectionLabel>
          <pre className="reviews-code-block reviews-code-block--full">
            {toDisplayJson(review.resolution)}
          </pre>
        </Card>
      )}
    </>
  );
}

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return (
        <div className="reviews-content-text">
          {block.content || (block.data as string)}
        </div>
      );

    case "table":
      return (
        <div className="overflow-x-auto">
          {block.label && <MetaText size="sm" className="block mb-1">{block.label}</MetaText>}
          <table className="reviews-content-table">
            <thead>
              <tr>
                {(block.columns || []).map((col, i) => (
                  <th key={i}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(block.rows || []).map((row: unknown[], ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "diff":
      return (
        <div className="reviews-diff-grid">
          <div className="reviews-diff-panel">
            <MetaText size="xs" className="block mb-2 text-error">
              {block.left?.label || "Before"}
            </MetaText>
            <pre className="text-primary text-base m-0 pre-wrap">
              {block.left?.content}
            </pre>
          </div>
          <div className="reviews-diff-panel">
            <MetaText size="xs" className="block mb-2 text-success">
              {block.right?.label || "After"}
            </MetaText>
            <pre className="text-primary text-base m-0 pre-wrap">
              {block.right?.content}
            </pre>
          </div>
        </div>
      );

    case "json":
      return (
        <div>
          {block.label && <MetaText size="sm" className="block mb-1">{block.label}</MetaText>}
          <pre className="reviews-code-block">
            {toDisplayJson(block.data)}
          </pre>
        </div>
      );

    case "image":
      return (
        <div>
          {block.label && <MetaText size="sm" className="block mb-1">{block.label}</MetaText>}
          <img
            src={block.url}
            alt={block.label || "Review content"}
            className="reviews-content-image"
          />
        </div>
      );

    default:
      return (
        <div className="reviews-fallback-block">
          <MetaText size="sm">Block type: {block.type}</MetaText>
          <pre className="text-primary mt-1">
            {toDisplayJson(block.data || block)}
          </pre>
        </div>
      );
  }
}
