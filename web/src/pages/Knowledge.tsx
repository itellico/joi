import { useEffect, useState, useCallback } from "react";
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
  Row,
  SectionLabel,
  Stack,
  Tabs,
  FormField,
  FormGrid,
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

export default function Knowledge() {
  const [tab, setTab] = useState<Tab>("memories");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<AreaStat[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianStatus | null>(null);
  const [flushes, setFlushes] = useState<FlushMemory[]>([]);
  const [flushStats, setFlushStats] = useState<FlushStats | null>(null);
  const [selectedArea, setSelectedArea] = useState<string | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [docCount, setDocCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const areas = ["all", "identity", "preferences", "knowledge", "solutions", "episodes"] as const;

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

  const filtered = searchQuery
    ? memories.filter(
        (m) =>
          m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.summary && m.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
          m.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : memories;

  // Group flushes by conversation
  const flushGroups = flushes.reduce<Record<string, FlushMemory[]>>((acc, f) => {
    const key = f.conversation_id || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {});

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
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="knowledge-search-input"
        />
        <FilterGroup
          options={areas}
          value={selectedArea}
          onChange={setSelectedArea}
          labelFn={(a) => a === "all" ? "All" : a.charAt(0).toUpperCase() + a.slice(1)}
        />
      </Row>

      {/* Memory list */}
      {loading ? (
        <Card><MetaText>Loading...</MetaText></Card>
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
      ) : (
        <Stack gap={2}>
          {filtered.map((m) => (
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
    </Stack>
  );

  const documentsContent = (
    <>
      {loading ? (
        <Card><MetaText>Loading...</MetaText></Card>
      ) : documents.length === 0 ? (
        <Card>
          <EmptyState
            icon="📄"
            message="No documents indexed yet. Use Obsidian Sync to index your vault, or ingest documents via API."
          />
        </Card>
      ) : (
        <Stack gap={2}>
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </Stack>
      )}
    </>
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
            {syncing ? "Syncing..." : "Full Sync Now"}
          </Button>
          <MetaText size="xs" className="ml-3">
            Indexes all .md files from your vault
          </MetaText>
        </div>
      </Card>

      {/* Documents from Obsidian */}
      <SectionLabel className="knowledge-flush-group-title">
        Indexed Documents ({documents.filter((d) => d.source === "obsidian").length} from Obsidian)
      </SectionLabel>
      {documents.filter((d) => d.source === "obsidian").length === 0 ? (
        <Card>
          <EmptyState
            icon="📓"
            message="No Obsidian documents indexed yet. Run a Full Sync to start."
          />
        </Card>
      ) : (
        <Stack gap={2}>
          {documents
            .filter((d) => d.source === "obsidian")
            .map((doc) => (
              <DocumentRow key={doc.id} doc={doc} />
            ))}
        </Stack>
      )}
    </>
  );

  const flushesContent = (
    <>
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

      {/* Flush list grouped by conversation */}
      {loading ? (
        <Card><MetaText>Loading...</MetaText></Card>
      ) : flushes.length === 0 ? (
        <Card>
          <EmptyState
            icon="💨"
            message={
              <>
                No context flushes yet. Flushes happen automatically when a conversation
                approaches the token limit ({">"}80K input tokens).
              </>
            }
          />
        </Card>
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
    </>
  );

  return (
    <>
      <PageHeader title="Knowledge Base" />

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
    <Card className={expanded ? "doc-row-expanded" : "doc-row"} onClick={!expanded ? handleExpand : undefined}>
      <Row justify="between" className="cursor-pointer" onClick={expanded ? handleExpand : undefined}>
        <div className="min-w-0 flex-1">
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

      {expanded && (
        <div className="doc-detail">
          {detailLoading ? (
            <MetaText size="sm" className="block p-4">Loading content...</MetaText>
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
                  <Row
                    justify="between"
                    className="doc-chunks-header"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowChunks(!showChunks); }}
                  >
                    <MetaText size="xs" className="font-semibold">
                      {chunks.length} Chunks {showChunks ? "\u25B2" : "\u25BC"}
                    </MetaText>
                    <MetaText size="xs">
                      {chunks.filter(c => c.has_embedding).length}/{chunks.length} embedded
                    </MetaText>
                  </Row>

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
