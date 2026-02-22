import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import MarkdownField from "../components/MarkdownField";
import {
  PageHeader,
  PageBody,
  Card,
  ChipGroup,
  Badge,
  Button,
  EmptyState,
  FilterGroup,
  MetaText,
  Pagination,
  Row,
  SearchInput,
  SectionLabel,
  Stack,
  Tabs,
  FormField,
  FormGrid,
  UnifiedList,
  type UnifiedListColumn,
} from "../components/ui";

interface Memory {
  id: string;
  area: string;
  content: string;
  summary: string | null;
  tags: string[];
  confidence: number;
  access_count: number;
  reinforcement_count: number;
  source: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface AreaStat {
  area: string;
  count: number;
  avg_confidence: number;
}

interface Document {
  id: number;
  source: string;
  path: string | null;
  title: string;
  embedded_at: string | null;
  created_at: string;
  chunk_count: number;
}

interface ObsidianStatus {
  syncActive: boolean;
  vaultPath: string | null;
  syncEnabled: boolean;
}

interface FlushMemory {
  id: string;
  area: string;
  content: string;
  summary: string | null;
  confidence: number;
  conversation_id: string | null;
  conversation_title: string | null;
  created_at: string;
}

interface FlushStats {
  total_flushes: number;
  conversations_flushed: number;
  last_flush_at: string | null;
}

type Tab = "memories" | "documents" | "obsidian" | "flushes";
const KNOWLEDGE_TABS = ["memories", "documents", "obsidian", "flushes"] as const;
const KNOWLEDGE_VIEWS = ["list", "cards"] as const;
const KNOWLEDGE_AREAS = ["all", "identity", "preferences", "knowledge", "solutions", "episodes"] as const;

function isKnowledgeTab(value: string | null): value is Tab {
  return value !== null && (KNOWLEDGE_TABS as readonly string[]).includes(value);
}

function isKnowledgeView(value: string | null): value is "list" | "cards" {
  return value !== null && (KNOWLEDGE_VIEWS as readonly string[]).includes(value);
}

function isKnowledgeArea(value: string | null): value is (typeof KNOWLEDGE_AREAS)[number] {
  return value !== null && (KNOWLEDGE_AREAS as readonly string[]).includes(value);
}

export default function Knowledge() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const value = searchParams.get("tab");
    return isKnowledgeTab(value) ? value : "memories";
  });
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<AreaStat[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianStatus | null>(null);
  const [flushes, setFlushes] = useState<FlushMemory[]>([]);
  const [flushStats, setFlushStats] = useState<FlushStats | null>(null);
  const [selectedArea, setSelectedArea] = useState<string | "all">(() => {
    const value = searchParams.get("area");
    return isKnowledgeArea(value) ? value : "all";
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [viewMode, setViewMode] = useState<"list" | "cards">(() => {
    const value = searchParams.get("view");
    return isKnowledgeView(value) ? value : "list";
  });
  const [docCount, setDocCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [flushSearch, setFlushSearch] = useState("");
  const [memoryOffset, setMemoryOffset] = useState(0);
  const [docOffset, setDocOffset] = useState(0);
  const [flushOffset, setFlushOffset] = useState(0);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const areaParam = selectedArea !== "all" ? `?area=${selectedArea}` : "";
      const [memRes, statsRes] = await Promise.all([
        fetch(`/api/memories${areaParam}`),
        fetch("/api/memories/stats"),
      ]);
      const memData = await memRes.json();
      const statsData = await statsRes.json();
      setMemories(memData.memories || []);
      setStats(statsData.stats || []);
    } catch (err) {
      console.error("Failed to load knowledge:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedArea]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchObsidianStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/obsidian/status");
      const data = await res.json();
      setObsidianStatus(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchFlushes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memories/flushes");
      const data = await res.json();
      setFlushes(data.flushes || []);
      setFlushStats(data.stats || null);
    } catch (err) {
      console.error("Failed to load flushes:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Eagerly fetch document count for tab label on mount
  useEffect(() => {
    fetch("/api/documents?count=true")
      .then(r => r.json())
      .then(d => setDocCount(d.total ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "memories") fetchMemories();
    else if (tab === "documents") fetchDocuments();
    else if (tab === "obsidian") { fetchObsidianStatus(); fetchDocuments(); }
    else if (tab === "flushes") fetchFlushes();
  }, [tab, fetchMemories, fetchDocuments, fetchObsidianStatus, fetchFlushes]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (tab === "memories") next.delete("tab");
    else next.set("tab", tab);

    if (viewMode === "list") next.delete("view");
    else next.set("view", viewMode);

    if (selectedArea === "all") next.delete("area");
    else next.set("area", selectedArea);

    const query = searchQuery.trim();
    if (!query) next.delete("q");
    else next.set("q", query);

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, searchQuery, selectedArea, setSearchParams, tab, viewMode]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/obsidian/sync", { method: "POST" });
      await fetchDocuments();
      await fetchObsidianStatus();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleWatch = async () => {
    const endpoint = obsidianStatus?.syncActive ? "/api/obsidian/watch/stop" : "/api/obsidian/watch/start";
    await fetch(endpoint, { method: "POST" });
    await fetchObsidianStatus();
  };

  const totalMemories = stats.reduce((sum, s) => sum + s.count, 0);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return memories;
    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(query)
        || (m.summary && m.summary.toLowerCase().includes(query))
        || m.tags.some((t) => t.toLowerCase().includes(query)),
    );
  }, [memories, searchQuery]);

  const obsidianDocuments = useMemo(
    () => documents.filter((d) => d.source === "obsidian"),
    [documents],
  );

  const filteredDocuments = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q)
        || (d.path && d.path.toLowerCase().includes(q)),
    );
  }, [documents, docSearch]);

  const filteredFlushes = useMemo(() => {
    const q = flushSearch.trim().toLowerCase();
    if (!q) return flushes;
    return flushes.filter(
      (f) =>
        (f.summary && f.summary.toLowerCase().includes(q))
        || f.content.toLowerCase().includes(q)
        || f.area.toLowerCase().includes(q)
        || (f.conversation_title && f.conversation_title.toLowerCase().includes(q)),
    );
  }, [flushes, flushSearch]);

  // Reset pagination offsets when search or filter changes
  useEffect(() => { setMemoryOffset(0); }, [searchQuery, selectedArea]);
  useEffect(() => { setDocOffset(0); }, [docSearch]);
  useEffect(() => { setFlushOffset(0); }, [flushSearch]);

  const PAGE_SIZE = 50;
  const displayMemories = filtered.slice(memoryOffset, memoryOffset + PAGE_SIZE);
  const displayDocuments = filteredDocuments.slice(docOffset, docOffset + PAGE_SIZE);
  const displayFlushes = filteredFlushes.slice(flushOffset, flushOffset + PAGE_SIZE);

  // Group flushes by conversation (using displayed page)
  const flushGroups = displayFlushes.reduce<Record<string, FlushMemory[]>>((acc, f) => {
    const key = f.conversation_id || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {});

  const memoryColumns: UnifiedListColumn<Memory>[] = useMemo(() => [
    {
      key: "area",
      header: "Area",
      render: (memory) => (
        <span className={`area-badge area-${memory.area}`}>{memory.area}</span>
      ),
      sortValue: (memory) => memory.area,
      width: 120,
    },
    {
      key: "summary",
      header: "Summary",
      render: (memory) => (
        <div className="unified-list-cell-break">
          <div className="text-primary">
            {memory.summary || firstLine(memory.content)}
          </div>
          {memory.tags.length > 0 && (
            <MetaText size="xs" className="block mt-1">
              {memory.tags.slice(0, 4).join(" · ")}
            </MetaText>
          )}
        </div>
      ),
      sortValue: (memory) => memory.summary || memory.content,
    },
    {
      key: "confidence",
      header: "Confidence",
      render: (memory) => `${Math.round(memory.confidence * 100)}%`,
      sortValue: (memory) => memory.confidence,
      align: "right",
      width: 110,
    },
    {
      key: "source",
      header: "Source",
      render: (memory) => memory.source,
      sortValue: (memory) => memory.source,
      width: 130,
    },
    {
      key: "created_at",
      header: "Created",
      render: (memory) => (
        <MetaText size="xs">{new Date(memory.created_at).toLocaleString()}</MetaText>
      ),
      sortValue: (memory) => new Date(memory.created_at),
      width: 180,
    },
  ], []);

  const documentColumns: UnifiedListColumn<Document>[] = useMemo(() => [
    {
      key: "title",
      header: "Document",
      render: (doc) => (
        <div className="unified-list-cell-break">
          <div className="text-primary">{doc.title}</div>
          {doc.path && <MetaText size="xs" className="block mt-1">{doc.path}</MetaText>}
        </div>
      ),
      sortValue: (doc) => doc.title,
    },
    {
      key: "source",
      header: "Source",
      render: (doc) => (
        <Badge status={doc.source === "obsidian" ? "success" : "warning"} className="text-xs">
          {doc.source}
        </Badge>
      ),
      sortValue: (doc) => doc.source,
      width: 110,
      align: "center",
    },
    {
      key: "chunks",
      header: "Chunks",
      render: (doc) => doc.chunk_count,
      sortValue: (doc) => doc.chunk_count,
      width: 90,
      align: "right",
    },
    {
      key: "embedded_at",
      header: "Embedded",
      render: (doc) => (
        <MetaText size="xs">
          {doc.embedded_at ? new Date(doc.embedded_at).toLocaleDateString() : "—"}
        </MetaText>
      ),
      sortValue: (doc) => doc.embedded_at ? new Date(doc.embedded_at) : null,
      width: 150,
    },
    {
      key: "created_at",
      header: "Created",
      render: (doc) => (
        <MetaText size="xs">{new Date(doc.created_at).toLocaleDateString()}</MetaText>
      ),
      sortValue: (doc) => new Date(doc.created_at),
      width: 140,
    },
  ], []);

  const flushColumns: UnifiedListColumn<FlushMemory>[] = useMemo(() => [
    {
      key: "conversation",
      header: "Conversation",
      render: (flush) => (
        <div className="unified-list-cell-break">
          <div className="text-primary">{flush.conversation_title || "Untitled conversation"}</div>
          <MetaText size="xs" className="block mt-1">{flush.conversation_id || "unknown"}</MetaText>
        </div>
      ),
      sortValue: (flush) => flush.conversation_title || flush.conversation_id || "",
    },
    {
      key: "area",
      header: "Area",
      render: (flush) => (
        <span className={`area-badge area-${flush.area}`}>{flush.area}</span>
      ),
      sortValue: (flush) => flush.area,
      width: 120,
    },
    {
      key: "summary",
      header: "Summary",
      render: (flush) => (
        <span className="unified-list-cell-break">{flush.summary || firstLine(flush.content)}</span>
      ),
      sortValue: (flush) => flush.summary || flush.content,
    },
    {
      key: "confidence",
      header: "Confidence",
      render: (flush) => `${Math.round(flush.confidence * 100)}%`,
      sortValue: (flush) => flush.confidence,
      align: "right",
      width: 110,
    },
    {
      key: "created_at",
      header: "Flushed",
      render: (flush) => (
        <MetaText size="xs">{new Date(flush.created_at).toLocaleString()}</MetaText>
      ),
      sortValue: (flush) => new Date(flush.created_at),
      width: 180,
    },
  ], []);

  /* ─── Tab content renderers ─── */

  const memoriesContent = (
    <Stack gap={5}>
      {/* Stats bar */}
      <ChipGroup
        variant="stat"
        options={stats.map((s) => ({ value: s.area, label: s.area, count: s.count }))}
        value={selectedArea}
        onChange={(v) => setSelectedArea(v === selectedArea ? "all" : v)}
      />

      {/* Search + filter */}
      <Row gap={2}>
        <input
          type="text"
          name="memory_search"
          aria-label="Search memories"
          autoComplete="off"
          placeholder="Search memories…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="knowledge-search-input"
        />
        <FilterGroup
          options={KNOWLEDGE_AREAS}
          value={selectedArea}
          onChange={setSelectedArea}
          labelFn={(a) => a === "all" ? "All" : a.charAt(0).toUpperCase() + a.slice(1)}
        />
      </Row>

      {/* Memory list */}
      {loading ? (
        <Card><MetaText>Loading…</MetaText></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={totalMemories === 0 ? "🧠" : "🔍"}
            message={
              totalMemories === 0
                ? "No memories yet. Start chatting with JOI \u2014 memories are created automatically from conversations."
                : "No memories match your search."
            }
          />
        </Card>
      ) : viewMode === "list" ? (
        <UnifiedList
          items={displayMemories}
          columns={memoryColumns}
          rowKey={(memory) => memory.id}
          emptyMessage="No memories match your search."
          defaultSort={{ key: "created_at", direction: "desc" }}
          tableAriaLabel="Memories list"
        />
      ) : (
        <Stack gap={2}>
          {displayMemories.map((m) => (
            <div key={m.id} className="memory-card">
              <div className="memory-header">
                <span className={`area-badge area-${m.area}`}>{m.area}</span>
                <span className="memory-confidence" title="Confidence">
                  {Math.round(m.confidence * 100)}%
                </span>
                {m.pinned && <Badge status="warning" className="text-xs">Pinned</Badge>}
                <MetaText size="xs">
                  {m.source} &middot; {new Date(m.created_at).toLocaleDateString()}
                </MetaText>
              </div>
              {m.summary && (
                <div className="memory-summary">{m.summary}</div>
              )}
              <div className="memory-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>{m.content}</ReactMarkdown>
              </div>
              {m.tags.length > 0 && (
                <div className="memory-tags">
                  {m.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Stack>
      )}

      <Pagination
        total={filtered.length}
        pageSize={PAGE_SIZE}
        offset={memoryOffset}
        onOffsetChange={setMemoryOffset}
      />
    </Stack>
  );

  const documentsContent = (
    <Stack gap={5}>
      <SearchInput
        value={docSearch}
        onChange={setDocSearch}
        placeholder="Search documents by title or path…"
        resultCount={docSearch ? filteredDocuments.length : undefined}
      />

      {loading ? (
        <Card><MetaText>Loading…</MetaText></Card>
      ) : filteredDocuments.length === 0 ? (
        <Card>
          <EmptyState
            icon={documents.length === 0 ? "📄" : "🔍"}
            message={
              documents.length === 0
                ? "No documents indexed yet. Use Obsidian Sync to index your vault, or ingest documents via API."
                : "No documents match your search."
            }
          />
        </Card>
      ) : viewMode === "list" ? (
        <UnifiedList
          items={displayDocuments}
          columns={documentColumns}
          rowKey={(doc) => String(doc.id)}
          defaultSort={{ key: "embedded_at", direction: "desc" }}
          tableAriaLabel="Knowledge documents list"
        />
      ) : (
        <Stack gap={2}>
          {displayDocuments.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </Stack>
      )}

      <Pagination
        total={filteredDocuments.length}
        pageSize={PAGE_SIZE}
        offset={docOffset}
        onOffsetChange={setDocOffset}
      />
    </Stack>
  );

  const obsidianContent = (
    <>
      <Card>
        <h3 className="mb-3">Obsidian Vault Sync</h3>
        <FormGrid>
          <FormField label="Vault Path">
            <code className="text-md">
              {obsidianStatus?.vaultPath || "Not configured (set in Settings)"}
            </code>
          </FormField>
          <FormField label="File Watcher">
            <Row gap={2}>
              <Badge status={obsidianStatus?.syncActive ? "success" : "error"}>
                {obsidianStatus?.syncActive ? "Watching" : "Stopped"}
              </Badge>
              <Button size="sm" onClick={handleToggleWatch} disabled={!obsidianStatus?.vaultPath}>
                {obsidianStatus?.syncActive ? "Stop" : "Start"} Watcher
              </Button>
            </Row>
          </FormField>
        </FormGrid>
        <div className="mt-4">
          <Button
            variant="primary"
            onClick={handleSync}
            disabled={syncing || !obsidianStatus?.vaultPath}
          >
            {syncing ? "Syncing…" : "Full Sync Now"}
          </Button>
          <MetaText size="xs" className="ml-3">
            Indexes all .md files from your vault
          </MetaText>
        </div>
      </Card>

      {/* Documents from Obsidian */}
      <SectionLabel className="knowledge-flush-group-title">
        Indexed Documents ({obsidianDocuments.length} from Obsidian)
      </SectionLabel>
      {obsidianDocuments.length === 0 ? (
        <Card>
          <EmptyState
            icon="📓"
            message="No Obsidian documents indexed yet. Run a Full Sync to start."
          />
        </Card>
      ) : viewMode === "list" ? (
        <UnifiedList
          items={obsidianDocuments}
          columns={documentColumns}
          rowKey={(doc) => String(doc.id)}
          defaultSort={{ key: "embedded_at", direction: "desc" }}
          tableAriaLabel="Obsidian documents list"
        />
      ) : (
        <Stack gap={2}>
          {obsidianDocuments.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </Stack>
      )}
    </>
  );

  const flushesContent = (
    <Stack gap={5}>
      {/* Flush stats */}
      {flushStats && (
        <Card>
          <Row gap={6}>
            <div>
              <MetaText size="xs">Total Flushes</MetaText>
              <div className="knowledge-flush-stat-value">{flushStats.total_flushes}</div>
            </div>
            <div>
              <MetaText size="xs">Conversations</MetaText>
              <div className="knowledge-flush-stat-value">{flushStats.conversations_flushed}</div>
            </div>
            <div>
              <MetaText size="xs">Last Flush</MetaText>
              <div className="text-md font-semibold">
                {flushStats.last_flush_at
                  ? new Date(flushStats.last_flush_at).toLocaleString()
                  : "Never"}
              </div>
            </div>
          </Row>
        </Card>
      )}

      <SearchInput
        value={flushSearch}
        onChange={setFlushSearch}
        placeholder="Search flushes by summary, area, or conversation…"
        resultCount={flushSearch ? filteredFlushes.length : undefined}
      />

      {/* Flush list grouped by conversation */}
      {loading ? (
        <Card><MetaText>Loading…</MetaText></Card>
      ) : filteredFlushes.length === 0 ? (
        <Card>
          <EmptyState
            icon={flushes.length === 0 ? "💨" : "🔍"}
            message={
              flushes.length === 0
                ? <>
                    No context flushes yet. Flushes happen automatically when a conversation
                    approaches the token limit ({">"}80K input tokens).
                  </>
                : "No flushes match your search."
            }
          />
        </Card>
      ) : viewMode === "list" ? (
        <UnifiedList
          items={displayFlushes}
          columns={flushColumns}
          rowKey={(flush) => flush.id}
          defaultSort={{ key: "created_at", direction: "desc" }}
          tableAriaLabel="Context flushes list"
        />
      ) : (
        <Stack gap={4}>
          {Object.entries(flushGroups).map(([convId, group]) => (
            <div key={convId}>
              <div className="knowledge-flush-group-title mb-2">
                {group[0].conversation_title || "Untitled conversation"}
                <MetaText size="xs" className="ml-2">
                  {group.length} {group.length === 1 ? "memory" : "memories"}
                </MetaText>
              </div>
              <Stack gap={2}>
                {group.map((f) => (
                  <div key={f.id} className="memory-card">
                    <div className="memory-header">
                      <span className={`area-badge area-${f.area}`}>{f.area}</span>
                      <span className="memory-confidence" title="Confidence">
                        {Math.round(f.confidence * 100)}%
                      </span>
                      <Badge status="muted" className="text-xs">
                        context flush
                      </Badge>
                      <MetaText size="xs">
                        {new Date(f.created_at).toLocaleString()}
                      </MetaText>
                    </div>
                    {f.summary && (
                      <div className="memory-summary">{f.summary}</div>
                    )}
                    <div className="memory-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>{f.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </Stack>
            </div>
          ))}
        </Stack>
      )}

      <Pagination
        total={filteredFlushes.length}
        pageSize={PAGE_SIZE}
        offset={flushOffset}
        onOffsetChange={setFlushOffset}
      />
    </Stack>
  );

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        actions={(
          <FilterGroup
            options={KNOWLEDGE_VIEWS}
            value={viewMode}
            onChange={(v) => setViewMode(v as "list" | "cards")}
            labelFn={(mode) => mode === "list" ? "List View" : "Card View"}
          />
        )}
      />

      <PageBody gap={16}>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          tabs={[
            {
              value: "memories",
              label: `Memories (${totalMemories})`,
              content: memoriesContent,
            },
            {
              value: "documents",
              label: `Documents (${documents.length || docCount || 0})`,
              content: documentsContent,
            },
            {
              value: "obsidian",
              label: "Obsidian Sync",
              content: obsidianContent,
            },
            {
              value: "flushes",
              label: `Flushes${flushStats ? ` (${flushStats.total_flushes})` : ""}`,
              content: flushesContent,
            },
          ]}
        />
      </PageBody>
    </>
  );
}

function firstLine(value: string): string {
  return value.trim().split("\n")[0]?.slice(0, 160) || "No summary";
}

/* ─── Expandable document row ─── */

interface DocChunk {
  id: number;
  chunk_index: number;
  content: string;
  start_line: number | null;
  end_line: number | null;
  has_embedding: boolean;
}

function DocumentRow({ doc }: { doc: Document }) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [chunks, setChunks] = useState<DocChunk[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showChunks, setShowChunks] = useState(false);

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (content !== null) return; // already loaded

    setDetailLoading(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`);
      const data = await res.json();
      setContent(data.document?.content || "");
      setChunks(data.chunks || []);
    } catch {
      setContent("Failed to load document.");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <Card className={expanded ? "doc-row-expanded" : "doc-row"}>
      <button
        type="button"
        className="doc-row-toggle"
        onClick={handleExpand}
        aria-expanded={expanded}
      >
        <Row justify="between">
          <div className="min-w-0 flex-1 text-left">
            <span className="font-semibold">{doc.title}</span>
            {doc.path && (
              <MetaText size="xs" className="ml-2">{doc.path}</MetaText>
            )}
          </div>
          <Row gap={2} className="flex-shrink-0">
            <Badge status={doc.source === "obsidian" ? "success" : "warning"}>
              {doc.source}
            </Badge>
            <Badge status={doc.chunk_count > 0 ? "accent" : "muted"}>
              {doc.chunk_count} chunks
            </Badge>
            {doc.embedded_at && (
              <MetaText size="xs">
                {new Date(doc.embedded_at).toLocaleDateString()}
              </MetaText>
            )}
          </Row>
        </Row>
      </button>

      {expanded && (
        <div className="doc-detail">
          {detailLoading ? (
            <MetaText size="sm" className="block p-4">Loading content…</MetaText>
          ) : (
            <>
              {/* Full document content */}
              {content !== null && (
                <MarkdownField
                  value={content}
                  maxHeight="400px"
                  placeholder="Empty document"
                />
              )}

              {/* Chunks toggle */}
              {chunks.length > 0 && (
                <div className="doc-chunks-section">
                  <button
                    type="button"
                    className="doc-chunks-toggle"
                    aria-expanded={showChunks}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowChunks(!showChunks); }}
                  >
                    <Row
                      justify="between"
                      className="doc-chunks-header"
                    >
                      <MetaText size="xs" className="font-semibold">
                        {chunks.length} Chunks {showChunks ? "\u25B2" : "\u25BC"}
                      </MetaText>
                      <MetaText size="xs">
                        {chunks.filter(c => c.has_embedding).length}/{chunks.length} embedded
                      </MetaText>
                    </Row>
                  </button>

                  {showChunks && (
                    <div className="doc-chunks-list">
                      {chunks.map((chunk) => (
                        <div key={chunk.id} className="doc-chunk">
                          <div className="doc-chunk-header">
                            <Badge status={chunk.has_embedding ? "success" : "muted"}>
                              #{chunk.chunk_index}
                            </Badge>
                            {chunk.start_line != null && (
                              <MetaText size="xs">
                                lines {chunk.start_line}&ndash;{chunk.end_line}
                              </MetaText>
                            )}
                            <MetaText size="xs">
                              {chunk.content.length} chars
                            </MetaText>
                          </div>
                          <pre className="doc-chunk-content">{chunk.content}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
