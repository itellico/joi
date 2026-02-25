import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import MarkdownEditor from "./MarkdownEditor";
import {
  Button,
  Badge,
  Row,
  MetaText,
  Card,
  ConfirmDialog,
  type ConfirmAction,
} from "./ui";

interface DocumentEditorProps {
  docId: number | "new";
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

type ViewMode = "edit" | "split" | "preview";

export default function DocumentEditor({
  docId,
  onClose,
  onSaved,
  onDeleted,
}: DocumentEditorProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [originalTitle, setOriginalTitle] = useState("");
  const [source, setSource] = useState("manual");
  const [embeddedAt, setEmbeddedAt] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const isNew = docId === "new";
  const hasChanges = title !== originalTitle || content !== originalContent;

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      setTitle("Untitled Document");
      setContent("");
      setOriginalTitle("Untitled Document");
      setOriginalContent("");
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/${docId}`);
        const data = await res.json();
        const doc = data.document;
        setTitle(doc.title || "");
        setContent(doc.content || "");
        setOriginalTitle(doc.title || "");
        setOriginalContent(doc.content || "");
        setSource(doc.source || "manual");
        setEmbeddedAt(doc.embedded_at);
        setChunkCount(data.chunks?.length || 0);
      } catch {
        setContent("Failed to load document.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docId, isNew]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (isNew) {
        const res = await fetch("/api/documents/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content, source: "manual" }),
        });
        if (!res.ok) throw new Error("Failed to create document");
        onSaved?.();
        onClose();
      } else {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content }),
        });
        if (!res.ok) throw new Error("Failed to update document");
        setOriginalTitle(title);
        setOriginalContent(content);
        onSaved?.();
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [isNew, docId, title, content, onSaved, onClose]);

  const handleDelete = useCallback(() => {
    setConfirmAction({
      title: "Delete Document",
      message: `Delete "${title}"? This removes the document and all its embedded chunks. This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: async () => {
        const res = await fetch(`/api/documents/${docId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete");
        onDeleted?.();
        onClose();
      },
    });
  }, [docId, title, onDeleted, onClose]);

  if (loading) {
    return (
      <Card>
        <MetaText>Loading document…</MetaText>
      </Card>
    );
  }

  return (
    <div className="doc-editor">
      {/* Header */}
      <div className="doc-editor-header">
        <Row gap={3} align="center" className="doc-editor-header-left">
          <button
            type="button"
            className="doc-editor-back"
            onClick={onClose}
            title="Back to documents"
          >
            ←
          </button>
          <input
            className="doc-editor-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document title…"
          />
        </Row>
        <Row gap={2} align="center" className="doc-editor-header-right">
          {!isNew && (
            <>
              <Badge
                status={source === "obsidian" ? "success" : "warning"}
                className="text-xs"
              >
                {source}
              </Badge>
              <MetaText size="xs">{chunkCount} chunks</MetaText>
              {embeddedAt && (
                <MetaText size="xs">
                  embedded {new Date(embeddedAt).toLocaleDateString()}
                </MetaText>
              )}
            </>
          )}
          {!isNew && (
            <Button size="sm" variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={handleSave}
            disabled={saving || (!isNew && !hasChanges)}
          >
            {saving
              ? "Saving…"
              : isNew
                ? "Create & Embed"
                : "Save & Re-embed"}
          </Button>
        </Row>
      </div>

      {/* Toolbar: view mode toggle + unsaved indicator */}
      <div className="doc-editor-toolbar">
        <div className="doc-editor-mode-group">
          {(["edit", "split", "preview"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`doc-editor-mode-btn ${viewMode === mode ? "active" : ""}`}
              onClick={() => setViewMode(mode)}
            >
              {mode === "edit"
                ? "Edit"
                : mode === "split"
                  ? "Split"
                  : "Preview"}
            </button>
          ))}
        </div>
        <Row gap={3} align="center">
          {hasChanges && (
            <MetaText size="xs" className="doc-editor-unsaved">
              Unsaved changes
            </MetaText>
          )}
          <MetaText size="xs" className="doc-editor-wordcount">
            {content.split(/\s+/).filter(Boolean).length} words
            {" · "}
            {content.split("\n").length} lines
          </MetaText>
        </Row>
      </div>

      {/* Editor / Preview panes */}
      <div className={`doc-editor-panes doc-editor-panes--${viewMode}`}>
        {(viewMode === "edit" || viewMode === "split") && (
          <div className="doc-editor-edit-pane">
            <MarkdownEditor
              value={content}
              onChange={setContent}
              placeholder="Start writing markdown…"
              onSave={handleSave}
            />
          </div>
        )}
        {(viewMode === "preview" || viewMode === "split") && (
          <div className="doc-editor-preview-pane">
            {content.trim() ? (
              <div className="mdf-rendered doc-editor-preview-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="mdf-empty">No content yet</div>
            )}
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
