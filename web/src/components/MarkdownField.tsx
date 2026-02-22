import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";

interface MarkdownFieldProps {
  /** The markdown content to display / edit */
  value: string;
  /** Called when the user saves. If omitted, the field is read-only. */
  onSave?: (value: string) => void | Promise<void>;
  /** If true, start in edit mode */
  defaultEditing?: boolean;
  /** Placeholder shown when value is empty and not editing */
  placeholder?: string;
  /** Min rows for the editor textarea */
  minRows?: number;
  /** Max rows for the editor textarea */
  maxRows?: number;
  /** Max height for the rendered view (CSS value) */
  maxHeight?: string;
  /** If provided, shows an "Improve" button that calls this with current text and expects improved text back */
  onImprove?: (value: string) => Promise<string>;
  /** If true, the field is currently saving */
  saving?: boolean;
  /** Extra class on the outer wrapper */
  className?: string;
}

export default function MarkdownField({
  value,
  onSave,
  defaultEditing = false,
  placeholder = "No content",
  minRows = 6,
  maxRows = 25,
  maxHeight = "500px",
  onImprove,
  saving = false,
  className = "",
}: MarkdownFieldProps) {
  const [editing, setEditing] = useState(defaultEditing);
  const [draft, setDraft] = useState(value);
  const [improving, setImproving] = useState(false);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!onSave) return;
    await onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const handleImprove = async () => {
    if (!onImprove || !draft.trim()) return;
    setImproving(true);
    try {
      const improved = await onImprove(draft);
      if (improved) setDraft(improved);
    } finally {
      setImproving(false);
    }
  };

  const rows = Math.min(maxRows, Math.max(minRows, draft.split("\n").length + 2));

  if (editing) {
    return (
      <div className={`mdf ${className}`}>
        <textarea
          className="mdf-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={rows}
          autoFocus
        />
        <div className="mdf-toolbar">
          {onImprove && (
            <button className="btn-small btn-accent" onClick={handleImprove} disabled={improving || !draft.trim()}>
              {improving ? "Improving..." : "Improve"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn-small" onClick={handleCancel}>Cancel</button>
          {onSave && (
            <button className="btn-small btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`mdf ${className}`}>
      {value.trim() ? (
        <div className="mdf-rendered" style={{ maxHeight }} onClick={onSave ? startEdit : undefined}>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>{value}</ReactMarkdown>
        </div>
      ) : (
        <div className="mdf-empty" onClick={onSave ? startEdit : undefined}>
          {placeholder}
        </div>
      )}
      {onSave && !editing && (
        <div className="mdf-toolbar">
          <div style={{ flex: 1 }} />
          <button className="btn-small" onClick={startEdit}>Edit</button>
        </div>
      )}
    </div>
  );
}
