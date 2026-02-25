import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  PageHeader,
  PageBody,
  Card,
  Badge,
  Button,
  Modal,
  FormField,
  FormGrid,
  Row,
  Stack,
  MetaText,
  EmptyState,
  SearchInput,
  Pagination,
  ConfirmDialog,
} from "../components/ui";
import type { ConfirmAction } from "../components/ui";

// ─── Types ───

interface Bookmark {
  id: string;
  chrome_id: string | null;
  title: string;
  url: string;
  folder_path: string;
  description: string | null;
  tags: string[];
  status: string;
  source: string;
  suggested_by: string | null;
  suggestion_action: string | null;
  suggestion_reason: string | null;
  read_at: string | null;
  domain: string | null;
  created_at: string;
}

interface BookmarkStats {
  total: number;
  active: number;
  read_later: number;
  suggested: number;
  archived: number;
  domains: number;
  folders: number;
  duplicates: number;
}

interface Folder {
  folder_path: string;
  count: number;
}

// ─── Folder tree builder ───

interface TreeNode {
  name: string;
  path: string;
  count: number;
  children: TreeNode[];
  expanded: boolean;
}

function buildFolderTree(folders: Folder[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", count: 0, children: [], expanded: true };

  for (const f of folders) {
    const parts = f.folder_path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find((c) => c.name === parts[i]);
      if (!child) {
        child = { name: parts[i], path: partPath, count: 0, children: [], expanded: false };
        current.children.push(child);
      }
      if (i === parts.length - 1) {
        child.count = f.count;
      }
      current = child;
    }
  }

  // Sort children alphabetically, folders with more bookmarks first
  function sortTree(node: TreeNode) {
    node.children.sort((a, b) => {
      const totalA = countTotal(a);
      const totalB = countTotal(b);
      if (totalA !== totalB) return totalB - totalA;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }
  sortTree(root);
  return root.children;
}

function countTotal(node: TreeNode): number {
  return node.count + node.children.reduce((s, c) => s + countTotal(c), 0);
}

// ─── Helpers ───

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function faviconUrl(domain: string | null): string {
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

const PAGE_SIZE = 50;

// ─── Folder Tree Item ───

function FolderTreeItem({
  node,
  depth,
  selected,
  expandedPaths,
  hasSelection,
  dragOver,
  onSelect,
  onToggle,
  onDelete,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  expandedPaths: Set<string>;
  hasSelection: boolean;
  dragOver: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onDelete: (path: string) => void;
  onDrop: (path: string) => void;
  onDragOver: (path: string) => void;
  onDragLeave: () => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selected === node.path;
  const hasChildren = node.children.length > 0;
  const total = countTotal(node);
  const isDragTarget = dragOver === node.path;

  return (
    <>
      <div
        className={`bm-tree-item${isSelected ? " bm-tree-selected" : ""}${hasSelection ? " bm-tree-drop-target" : ""}${isDragTarget ? " bm-tree-drag-over" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(node.path)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(node.path); }}
        onDragLeave={(e) => { e.stopPropagation(); onDragLeave(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(node.path); }}
      >
        {hasChildren ? (
          <span
            className="bm-tree-toggle"
            onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          >
            {isExpanded ? "\u25BE" : "\u25B8"}
          </span>
        ) : (
          <span className="bm-tree-toggle" style={{ visibility: "hidden" }}>{"\u25B8"}</span>
        )}
        <span className="bm-tree-icon">{hasChildren ? (isExpanded ? "📂" : "📁") : "📁"}</span>
        <span className="bm-tree-name truncate">{node.name}</span>
        {(hasSelection || isDragTarget) && <span className="bm-tree-move-hint" style={isDragTarget ? { opacity: 1 } : undefined}>move here</span>}
        <span className="bm-tree-count">{total}</span>
        <button
          className="bm-tree-delete"
          onClick={(e) => { e.stopPropagation(); onDelete(node.path); }}
          title={`Delete folder "${node.name}" and all bookmarks in it`}
        >
          {"\u2715"}
        </button>
      </div>
      {isExpanded && node.children.map((child) => (
        <FolderTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selected={selected}
          expandedPaths={expandedPaths}
          hasSelection={hasSelection}
          dragOver={dragOver}
          onSelect={onSelect}
          onToggle={onToggle}
          onDelete={onDelete}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        />
      ))}
    </>
  );
}

// ─── Main Component ───

export default function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<BookmarkStats | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [suggestions, setSuggestions] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [folderFilter, setFolderFilter] = useState("");
  const [offset, setOffset] = useState(0);

  // Tree state
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [addForm, setAddForm] = useState({ title: "", url: "", folder_path: "/", tags: "" });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // Drag & drop
  const [dragOver, setDragOver] = useState("");
  const [dragIds, setDragIds] = useState<string[]>([]);

  // Smart duplicates
  const [smartDupes, setSmartDupes] = useState<Array<{ group: Array<{ id: string; title: string; url: string; domain: string | null; folder_path: string }>; reason: string }>>([]);
  const [smartLoading, setSmartLoading] = useState(false);
  const [showSmartDupes, setShowSmartDupes] = useState(false);

  // Build tree
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  // Auto-expand first level
  useEffect(() => {
    if (folderTree.length > 0 && expandedPaths.size === 0) {
      setExpandedPaths(new Set(folderTree.map((n) => n.path)));
    }
  }, [folderTree, expandedPaths.size]);

  // ─── Fetch ───

  const fetchBookmarks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (folderFilter) params.set("folder", folderFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetch(`/api/bookmarks?${params}`);
      const data = await res.json();
      setBookmarks(data.bookmarks || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch bookmarks:", err);
    }
  }, [search, statusFilter, folderFilter, offset]);

  const fetchMeta = useCallback(async () => {
    try {
      const [statsRes, foldersRes, suggestionsRes] = await Promise.all([
        fetch("/api/bookmarks/stats").then((r) => r.json()),
        fetch("/api/bookmarks/folders").then((r) => r.json()),
        fetch("/api/bookmarks/suggestions").then((r) => r.json()),
      ]);
      setStats(statsRes);
      setFolders(foldersRes.folders || []);
      setSuggestions(suggestionsRes.suggestions || []);
    } catch (err) {
      console.error("Failed to fetch bookmark metadata:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBookmarks(); }, [fetchBookmarks]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  // ─── Actions ───

  const syncPull = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/bookmarks/sync/pull", { method: "POST" });
      await Promise.all([fetchBookmarks(), fetchMeta()]);
    } finally { setSyncing(false); }
  }, [fetchBookmarks, fetchMeta]);

  const syncPush = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/bookmarks/sync/push", { method: "POST" });
      await fetchMeta();
    } finally { setSyncing(false); }
  }, [fetchMeta]);

  const deduplicate = useCallback(async () => {
    await fetch("/api/bookmarks/deduplicate", { method: "POST" });
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  }, [fetchBookmarks, fetchMeta]);

  const addBookmark = useCallback(async () => {
    await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...addForm, tags: addForm.tags.split(",").map((t) => t.trim()).filter(Boolean) }),
    });
    setShowAddModal(false);
    setAddForm({ title: "", url: "", folder_path: "/", tags: "" });
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  }, [addForm, fetchBookmarks, fetchMeta]);

  const removeBookmark = useCallback((id: string, title?: string) => {
    setConfirmAction({
      title: "Delete Bookmark",
      message: `Delete "${title || "this bookmark"}"?`,
      onConfirm: async () => {
        await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
        await Promise.all([fetchBookmarks(), fetchMeta()]);
      },
    });
  }, [fetchBookmarks, fetchMeta]);

  const toggleReadLater = useCallback(async (id: string, current: string) => {
    const endpoint = current === "read_later" ? "mark-read" : "read-later";
    await fetch(`/api/bookmarks/${id}/${endpoint}`, { method: "POST" });
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  }, [fetchBookmarks, fetchMeta]);

  const approveSuggestion = useCallback(async (id: string) => {
    await fetch(`/api/bookmarks/suggestions/${id}/approve`, { method: "POST" });
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  }, [fetchBookmarks, fetchMeta]);

  const rejectSuggestion = useCallback(async (id: string) => {
    await fetch(`/api/bookmarks/suggestions/${id}/reject`, { method: "POST" });
    await fetchMeta();
  }, [fetchMeta]);

  const moveSelected = useCallback(async () => {
    if (selectedIds.size === 0 || !moveTarget) return;
    await fetch("/api/bookmarks/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], folder_path: moveTarget }),
    });
    setSelectedIds(new Set());
    setShowMoveModal(false);
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  }, [selectedIds, moveTarget, fetchBookmarks, fetchMeta]);

  const bulkDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setConfirmAction({
      title: "Delete Bookmarks",
      message: `Delete ${selectedIds.size} selected bookmark(s)? This cannot be undone.`,
      onConfirm: async () => {
        await fetch("/api/bookmarks/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selectedIds] }),
        });
        setSelectedIds(new Set());
        await Promise.all([fetchBookmarks(), fetchMeta()]);
      },
    });
  }, [selectedIds, fetchBookmarks, fetchMeta]);

  const bulkReadLater = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await fetch("/api/bookmarks/bulk-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], status: "read_later" }),
    });
    setSelectedIds(new Set());
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  }, [selectedIds, fetchBookmarks, fetchMeta]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === bookmarks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bookmarks.map((b) => b.id)));
    }
  };

  // ─── Drag & Drop ───

  const handleDragStart = (e: React.DragEvent, bmId: string) => {
    // If dragging a selected item, drag all selected; otherwise just this one
    const ids = selectedIds.has(bmId) ? [...selectedIds] : [bmId];
    setDragIds(ids);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ids.join(","));
  };

  const handleFolderDrop = async (folderPath: string) => {
    const ids = dragIds.length > 0 ? dragIds : [...selectedIds];
    if (ids.length === 0) return;
    setDragOver("");
    setDragIds([]);
    await fetch("/api/bookmarks/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, folder_path: folderPath }),
    });
    setSelectedIds(new Set());
    // Navigate to target folder so moved items are visible
    setFolderFilter(folderPath);
    setOffset(0);
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  };

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const selectFolder = async (path: string) => {
    // If items are selected, clicking a folder moves them there
    if (selectedIds.size > 0) {
      await fetch("/api/bookmarks/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], folder_path: path }),
      });
      setSelectedIds(new Set());
      // Navigate to the target folder so moved items are visible
      setFolderFilter(path);
      setOffset(0);
      await Promise.all([fetchBookmarks(), fetchMeta()]);
      return;
    }
    setFolderFilter(path);
    setOffset(0);
    // Auto-expand parent paths
    const parts = path.split("/").filter(Boolean);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= parts.length; i++) {
        next.add(parts.slice(0, i).join("/"));
      }
      return next;
    });
  };

  const handleDeleteFolder = async (path: string) => {
    const name = path.split("/").pop() || path;
    setConfirmAction({
      title: "Delete Folder",
      message: `Delete folder "${name}" and all bookmarks inside it?`,
      onConfirm: async () => {
        await fetch("/api/bookmarks/delete-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_path: path }),
        });
        if (folderFilter === path || folderFilter.startsWith(path + "/")) {
          setFolderFilter("");
        }
        await Promise.all([fetchBookmarks(), fetchMeta()]);
      },
    });
  };

  const runSmartDuplicates = async () => {
    setSmartLoading(true);
    try {
      const res = await fetch("/api/bookmarks/smart-duplicates", { method: "POST" });
      const data = await res.json();
      setSmartDupes(data.groups || []);
      setShowSmartDupes(true);
    } catch (err) {
      console.error("Smart duplicates failed:", err);
    } finally {
      setSmartLoading(false);
    }
  };

  const removeSmartDupe = async (id: string) => {
    await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
    setSmartDupes((prev) =>
      prev.map((g) => ({ ...g, group: g.group.filter((b) => b.id !== id) }))
        .filter((g) => g.group.length >= 2),
    );
    await Promise.all([fetchBookmarks(), fetchMeta()]);
  };

  // ─── Stat chips ───

  if (loading) {
    return (
      <>
        <PageHeader title="Bookmarks" subtitle="Loading..." />
        <PageBody><Card><MetaText size="sm">Loading bookmarks...</MetaText></Card></PageBody>
      </>
    );
  }

  const subtitle = stats
    ? `${stats.total} bookmarks \u00B7 ${stats.domains} domains`
    : "";

  return (
    <>
      <PageHeader
        title="Bookmarks"
        subtitle={subtitle}
        actions={
          <Row gap={2}>
            <Button size="sm" onClick={syncPull} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync Chrome"}
            </Button>
            <Button size="sm" variant="ghost" onClick={syncPush} disabled={syncing}>
              Push to Chrome
            </Button>
            {stats && stats.duplicates > 0 && (
              <Button size="sm" variant="ghost" onClick={deduplicate}>
                Dedupe ({stats.duplicates})
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={runSmartDuplicates} disabled={smartLoading}>
              {smartLoading ? "Analyzing..." : "Smart Dedup"}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              + Add
            </Button>
          </Row>
        }
      />
      <PageBody gap={0}>
        <div className="bm-layout">
          {/* ─── Sidebar: Folder Tree ─── */}
          <div className="bm-sidebar">
            <div className="bm-sidebar-header">
              <span className="text-xs uppercase font-semibold text-muted">Folders</span>
            </div>

            {/* Special folders */}
            <div
              className={`bm-tree-item bm-tree-special${folderFilter === "" && statusFilter === "all" ? " bm-tree-selected" : ""}`}
              onClick={() => { setFolderFilter(""); setStatusFilter("all"); setOffset(0); }}
            >
              <span className="bm-tree-icon">{"🔖"}</span>
              <span className="bm-tree-name">All Bookmarks</span>
              <span className="bm-tree-count">{stats?.total || 0}</span>
            </div>
            <div
              className={`bm-tree-item bm-tree-special${statusFilter === "read_later" ? " bm-tree-selected" : ""}`}
              onClick={() => { setFolderFilter(""); setStatusFilter("read_later"); setOffset(0); }}
            >
              <span className="bm-tree-icon">{"📚"}</span>
              <span className="bm-tree-name">Read Later</span>
              <span className="bm-tree-count">{stats?.read_later || 0}</span>
            </div>
            {(stats?.suggested || 0) > 0 && (
              <div
                className={`bm-tree-item bm-tree-special${statusFilter === "suggested" ? " bm-tree-selected" : ""}`}
                onClick={() => { setFolderFilter(""); setStatusFilter("suggested"); setOffset(0); }}
              >
                <span className="bm-tree-icon">{"🤖"}</span>
                <span className="bm-tree-name">Agent Suggestions</span>
                <span className="bm-tree-count">{stats?.suggested || 0}</span>
              </div>
            )}

            <div className="bm-sidebar-divider" />

            {/* Folder tree */}
            <div className="bm-tree-scroll">
              {folderTree.map((node) => (
                <FolderTreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={folderFilter}
                  expandedPaths={expandedPaths}
                  hasSelection={selectedIds.size > 0}
                  dragOver={dragOver}
                  onSelect={selectFolder}
                  onToggle={toggleExpand}
                  onDelete={handleDeleteFolder}
                  onDrop={handleFolderDrop}
                  onDragOver={setDragOver}
                  onDragLeave={() => setDragOver("")}
                />
              ))}
            </div>
          </div>

          {/* ─── Main: Bookmark List ─── */}
          <div className="bm-main">
            {/* Toolbar */}
            <div className="bm-toolbar">
              {selectedIds.size > 0 ? (
                /* ── Bulk actions bar ── */
                <>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === bookmarks.length}
                    onChange={selectAll}
                    title="Select all"
                    style={{ cursor: "pointer" }}
                  />
                  <span className="bm-bulk-label">{selectedIds.size} selected</span>
                  <Button size="sm" variant="ghost" onClick={() => setShowMoveModal(true)}>
                    Move
                  </Button>
                  <Button size="sm" variant="ghost" onClick={bulkReadLater}>
                    Read Later
                  </Button>
                  <Button size="sm" variant="danger" onClick={bulkDeleteSelected}>
                    Delete
                  </Button>
                  <div style={{ flex: 1 }} />
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                    Cancel
                  </Button>
                </>
              ) : (
                /* ── Normal search bar ── */
                <>
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={selectAll}
                    title="Select all"
                    style={{ cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <SearchInput
                      value={search}
                      onChange={(v) => { setSearch(v); setOffset(0); }}
                      placeholder="Search bookmarks..."
                      resultCount={total}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Current folder breadcrumb */}
            {(folderFilter || statusFilter !== "all") && (
              <div className="bm-breadcrumb">
                <button className="bm-breadcrumb-btn" onClick={() => { setFolderFilter(""); setStatusFilter("all"); }}>
                  All
                </button>
                {folderFilter && folderFilter.split("/").filter(Boolean).map((part, i, arr) => (
                  <React.Fragment key={i}>
                    <span className="bm-breadcrumb-sep">/</span>
                    <button
                      className="bm-breadcrumb-btn"
                      onClick={() => selectFolder(arr.slice(0, i + 1).join("/"))}
                    >
                      {part}
                    </button>
                  </React.Fragment>
                ))}
                {statusFilter !== "all" && !folderFilter && (
                  <>
                    <span className="bm-breadcrumb-sep">/</span>
                    <span className="bm-breadcrumb-current">
                      {statusFilter === "read_later" ? "Read Later" : statusFilter === "suggested" ? "Suggestions" : statusFilter}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Suggestions banner */}
            {statusFilter === "suggested" && suggestions.length > 0 && (
              <div className="bm-suggestions">
                {suggestions.map((bm) => (
                  <Card key={bm.id} accent="var(--warning)">
                    <Row justify="between" align="center">
                      <Row gap={2} align="center" style={{ flex: 1, minWidth: 0 }}>
                        {bm.domain && <img src={faviconUrl(bm.domain)} alt="" width={16} height={16} />}
                        <div className="min-w-0" style={{ flex: 1 }}>
                          <div className="truncate text-sm">{bm.title}</div>
                          <div className="truncate text-xs text-muted">{bm.suggestion_reason}</div>
                        </div>
                        <Badge status="warning">{bm.suggestion_action}</Badge>
                      </Row>
                      <Row gap={1}>
                        <Button size="sm" variant="primary" onClick={() => approveSuggestion(bm.id)}>Approve</Button>
                        <button className="btn-small ui-btn-danger" onClick={() => rejectSuggestion(bm.id)}>Reject</button>
                      </Row>
                    </Row>
                  </Card>
                ))}
              </div>
            )}

            {/* Bookmark list */}
            {bookmarks.length === 0 ? (
              <div style={{ padding: 40 }}>
                <EmptyState
                  icon="🔖"
                  message={stats?.total === 0 ? "No bookmarks yet" : "No bookmarks in this folder"}
                  action={stats?.total === 0 ? <Button variant="primary" onClick={syncPull}>Pull from Chrome</Button> : undefined}
                />
              </div>
            ) : (
              <div className="bm-list">
                {bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className={`bm-item${selectedIds.has(bm.id) ? " bm-item-selected" : ""}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, bm.id)}
                    onDragEnd={() => { setDragOver(""); setDragIds([]); }}
                  >
                    <input
                      type="checkbox"
                      className="bm-item-check"
                      checked={selectedIds.has(bm.id)}
                      onChange={() => toggleSelect(bm.id)}
                    />
                    {bm.domain && (
                      <img src={faviconUrl(bm.domain)} alt="" width={16} height={16} className="bm-item-favicon" />
                    )}
                    <div className="bm-item-content min-w-0" style={{ flex: 1 }}>
                      <a
                        href={bm.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bm-item-title truncate"
                        title={bm.title}
                      >
                        {bm.title}
                      </a>
                      <span className="bm-item-domain truncate">{bm.domain}</span>
                    </div>
                    {bm.status === "read_later" && <Badge status="accent">RL</Badge>}
                    {bm.source === "agent" && <Badge status="warning">Agent</Badge>}
                    <span className="bm-item-date">{timeAgo(bm.created_at)}</span>
                    <div className="bm-item-actions">
                      <button
                        className="bm-action-btn"
                        onClick={() => toggleReadLater(bm.id, bm.status)}
                        title={bm.status === "read_later" ? "Mark read" : "Read later"}
                      >
                        {bm.status === "read_later" ? "\u2713" : "\u2605"}
                      </button>
                      <button
                        className="bm-action-btn bm-action-danger"
                        onClick={() => removeBookmark(bm.id, bm.title)}
                        title="Delete"
                      >
                        \u2715
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {total > PAGE_SIZE && (
              <div style={{ padding: "12px 16px" }}>
                <Pagination total={total} pageSize={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
              </div>
            )}
          </div>
        </div>

        {/* ─── Add Bookmark Modal ─── */}
        {showAddModal && (
          <Modal open onClose={() => setShowAddModal(false)} title="Add Bookmark" width={480}>
            <Stack gap={4}>
              <FormGrid>
                <FormField label="URL" span>
                  <input type="url" value={addForm.url} onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." />
                </FormField>
                <FormField label="Title" span>
                  <input type="text" value={addForm.title} onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))} placeholder="Page title" />
                </FormField>
                <FormField label="Folder">
                  <select value={addForm.folder_path} onChange={(e) => setAddForm((f) => ({ ...f, folder_path: e.target.value }))}>
                    <option value="/">/</option>
                    {folders.map((f) => <option key={f.folder_path} value={f.folder_path}>{f.folder_path}</option>)}
                  </select>
                </FormField>
                <FormField label="Tags" hint="Comma-separated">
                  <input type="text" value={addForm.tags} onChange={(e) => setAddForm((f) => ({ ...f, tags: e.target.value }))} placeholder="dev, react" />
                </FormField>
              </FormGrid>
              <Row justify="end" gap={2}>
                <Button onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={addBookmark} disabled={!addForm.url || !addForm.title}>Add</Button>
              </Row>
            </Stack>
          </Modal>
        )}

        {/* ─── Move Modal ─── */}
        {showMoveModal && (
          <Modal open onClose={() => setShowMoveModal(false)} title={`Move ${selectedIds.size} bookmark(s)`} width={400}>
            <Stack gap={3}>
              <FormField label="Target Folder">
                <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
                  <option value="">Select folder...</option>
                  <option value="/">/</option>
                  {folders.map((f) => <option key={f.folder_path} value={f.folder_path}>{f.folder_path}</option>)}
                </select>
              </FormField>
              <FormField label="Or type new path">
                <input type="text" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} placeholder="/New Folder" />
              </FormField>
              <Row justify="end" gap={2}>
                <Button onClick={() => setShowMoveModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={moveSelected} disabled={!moveTarget}>Move</Button>
              </Row>
            </Stack>
          </Modal>
        )}

        {/* ─── Smart Duplicates Modal ─── */}
        {showSmartDupes && (
          <Modal open onClose={() => setShowSmartDupes(false)} title="Smart Duplicates (AI)" width={700}>
            <Stack gap={3}>
              {smartDupes.length === 0 ? (
                <EmptyState icon="✓" message="No semantic duplicates found" />
              ) : (
                <div className="bm-smart-dupes">
                  <MetaText size="sm">{smartDupes.length} group(s) found — click X to remove a duplicate</MetaText>
                  {smartDupes.map((group, gi) => (
                    <Card key={gi}>
                      <div className="bm-dupe-reason">{group.reason}</div>
                      {group.group.map((bm) => (
                        <div key={bm.id} className="bm-dupe-item">
                          {bm.domain && <img src={faviconUrl(bm.domain)} alt="" width={16} height={16} />}
                          <a href={bm.url} target="_blank" rel="noopener noreferrer" className="bm-dupe-title truncate" title={bm.url}>
                            {bm.title}
                          </a>
                          <span className="bm-dupe-folder">{bm.folder_path}</span>
                          <button
                            className="bm-dupe-delete"
                            onClick={() => removeSmartDupe(bm.id)}
                            title="Delete this bookmark"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </Card>
                  ))}
                </div>
              )}
              <Row justify="end">
                <Button onClick={() => setShowSmartDupes(false)}>Close</Button>
              </Row>
            </Stack>
          </Modal>
        )}

      </PageBody>

      {/* ─── Confirm Dialog ─── */}
      <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />

      {/* ─── Scoped Styles ─── */}
      <style>{`
        .bm-layout {
          display: flex;
          height: calc(100vh - 74px);
          overflow: hidden;
        }

        /* ── Sidebar ── */
        .bm-sidebar {
          width: 260px;
          min-width: 260px;
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .bm-sidebar-header {
          padding: 12px 16px 8px;
          letter-spacing: 0.5px;
        }
        .bm-sidebar-divider {
          height: 1px;
          background: var(--border);
          margin: 6px 12px;
        }
        .bm-tree-scroll {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 20px;
        }

        /* ── Tree items ── */
        .bm-tree-item {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 12px 4px 8px;
          cursor: pointer;
          font-size: 12px;
          color: var(--text-secondary);
          border-radius: 4px;
          margin: 0 4px;
          user-select: none;
        }
        .bm-tree-item:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .bm-tree-selected {
          background: var(--accent-subtle) !important;
          color: var(--accent) !important;
        }
        .bm-tree-special {
          padding-left: 12px;
        }
        .bm-tree-toggle {
          width: 14px;
          text-align: center;
          font-size: 10px;
          flex-shrink: 0;
          color: var(--text-muted);
        }
        .bm-tree-icon {
          font-size: 13px;
          flex-shrink: 0;
          width: 18px;
          text-align: center;
        }
        .bm-tree-name {
          flex: 1;
          min-width: 0;
        }
        .bm-tree-count {
          font-size: 10px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 1px 6px;
          border-radius: 8px;
          flex-shrink: 0;
        }

        /* ── Main area ── */
        .bm-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }
        .bm-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border);
        }
        .bm-breadcrumb {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 6px 16px;
          font-size: 11px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
        }
        .bm-breadcrumb-btn {
          background: none;
          border: none;
          color: var(--accent);
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 11px;
        }
        .bm-breadcrumb-btn:hover {
          background: var(--bg-hover);
        }
        .bm-breadcrumb-sep {
          color: var(--text-muted);
        }
        .bm-breadcrumb-current {
          color: var(--text-primary);
          font-weight: 600;
        }

        /* ── Bookmark items ── */
        .bm-list {
          flex: 1;
          overflow-y: auto;
        }
        .bm-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
          border-bottom: 1px solid var(--border);
          font-size: 13px;
        }
        .bm-item:hover {
          background: var(--bg-hover);
        }
        .bm-item-selected {
          background: var(--accent-subtle);
        }
        .bm-item-check {
          flex-shrink: 0;
          cursor: pointer;
        }
        .bm-item-favicon {
          flex-shrink: 0;
          border-radius: 2px;
        }
        .bm-item-content {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .bm-item-title {
          color: var(--text-primary);
          text-decoration: none;
          font-size: 13px;
          max-width: 400px;
        }
        .bm-item-title:hover {
          color: var(--accent);
        }
        .bm-item-domain {
          font-size: 11px;
          color: var(--text-muted);
          max-width: 180px;
        }
        .bm-item-date {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .bm-item-actions {
          display: flex;
          gap: 2px;
          opacity: 0;
          transition: opacity 0.15s;
          flex-shrink: 0;
        }
        .bm-item:hover .bm-item-actions {
          opacity: 1;
        }
        .bm-action-btn {
          background: none;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          cursor: pointer;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
        }
        .bm-action-btn:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
        .bm-action-danger:hover {
          color: var(--error);
          border-color: var(--error);
        }

        .bm-suggestions {
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid var(--border);
        }

        /* ── Bulk actions ── */
        .bm-bulk-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--accent);
          white-space: nowrap;
        }

        /* ── Folder actions ── */
        .bm-tree-delete {
          display: none;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 9px;
          padding: 2px 4px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .bm-tree-item:hover .bm-tree-delete {
          display: block;
        }
        .bm-tree-delete:hover {
          color: var(--error);
          background: var(--bg-tertiary);
        }
        .bm-tree-drop-target {
          border: 1px dashed transparent;
          border-radius: 4px;
          margin: 1px 4px;
        }
        .bm-tree-drop-target:hover {
          border-color: var(--accent);
          background: var(--accent-subtle) !important;
        }
        .bm-tree-drag-over {
          border-color: var(--accent) !important;
          background: var(--accent-subtle) !important;
          color: var(--accent) !important;
        }
        .bm-tree-move-hint {
          font-size: 9px;
          color: var(--accent);
          opacity: 0;
          flex-shrink: 0;
        }
        .bm-tree-drop-target:hover .bm-tree-move-hint {
          opacity: 1;
        }

        /* ── Draggable items ── */
        .bm-item[draggable="true"] {
          cursor: grab;
        }
        .bm-item[draggable="true"]:active {
          cursor: grabbing;
          opacity: 0.5;
        }

        /* ── Smart duplicates ── */
        .bm-smart-dupes {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 60vh;
          overflow-y: auto;
        }
        .bm-dupe-reason {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }
        .bm-dupe-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          font-size: 12px;
        }
        .bm-dupe-title {
          flex: 1;
          min-width: 0;
          color: var(--text-primary);
          text-decoration: none;
        }
        .bm-dupe-title:hover {
          color: var(--accent);
        }
        .bm-dupe-folder {
          font-size: 10px;
          color: var(--text-muted);
          max-width: 150px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 0;
        }
        .bm-dupe-delete {
          background: none;
          border: 1px solid var(--error);
          color: var(--error);
          cursor: pointer;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .bm-dupe-delete:hover {
          background: var(--error);
          color: white;
        }
      `}</style>
    </>
  );
}
